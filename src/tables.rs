//! `export-tables`: turn a validated county CAR into Parquet tables, one per
//! lexicon class, one per relationship type and a `properties` table from the
//! index, plus a `tables.car` whose single block records every part by CID.
//!
//! Which table a block belongs to comes from the schemas, never from a file
//! name: a data-group schema names its relationship schemas, and each of those
//! names the class at either end. Table names, columns, row order and part
//! splitting follow elephant-cli 1.x; the Parquet encoder is different, so
//! part bytes (and with them part CIDs and the tables root) are not the same
//! as a 1.x export of the same archive.

use crate::car::{self, Car, Place};
use crate::cids::{self, DAG_JSON};
use crate::schemas::Schemas;
use crate::unixfs;
use crate::Fail;
use cid::Cid;
use parquet::basic::{Compression, ConvertedType, Repetition, Type as Physical, ZstdLevel};
use parquet::data_type::{BoolType, ByteArray, ByteArrayType, DoubleType, Int64Type};
use parquet::file::metadata::KeyValue;
use parquet::file::properties::WriterProperties;
use parquet::file::writer::SerializedFileWriter;
use parquet::schema::types::Type;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MANIFEST: &str = "https://lexicon.elephant.xyz/api/manifest";
/// Columns every class table ends with, unless its schema already defines them.
const EXTRAS: [&str; 4] = ["cid", "property_cid", "data_group_cid", "request_identifier"];
/// Rows held across all tables before every table writes a row group.
const DRAIN: u64 = 64 << 20;

#[derive(Clone, Copy, PartialEq)]
enum Kind {
    Text,
    Double,
    Int,
    Bool,
}

impl Kind {
    fn name(self) -> &'static str {
        match self {
            Kind::Text => "STRING",
            Kind::Double => "DOUBLE",
            Kind::Int => "INT64",
            Kind::Bool => "BOOLEAN",
        }
    }
}

enum Cell {
    Null,
    Text(String),
    Double(f64),
    Int(i64),
    Bool(bool),
}

/// A table as the schemas define it.
#[derive(Clone)]
struct Table {
    name: String,
    columns: Vec<(String, Kind)>,
    /// What defined it, for the message when two definitions disagree.
    source: String,
}

struct Part {
    cid: Cid,
    rows: u64,
    bytes: u64,
}

struct Open {
    file: PathBuf,
    writer: SerializedFileWriter<File>,
    rows: u64,
}

/// Rows of one table, streamed into `part-NNNNN.parquet` files.
struct Writer {
    table: Table,
    dir: PathBuf,
    cap: u64,
    meta: Vec<(String, String)>,
    rows: Vec<Vec<Cell>>,
    pending: u64,
    open: Option<Open>,
    parts: Vec<Part>,
    total: u64,
}

impl Writer {
    fn push(&mut self, values: Vec<Cell>) -> Result<(), Fail> {
        // An estimate, as 1.x made it: UTF-16 length for text, 8 for everything else.
        let size = 8 + values.iter().fold(0, |sum, cell| {
            sum + match cell {
                Cell::Text(text) => text.encode_utf16().count() as u64,
                _ => 8,
            }
        });
        let held = self.open.as_ref().map_or(0, |open| open.writer.bytes_written() as u64) + self.pending;
        if held > 0 && held + size > self.cap {
            self.seal()?;
        }
        self.rows.push(values);
        self.pending += size;
        self.total += 1;
        Ok(())
    }

    /// Write the pending rows as one row group of the open part.
    fn flush(&mut self) -> Result<(), Fail> {
        if self.rows.is_empty() {
            return Ok(());
        }
        if self.open.is_none() {
            let dir = self.dir.join(&self.table.name);
            std::fs::create_dir_all(&dir)?;
            let file = dir.join(format!("part-{:05}.parquet", self.parts.len()));
            let fields = self.table.columns.iter().map(|(name, kind)| {
                let physical = match kind {
                    Kind::Text => Physical::BYTE_ARRAY,
                    Kind::Double => Physical::DOUBLE,
                    Kind::Int => Physical::INT64,
                    Kind::Bool => Physical::BOOLEAN,
                };
                let column = Type::primitive_type_builder(name, physical).with_repetition(Repetition::OPTIONAL);
                let column = if *kind == Kind::Text { column.with_converted_type(ConvertedType::UTF8) } else { column };
                column.build().map(Arc::new)
            });
            let schema = Type::group_type_builder("root").with_fields(fields.collect::<Result<_, _>>()?).build()?;
            let mut meta: Vec<KeyValue> =
                self.meta.iter().map(|(key, value)| KeyValue::new(key.clone(), value.clone())).collect();
            meta.push(KeyValue::new("elephant.table".to_string(), self.table.name.clone()));
            meta.push(KeyValue::new("elephant.part".to_string(), self.parts.len().to_string()));
            let properties = WriterProperties::builder()
                .set_compression(Compression::ZSTD(ZstdLevel::try_new(3)?))
                .set_created_by(format!("elephant-cli {}", env!("CARGO_PKG_VERSION")))
                .set_key_value_metadata(Some(meta))
                .build();
            let writer = SerializedFileWriter::new(File::create(&file)?, Arc::new(schema), Arc::new(properties))?;
            self.open = Some(Open { file, writer, rows: 0 });
        }
        let open = self.open.as_mut().expect("just opened");
        let mut group = open.writer.next_row_group()?;
        let mut at = 0;
        while let Some(mut column) = group.next_column()? {
            let levels: Vec<i16> = self.rows.iter().map(|row| i16::from(!matches!(row[at], Cell::Null))).collect();
            let cells = self.rows.iter().map(|row| &row[at]);
            match self.table.columns[at].1 {
                Kind::Text => {
                    let values: Vec<ByteArray> = cells
                        .filter_map(|cell| match cell {
                            Cell::Text(text) => Some(ByteArray::from(text.as_str())),
                            _ => None,
                        })
                        .collect();
                    column.typed::<ByteArrayType>().write_batch(&values, Some(&levels), None)?;
                }
                Kind::Double => {
                    let values: Vec<f64> = cells
                        .filter_map(|cell| match cell {
                            Cell::Double(value) => Some(*value),
                            _ => None,
                        })
                        .collect();
                    column.typed::<DoubleType>().write_batch(&values, Some(&levels), None)?;
                }
                Kind::Int => {
                    let values: Vec<i64> = cells
                        .filter_map(|cell| match cell {
                            Cell::Int(value) => Some(*value),
                            _ => None,
                        })
                        .collect();
                    column.typed::<Int64Type>().write_batch(&values, Some(&levels), None)?;
                }
                Kind::Bool => {
                    let values: Vec<bool> = cells
                        .filter_map(|cell| match cell {
                            Cell::Bool(value) => Some(*value),
                            _ => None,
                        })
                        .collect();
                    column.typed::<BoolType>().write_batch(&values, Some(&levels), None)?;
                }
            }
            column.close()?;
            at += 1;
        }
        group.close()?;
        open.rows += self.rows.len() as u64;
        self.rows.clear();
        self.pending = 0;
        Ok(())
    }

    /// Finish the open part and record its CID.
    fn seal(&mut self) -> Result<(), Fail> {
        self.flush()?;
        let Some(open) = self.open.take() else {
            return Ok(());
        };
        open.writer.close()?;
        let cid = unixfs::cid(File::open(&open.file)?)?;
        let bytes = std::fs::metadata(&open.file)?.len();
        self.parts.push(Part { cid, rows: open.rows, bytes });
        Ok(())
    }
}

/// `Address` -> `address`, `Property Improvement` -> `property_improvement`.
fn snake(title: Option<&Value>) -> String {
    let title = title.and_then(Value::as_str).unwrap_or_default().trim();
    title.split_whitespace().collect::<Vec<_>>().join("_").to_lowercase()
}

fn kind(property: &Value) -> Kind {
    let named = &property["type"];
    let listed = named.as_array().map_or(std::slice::from_ref(named), Vec::as_slice);
    match listed.iter().filter_map(Value::as_str).find(|name| *name != "null") {
        Some("number") => Kind::Double,
        Some("integer") => Kind::Int,
        Some("boolean") => Kind::Bool,
        _ => Kind::Text,
    }
}

/// The CID a link `{"/": "<cid>"}` points at.
fn link(value: &Value) -> Option<Cid> {
    let text = value.as_object().filter(|fields| fields.len() == 1)?.get("/")?.as_str()?;
    Cid::try_from(text).ok().filter(|_| cids::parses(text))
}

/// A value as JavaScript's `JSON.stringify` prints it, keys in block order.
fn stringify(value: &Value, out: &mut String) {
    match value {
        Value::Number(number) => out.push_str(ryu_js::Buffer::new().format(number.as_f64().unwrap_or(0.0))),
        Value::Array(items) => {
            out.push('[');
            for (at, item) in items.iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                stringify(item, out);
            }
            out.push(']');
        }
        Value::Object(fields) => {
            out.push('{');
            for (at, (key, item)) in fields.iter().enumerate() {
                if at > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String(key.clone()).to_string());
                out.push(':');
                stringify(item, out);
            }
            out.push('}');
        }
        other => out.push_str(&other.to_string()),
    }
}

fn cell(value: Option<&Value>, kind: Kind, place: impl Fn() -> String) -> Result<Cell, Fail> {
    let Some(value) = value.filter(|value| !value.is_null()) else {
        return Ok(Cell::Null);
    };
    let whole = |number: f64| number.fract() == 0.0 && number.abs() < 9.3e18;
    Ok(match (kind, value) {
        (Kind::Text, Value::String(text)) => Cell::Text(text.clone()),
        (Kind::Text, other) => Cell::Text(link(other).map(|cid| cid.to_string()).unwrap_or_else(|| {
            let mut text = String::new();
            stringify(other, &mut text);
            text
        })),
        (Kind::Bool, Value::Bool(flag)) => Cell::Bool(*flag),
        (Kind::Double, Value::Number(number)) => Cell::Double(number.as_f64().unwrap_or(0.0)),
        (Kind::Int, Value::Number(number)) if number.as_f64().is_some_and(whole) => {
            Cell::Int(number.as_i64().unwrap_or_else(|| number.as_f64().unwrap_or(0.0) as i64))
        }
        (kind, other) => {
            let mut text = String::new();
            stringify(other, &mut text);
            return Err(format!("{}: expects {}, got {text}", place(), kind.name()).into());
        }
    })
}

/// The Atlas county page `--atlas-page` creates or updates.
pub struct Atlas {
    pub page: PathBuf,
    pub county: Option<String>,
    pub state: Option<String>,
    pub fips: Option<String>,
}

pub struct Exported {
    /// The `CountyTables` root.
    pub root: String,
    pub county_root: String,
    /// Each table with its rows and parts, in the order first written.
    pub tables: Vec<(String, u64, usize)>,
    /// The Atlas group key written, when a page was asked for.
    pub group: Option<String>,
}

struct Export<'a> {
    car: &'a Car,
    index: HashMap<Cid, Place>,
    schemas: &'a mut Schemas,
    classes: HashMap<String, Table>,
    chains: HashMap<String, HashMap<String, (Table, Table)>>,
    writers: Vec<Writer>,
    output: &'a Path,
    cap: u64,
    meta: Vec<(String, String)>,
    seen: HashSet<Cid>,
}

impl Export<'_> {
    /// A block as a JSON object; anything else cannot be exported.
    fn block(&self, cid: &Cid) -> Result<Map<String, Value>, Fail> {
        let bytes = self.index.get(cid).filter(|_| cid.codec() == DAG_JSON).map(|place| self.car.bytes(*place));
        match bytes.and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok()) {
            Some(Value::Object(fields)) => Ok(fields),
            _ => Err(format!("block {cid} is not a dag-json object in the car").into()),
        }
    }

    /// The table of a class schema: its properties, then those of its
    /// `oneOf`/`anyOf` variants (first definition wins), then the extras.
    fn class(&mut self, cid: &str) -> Result<Table, Fail> {
        if let Some(known) = self.classes.get(cid) {
            return Ok(known.clone());
        }
        let schema = self.schemas.get(cid)?;
        let name = snake(schema.get("title"));
        if name.is_empty() {
            return Err(format!("class schema {cid} has no title").into());
        }
        let mut columns: Vec<(String, Kind)> = Vec::new();
        let variants = ["oneOf", "anyOf"].into_iter().filter_map(|key| schema[key].as_array()).flatten();
        for holder in std::iter::once(&schema).chain(variants) {
            for (field, property) in holder["properties"].as_object().into_iter().flatten() {
                if columns.iter().all(|(known, _)| known != field) {
                    columns.push((field.clone(), kind(property)));
                }
            }
        }
        for extra in EXTRAS {
            if columns.iter().all(|(known, _)| known != extra) {
                columns.push((extra.to_string(), Kind::Text));
            }
        }
        let table = Table { name, columns, source: cid.to_string() };
        self.classes.insert(cid.to_string(), table.clone());
        Ok(table)
    }

    /// For a data-group schema: the classes at either end of every relationship it names.
    fn chain(&mut self, group: &str) -> Result<HashMap<String, (Table, Table)>, Fail> {
        if let Some(known) = self.chains.get(group) {
            return Ok(known.clone());
        }
        let schema = self.schemas.get(group)?;
        let mut ends = HashMap::new();
        for (key, reference) in schema["properties"]["relationships"]["properties"].as_object().into_iter().flatten() {
            let pointer = reference["cid"].as_str().or_else(|| reference["items"]["cid"].as_str());
            let relation = pointer.map(|pointer| self.schemas.get(pointer)).transpose()?.unwrap_or(Value::Null);
            let sides = (relation["properties"]["from"]["cid"].as_str(), relation["properties"]["to"]["cid"].as_str());
            let (Some(from), Some(to)) = sides else {
                return Err(
                    format!("relationship {key} of data group {group} does not name from/to class schemas").into()
                );
            };
            ends.insert(key.clone(), (self.class(from)?, self.class(to)?));
        }
        self.chains.insert(group.to_string(), ends.clone());
        Ok(ends)
    }

    /// The writer of a table, created on first use.
    fn writer(&mut self, table: &Table) -> Result<&mut Writer, Fail> {
        let signature = |table: &Table| {
            let columns: Vec<String> = table.columns.iter().map(|(name, kind)| format!("{name}:{}", kind.name())).collect();
            columns.join(",")
        };
        let found = self.writers.iter().position(|writer| writer.table.name == table.name);
        let at = match found {
            Some(at) if signature(&self.writers[at].table) != signature(table) => {
                return Err(format!(
                    "table {} has two schemas in this car: {} and {}",
                    table.name, self.writers[at].table.source, table.source
                )
                .into());
            }
            Some(at) => at,
            None => {
                self.writers.push(Writer {
                    table: table.clone(),
                    dir: self.output.to_path_buf(),
                    cap: self.cap,
                    meta: self.meta.clone(),
                    rows: Vec::new(),
                    pending: 0,
                    open: None,
                    parts: Vec::new(),
                    total: 0,
                });
                self.writers.len() - 1
            }
        };
        Ok(&mut self.writers[at])
    }

    /// Write an entity block as a row of its class table, once.
    fn entity(&mut self, table: &Table, cid: &Cid, property: &str, group: &str) -> Result<(), Fail> {
        if !self.seen.insert(*cid) {
            return Ok(());
        }
        let block = self.block(cid)?;
        let name = cid.to_string();
        let mut values = Vec::with_capacity(table.columns.len());
        for (column, kind) in &table.columns {
            let extra = match column.as_str() {
                "cid" => Some(Value::String(name.clone())),
                "property_cid" => Some(Value::String(property.to_string())),
                "data_group_cid" => Some(Value::String(group.to_string())),
                _ => None,
            };
            let value = extra.as_ref().or_else(|| block.get(column));
            values.push(cell(value, *kind, || format!("{} {name}: column {column}", table.name))?);
        }
        self.writer(table)?.push(values)
    }
}

fn relation() -> Vec<(String, Kind)> {
    ["relationship_cid", "from_cid", "to_cid", "property_cid", "data_group_cid"]
        .map(|name| (name.to_string(), Kind::Text))
        .to_vec()
}

struct Entry {
    property: String,
    groups: Vec<(String, Cid)>,
}

/// Read the county index: every entry of every shard, in the order listed. The first problem stops the export.
fn entries(car: &Car, index: &HashMap<Cid, Place>) -> Result<(Cid, Vec<Entry>), Fail> {
    let [root] = car.roots[..] else {
        let listed: Vec<String> = car.roots.iter().map(Cid::to_string).collect();
        return Err(format!("root: expected exactly one root, found {} ({})", car.roots.len(), listed.join(" ")).into());
    };
    if root.codec() != DAG_JSON {
        return Err(format!("root: root must be a dag-json block ({root})").into());
    }
    let Some(place) = index.get(&root) else {
        return Err(format!("root: root block is not in the car ({root})").into());
    };
    let head: Value = serde_json::from_slice(car.bytes(*place)).map_err(|_| format!("root: root block is not dag-json ({root})"))?;
    let shards: Option<Vec<Cid>> = head["shards"].as_array().and_then(|shards| shards.iter().map(link).collect());
    let shape = [
        (head["label"] == "CountyIndex", "label must be \"CountyIndex\""),
        (head["version"].as_f64() == Some(1.0), "version must be 1"),
        (head["properties"].is_number(), "properties must be a number"),
        (shards.is_some(), "shards must be an array of links"),
    ];
    if let Some((_, message)) = shape.iter().find(|(ok, _)| !ok) {
        return Err(format!("root: {message} ({root})").into());
    }
    let present = |to: &Cid, from: &Cid| match index.contains_key(to) {
        true => Ok(()),
        false => Err(format!("link {to} from {from} is not in the car")),
    };
    let mut found = Vec::new();
    for shard in shards.unwrap_or_default() {
        present(&shard, &root)?;
        let body: Value = serde_json::from_slice(car.bytes(index[&shard])).unwrap_or(Value::Null);
        let Some(listed) = body["properties"].as_array() else {
            return Err(format!("index: shard must decode to {{\"properties\": [...]}} ({shard})").into());
        };
        for item in listed {
            let (Some(property), Some(pointers)) = (link(&item["property_cid"]), item["data_groups"].as_object()) else {
                return Err(
                    format!("index: shard entry must hold a property_cid link and a data_groups object ({shard})").into()
                );
            };
            present(&property, &shard)?;
            let mut groups = Vec::new();
            for (schema, pointer) in pointers {
                let Some(data) = link(pointer) else {
                    return Err(format!("index: data_groups.{schema} must be a link ({shard})").into());
                };
                present(&data, &shard)?;
                groups.push((schema.clone(), data));
            }
            found.push(Entry { property: property.to_string(), groups });
        }
    }
    if head["properties"].as_f64() != Some(found.len() as f64) {
        return Err(format!(
            "index: index declares {} properties but shards hold {} ({root})",
            head["properties"],
            found.len()
        )
        .into());
    }
    Ok((root, found))
}

/// The page's county, state and FIPS code, checked against what is already there.
fn identity(atlas: &Atlas, page: Option<&Value>) -> Result<[String; 3], Fail> {
    let path = atlas.page.display();
    let mut named = Vec::new();
    for (key, flag) in [("county", &atlas.county), ("state", &atlas.state), ("fips", &atlas.fips)] {
        let stored = page.map(|page| &page[key]);
        let Some(value) = flag.clone().or_else(|| stored.and_then(Value::as_str).map(str::to_string)) else {
            return Err(format!("--{key} is required to create {path}").into());
        };
        if let Some(stored) = stored.filter(|stored| stored.as_str() != Some(value.as_str())) {
            return Err(format!("--{key} {value} does not match {key} {stored} in {path}").into());
        }
        named.push(value);
    }
    let [county, state, fips] = <[String; 3]>::try_from(named).expect("three keys");
    if fips.len() != 5 || !fips.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(format!("--fips must be five digits, got {fips}").into());
    }
    if state.len() != 2 || !state.bytes().all(|byte| byte.is_ascii_uppercase()) {
        return Err(format!("--state must be a two-letter code, got {state}").into());
    }
    Ok([county, state, fips])
}

pub fn export(
    file: &Path,
    output: &Path,
    cap: u64,
    atlas: Option<&Atlas>,
    schemas: &mut Schemas,
) -> Result<Exported, Fail> {
    std::fs::create_dir_all(output)?;
    let car = Car::open(file)?;
    // ponytail: every block is indexed in memory, as 1.x did; walk shard by
    // shard as `validate` does if an archive is too large for that
    let mut index = HashMap::new();
    for block in car.blocks() {
        let (cid, place) = block?;
        index.entry(cid).or_insert(place);
    }
    let (root, listed) = entries(&car, &index)?;
    let manifest = std::env::var("ELEPHANT_SCHEMA_MANIFEST_URL").ok().filter(|url| !url.is_empty());
    let mut export = Export {
        car: &car,
        index,
        schemas,
        classes: HashMap::new(),
        chains: HashMap::new(),
        writers: Vec::new(),
        output,
        cap,
        meta: vec![
            ("elephant.county_root".to_string(), root.to_string()),
            ("elephant.manifest_url".to_string(), manifest.unwrap_or_else(|| MANIFEST.to_string())),
            ("elephant.part_size_bytes".to_string(), cap.to_string()),
        ],
        seen: HashSet::new(),
    };
    // The `properties` table: one column per data group, in order of first appearance.
    let mut groups: Vec<String> = Vec::new();
    for (schema, _) in listed.iter().flat_map(|entry| &entry.groups) {
        if !groups.contains(schema) {
            groups.push(schema.clone());
        }
    }

    // The Atlas page is checked before anything is written.
    let page = atlas.and_then(|atlas| std::fs::read(&atlas.page).ok());
    let page: Option<Value> = page.map(|bytes| serde_json::from_slice(&bytes)).transpose()?;
    let mut registered = None;
    if let Some(atlas) = atlas {
        let named = identity(atlas, page.as_ref())?;
        let mut labelled = Vec::new();
        for group in &groups {
            let label = snake(export.schemas.get(group)?.get("title"));
            if label != "seed" {
                labelled.push((label, group.clone()));
            }
        }
        let [(label, group)] = &labelled[..] else {
            return Err(format!(
                "archive carries {} data groups; Atlas registers one group per archive",
                labelled.len()
            )
            .into());
        };
        registered = Some((named, label.clone(), group.clone()));
    }

    let properties = Table {
        name: "properties".to_string(),
        columns: std::iter::once("property_cid").chain(groups.iter().map(String::as_str)).map(|name| (name.to_string(), Kind::Text)).collect(),
        source: "the county index".to_string(),
    };
    export.writer(&properties)?;
    for entry in &listed {
        let mut row = vec![Cell::Text(entry.property.clone())];
        for group in &groups {
            let data = entry.groups.iter().find(|(schema, _)| schema == group);
            row.push(data.map_or(Cell::Null, |(_, data)| Cell::Text(data.to_string())));
        }
        export.writer(&properties)?.push(row)?;
        for (group, data) in &entry.groups {
            let root = export.block(data)?;
            let ends = export.chain(group)?;
            let empty = Map::new();
            // a list of relationships has no keys the schema could name
            let listed: Map<String, Value> = match &root.get("relationships") {
                Some(Value::Array(items)) => items.iter().enumerate().map(|(at, item)| (at.to_string(), item.clone())).collect(),
                _ => Map::new(),
            };
            let relationships = match root.get("relationships") {
                Some(Value::Object(fields)) => fields,
                Some(Value::Array(_)) => &listed,
                _ => &empty,
            };
            for (key, value) in relationships {
                let Some((from_class, to_class)) = ends.get(key) else {
                    return Err(format!("relationship {key} in {data} is not in data group schema {group}").into());
                };
                let items = value.as_array().map_or(std::slice::from_ref(value), Vec::as_slice);
                for item in items {
                    let Some(pointer) = link(item).filter(|pointer| export.seen.insert(*pointer)) else {
                        continue;
                    };
                    let block = export.block(&pointer)?;
                    let ends = (block.get("from").and_then(link), block.get("to").and_then(link));
                    let (Some(from), Some(to)) = ends else {
                        return Err(format!("relationship {pointer} does not link from and to").into());
                    };
                    let table = Table { name: key.clone(), columns: relation(), source: format!("relationship {key}") };
                    let row = [pointer.to_string(), from.to_string(), to.to_string(), entry.property.clone(), group.clone()];
                    export.writer(&table)?.push(row.map(Cell::Text).into())?;
                    export.entity(from_class, &from, &entry.property, group)?;
                    export.entity(to_class, &to, &entry.property, group)?;
                }
            }
        }
        if export.writers.iter().map(|writer| writer.pending).sum::<u64>() >= DRAIN {
            for writer in &mut export.writers {
                writer.flush()?;
            }
        }
    }
    for writer in &mut export.writers {
        writer.seal()?;
    }

    // `tables.car`: one dag-json block naming every part, tables by name.
    let tables: BTreeMap<&str, Value> = export
        .writers
        .iter()
        .map(|writer| {
            let parts: Vec<Value> = writer
                .parts
                .iter()
                .map(|part| json!({ "bytes": part.bytes, "cid": { "/": part.cid.to_string() }, "rows": part.rows }))
                .collect();
            (writer.table.name.as_str(), json!({ "parts": parts, "rows": writer.total }))
        })
        .collect();
    let document = json!({
        "codec": "zstd",
        "county_root": { "/": root.to_string() },
        "label": "CountyTables",
        "part_size_bytes": cap,
        "tables": tables,
        "version": 1,
    })
    .to_string();
    let tables_root = cids::of(DAG_JSON, document.as_bytes());
    let mut bytes = car::header(&[tables_root]);
    car::put(&mut bytes, &tables_root, document.as_bytes())?;
    File::create(output.join("tables.car"))?.write_all(&bytes)?;

    let mut group = None;
    if let (Some(atlas), Some(([county, state, fips], label, schema))) = (atlas, registered) {
        let mut page = page.and_then(|page| page.as_object().cloned()).unwrap_or_default();
        page.insert("county".to_string(), json!(county));
        page.insert("state".to_string(), json!(state));
        page.insert("fips".to_string(), json!(fips));
        let mut groups: BTreeMap<String, Value> =
            page.get("groups").and_then(Value::as_object).into_iter().flatten().map(|(key, value)| (key.clone(), value.clone())).collect();
        groups.insert(label.clone(), json!({ "cid": root.to_string(), "schema": schema, "tables": tables_root.to_string() }));
        // ponytail: byte order of group keys; 1.x used locale collation, the same for snake_case labels
        page.insert("groups".to_string(), Value::Object(groups.into_iter().collect()));
        if let Some(parent) = atlas.page.parent().filter(|parent| !parent.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&atlas.page, format!("{}\n", serde_json::to_string_pretty(&page)?))?;
        group = Some(label);
    }
    Ok(Exported {
        root: tables_root.to_string(),
        county_root: root.to_string(),
        tables: export.writers.iter().map(|writer| (writer.table.name.clone(), writer.total, writer.parts.len())).collect(),
        group,
    })
}
