//! `validate <county.car>`: prove a county archive before its root is registered.
//!
//! Six checks: block bytes hash to their CIDs (integrity), the single root is
//! a `CountyIndex` (root), every shard entry resolves (index), every link
//! below the root resolves (graph), every data group validates against its
//! schema (lexicon), and every block is reachable from the root (orphans).
//!
//! The file is read start to end twice and never indexed as a whole. The
//! first read hashes every block. The second cuts the file into segments at
//! the shard blocks and checks each shard against the segment before it and
//! the segment after it: `hash --output-car` writes a shard's blocks right
//! before the shard block, and a gateway export (`?format=car`) writes them
//! right after. A link that leaves those two segments is looked up in an
//! index of the whole file, built on first use; that is the slow path.

use crate::car::{Car, Place};
use crate::cids::{DAG_JSON, RAW};
use crate::lexicon::{self, Group, Lexicon};
use crate::report::{Report, Row};
use crate::schemas::Schemas;
use crate::Fail;
use cid::Cid;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, OnceLock};

pub const CHECKS: [&str; 6] = ["integrity", "root", "index", "graph", "lexicon", "orphans"];
const INTEGRITY: usize = 0;
const ROOT: usize = 1;
const INDEX: usize = 2;
const GRAPH: usize = 3;
const LEXICON: usize = 4;
const ORPHANS: usize = 5;

#[derive(Default)]
pub struct Summary {
    pub blocks: u64,
    pub properties: u64,
    pub groups: u64,
    /// Blocks looked up by CID because they are stored away from the shard
    /// that links to them; 0 for the two layouts described above.
    pub lookups: u64,
    pub errors: [u64; 6],
}

/// A Bloom filter of every CID in the file, one bit per 16 bytes of file. It
/// says for certain that a block is absent, so a link to a missing block is
/// settled without an index of the whole file.
struct Bloom {
    bits: Vec<u8>,
    size: u64,
}

impl Bloom {
    fn new(bytes: u64) -> Bloom {
        let size = (bytes / 16).clamp(1 << 20, 1 << 32);
        Bloom { bits: vec![0; (size as usize).div_ceil(8)], size }
    }

    fn spots(&self, cid: &Cid) -> [u64; 8] {
        let digest = cid.hash().digest();
        std::array::from_fn(|cut| {
            (0..4).fold(0u64, |sum, step| {
                let at = (cut * 4 + step) % digest.len().max(1);
                sum * 256 + u64::from(digest.get(at).copied().unwrap_or(0))
            }) % self.size
        })
    }

    fn has(&self, cid: &Cid) -> bool {
        self.spots(cid).iter().all(|spot| self.bits[(spot / 8) as usize] & (1 << (spot % 8)) != 0)
    }

    /// Adds the CID; true when the filter already had it.
    fn add(&mut self, cid: &Cid) -> bool {
        let had = self.has(cid);
        for spot in self.spots(cid) {
            self.bits[(spot / 8) as usize] |= 1 << (spot % 8);
        }
        had
    }
}

/// The blocks between two shard blocks, by CID.
type Segment = HashMap<Cid, Place>;

enum Found<'a> {
    /// In one of the two segments held for the shard being checked.
    Near(&'a [u8]),
    /// Elsewhere in the file, found through the index of the whole file.
    Far(&'a [u8]),
    Absent,
}

/// The blocks a check may read. Shared by the threads that check properties.
struct View<'a> {
    car: &'a Car,
    previous: &'a Segment,
    current: &'a Segment,
    top: (Cid, Place),
    bloom: &'a Bloom,
    index: &'a OnceLock<Segment>,
}

impl View<'_> {
    fn near(&self, cid: &Cid) -> Option<&[u8]> {
        let place = self.current.get(cid).or_else(|| self.previous.get(cid));
        let place = place.or_else(|| (*cid == self.top.0).then_some(&self.top.1));
        place.map(|place| self.car.bytes(*place))
    }

    fn find(&self, cid: &Cid) -> Found<'_> {
        if let Some(bytes) = self.near(cid) {
            return Found::Near(bytes);
        }
        if !self.bloom.has(cid) {
            return Found::Absent;
        }
        let index = self.index.get_or_init(|| {
            eprintln!(
                "warning: block {cid} is not stored next to the shard that links to it; indexing the whole file to look blocks up by CID, which is slower and takes more memory"
            );
            let mut index = Segment::new();
            for (cid, place) in self.car.blocks().flatten() {
                index.entry(cid).or_insert(place);
            }
            index
        });
        match index.get(cid) {
            Some(place) => Found::Far(self.car.bytes(*place)),
            None => Found::Absent,
        }
    }
}

/// The CID a dag-json link `{"/": "<cid>"}` points at.
fn link(value: &Value) -> Option<Cid> {
    let object = value.as_object()?;
    if object.len() != 1 {
        return None;
    }
    Cid::try_from(object.get("/")?.as_str()?).ok()
}

/// Every link in a value, in document order.
fn links(value: &Value, into: &mut Vec<Cid>) {
    if let Some(cid) = link(value) {
        into.push(cid);
        return;
    }
    match value {
        Value::Array(items) => items.iter().for_each(|item| links(item, into)),
        Value::Object(fields) => fields.values().for_each(|item| links(item, into)),
        _ => {}
    }
}

struct Entry {
    property: Cid,
    groups: Vec<(String, Cid)>,
}

/// What checking one shard entry found, for the main thread to merge.
#[derive(Default)]
struct Checked {
    reached: Vec<Cid>,
    far: Vec<Cid>,
    /// Links to blocks that are not in the file, with the block that links to each.
    dangling: Vec<(Cid, Cid)>,
    flagged: Vec<(Cid, String)>,
    rows: Vec<Row>,
    validated: u64,
}

/// Check one shard entry on its own: follow every link below it, then
/// validate its data groups. Touches no shared state, so entries are checked
/// on several threads; decoded blocks live only as long as the entry.
fn property(
    groups: &HashMap<String, Arc<Group>>,
    view: &View,
    shard: &Cid,
    item: &Value,
    entry: Option<&Entry>,
    times: usize,
) -> Checked {
    let mut found = Checked::default();
    let mut seen = HashSet::new();
    let mut values: HashMap<Cid, Value> = HashMap::new();
    let mut stack = Vec::new();
    let mut below = Vec::new();
    links(item, &mut below);
    stack.extend(below.iter().map(|to| (*to, *shard)));
    while let Some((cid, from)) = stack.pop() {
        if seen.contains(&cid) {
            continue;
        }
        let bytes = match view.find(&cid) {
            Found::Near(bytes) => bytes,
            Found::Far(bytes) => {
                found.far.push(cid);
                bytes
            }
            Found::Absent => {
                found.dangling.push((cid, from));
                continue;
            }
        };
        seen.insert(cid);
        found.reached.push(cid);
        if cid.codec() == RAW {
            continue;
        }
        if cid.codec() != DAG_JSON {
            found.flagged.push((cid, format!("unsupported codec 0x{:x}", cid.codec())));
            continue;
        }
        let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
            found.flagged.push((cid, "block is not dag-json".to_string()));
            continue;
        };
        below.clear();
        links(&value, &mut below);
        stack.extend(below.iter().map(|to| (*to, cid)));
        values.insert(cid, value);
    }
    let source = |pointer: &str| -> Result<Cow<'_, Value>, String> {
        let Ok(cid) = Cid::try_from(pointer) else {
            return Err(format!(
                "Failed to resolve pointer - not a valid CID and no base directory provided for relative path: {pointer}"
            ));
        };
        if let Some(value) = values.get(&cid) {
            return Ok(Cow::Borrowed(value));
        }
        let (Found::Near(bytes) | Found::Far(bytes)) = view.find(&cid) else {
            return Err(format!("block {pointer} is not in the car"));
        };
        Ok(Cow::Owned(
            serde_json::from_slice(bytes).unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).into_owned())),
        ))
    };
    // Once per listing: an index that names a shard twice holds its properties twice.
    for entry in entry.into_iter().flat_map(|entry| std::iter::repeat_n(entry, times)) {
        let mut rows = Vec::new();
        let name = entry.property.to_string();
        for (schema, data) in &entry.groups {
            let row = |path: &str, message: String| Row {
                property: name.clone(),
                group: schema.clone(),
                file: data.to_string(),
                path: path.to_string(),
                message,
                ..Row::default()
            };
            let Some(value) = values.get(data) else {
                let message = match view.find(data) {
                    Found::Absent => "data-group root is not in the car",
                    _ => "data-group root is not a dag-json block",
                };
                found.rows.push(row("lexicon", message.to_string()));
                continue;
            };
            let group = &groups[schema];
            match group.validate(value, &source) {
                None if matches!(**group, Group::Invalid) => {
                    found.rows.push(row("lexicon", format!("schema {schema} is not a valid data group schema")));
                }
                None => found.rows.push(row("lexicon", format!("could not load schema {schema}"))),
                Some(errors) => {
                    found.validated += 1;
                    rows.extend(errors.into_iter().map(|error| Row { value: error.value, ..row(&error.path, error.message) }));
                }
            }
        }
        found.rows.extend(lexicon::filter(rows));
    }
    found
}

/// What the main thread keeps across the whole file.
struct Check<'a> {
    report: &'a mut Report,
    errors: [u64; 6],
    twins: &'a HashSet<Cid>,
    /// Links to blocks that are not in the file: the block a graph walk found
    /// linking to each, or nothing once the index check has reported it.
    absent: HashMap<Cid, Option<Cid>>,
    order: Vec<Cid>,
    flagged: HashSet<Cid>,
    /// Blocks written more than once that a walk has reached.
    met: HashSet<Cid>,
    /// Blocks reached through the index of the whole file.
    far: HashSet<Cid>,
    /// Blocks no walk has reached so far: orphans when the file ends.
    loose: HashSet<Cid>,
    candidates: Vec<Cid>,
    properties: u64,
    groups: u64,
}

impl Check<'_> {
    fn write(&mut self, check: usize, row: Row) -> Result<(), Fail> {
        self.errors[check] += 1;
        self.report.write(&row)
    }

    fn note(&mut self, check: usize, file: &str, message: String) -> Result<(), Fail> {
        self.listed(check, ("", ""), file, message)
    }

    /// A finding about what a shard lists: `listed` names the property and the data group.
    fn listed(&mut self, check: usize, listed: (&str, &str), file: &str, message: String) -> Result<(), Fail> {
        let (property, group) = (listed.0.to_string(), listed.1.to_string());
        self.write(
            check,
            Row { property, group, file: file.to_string(), path: CHECKS[check].to_string(), message, ..Row::default() },
        )
    }

    /// Whether the linked block is in the file. A missing one is an index
    /// finding when a shard lists it (`listed` names the property and the data
    /// group); a graph walk only notes it for the end.
    fn resolve(&mut self, view: &View, to: &Cid, from: &Cid, listed: Option<(&str, &str)>) -> Result<bool, Fail> {
        match view.find(to) {
            Found::Near(_) => return Ok(true),
            Found::Far(_) => {
                self.far.insert(*to);
                return Ok(true);
            }
            Found::Absent => {}
        }
        let known = self.absent.contains_key(to);
        if !known {
            self.order.push(*to);
        }
        let Some((property, group)) = listed else {
            if !known {
                self.absent.insert(*to, Some(*from));
            }
            return Ok(false);
        };
        if !known || self.absent[to].is_some() {
            self.absent.insert(*to, None);
            self.listed(INDEX, (property, group), &from.to_string(), format!("link {to} is not in the car"))?;
        }
        Ok(false)
    }

    fn flag(&mut self, cid: &Cid, message: String) -> Result<(), Fail> {
        if self.flagged.insert(*cid) {
            self.note(GRAPH, &cid.to_string(), message)?;
        }
        Ok(())
    }

    fn reach(&mut self, cid: Cid, seen: &mut HashSet<Cid>) {
        if self.twins.contains(&cid) {
            self.met.insert(cid);
        }
        self.loose.remove(&cid);
        seen.insert(cid);
    }

    /// Follow every link below `start`; each block reached lands in `seen`.
    fn walk(&mut self, view: &View, start: (Cid, Cid), seen: &mut HashSet<Cid>) -> Result<(), Fail> {
        let mut stack = vec![start];
        let mut found = Vec::new();
        while let Some((cid, from)) = stack.pop() {
            if seen.contains(&cid) || !self.resolve(view, &cid, &from, None)? {
                continue;
            }
            self.reach(cid, seen);
            if cid.codec() == RAW {
                continue;
            }
            if cid.codec() != DAG_JSON {
                self.flag(&cid, format!("unsupported codec 0x{:x}", cid.codec()))?;
                continue;
            }
            let bytes = match view.find(&cid) {
                Found::Near(bytes) | Found::Far(bytes) => Some(bytes),
                Found::Absent => None,
            };
            let Some(value) = bytes.and_then(|bytes| serde_json::from_slice::<Value>(bytes).ok()) else {
                self.flag(&cid, "block is not dag-json".to_string())?;
                continue;
            };
            found.clear();
            links(&value, &mut found);
            stack.extend(found.iter().map(|to| (*to, cid)));
        }
        Ok(())
    }

    /// Read one shard's entries, reporting every malformed piece under index.
    fn entries(&mut self, view: &View, shard: &Cid, body: Option<&Value>) -> Result<Vec<Option<Entry>>, Fail> {
        let Some(listed) = body.and_then(|body| body.get("properties")).and_then(Value::as_array) else {
            self.note(INDEX, &shard.to_string(), "shard must decode to {\"properties\": [...]}".to_string())?;
            return Ok(Vec::new());
        };
        let mut entries = Vec::with_capacity(listed.len());
        for item in listed {
            let property = item.get("property_cid").and_then(link);
            let pointers = item.get("data_groups").and_then(Value::as_object);
            let (Some(property), Some(pointers)) = (property, pointers) else {
                self.note(
                    INDEX,
                    &shard.to_string(),
                    "shard entry must hold a property_cid link and a data_groups object".to_string(),
                )?;
                entries.push(None);
                continue;
            };
            let name = property.to_string();
            self.resolve(view, &property, shard, Some((&name, "")))?;
            let mut groups = Vec::with_capacity(pointers.len());
            for (schema, pointer) in pointers {
                let Some(data) = link(pointer) else {
                    self.listed(INDEX, (&name, schema), &shard.to_string(), format!("data_groups.{schema} must be a link"))?;
                    continue;
                };
                self.resolve(view, &data, shard, Some((&name, schema)))?;
                groups.push((schema.clone(), data));
            }
            entries.push(Some(Entry { property, groups }));
        }
        Ok(entries)
    }

    /// Check one shard: its entries, every link below it, and each property's
    /// data groups. Returns the blocks its walk reached.
    fn shard(
        &mut self,
        view: &View,
        lexicon: &mut Lexicon,
        schemas: &mut Schemas,
        cid: &Cid,
        times: usize,
        threads: usize,
    ) -> Result<HashSet<Cid>, Fail> {
        let top = view.top.0;
        let body: Option<Value> = view.near(cid).and_then(|bytes| serde_json::from_slice(bytes).ok());
        // Once per listing, as in `property`; the entries are the same each time.
        let mut entries = Vec::new();
        for _ in 0..times {
            entries = self.entries(view, cid, body.as_ref())?;
        }
        self.properties += (entries.iter().flatten().count() * times) as u64;
        let mut groups = HashMap::new();
        for (schema, _) in entries.iter().flatten().flat_map(|entry| &entry.groups) {
            if !groups.contains_key(schema) {
                groups.insert(schema.clone(), lexicon.group(schema, schemas));
            }
        }
        let groups = &groups;
        let items = body.as_ref().and_then(|body| body.get("properties")).and_then(Value::as_array);
        let listed = items.map_or(&[][..], Vec::as_slice);
        // Last entry first: the order of one depth-first walk from the shard block.
        let work: Vec<(&Value, Option<&Entry>)> = listed.iter().zip(entries.iter().map(Option::as_ref)).rev().collect();
        let checked = crate::spread(&work, threads, |(item, entry)| property(groups, view, cid, item, *entry, times));
        let mut seen = HashSet::new();
        for found in checked {
            for (to, from) in found.dangling {
                if let std::collections::hash_map::Entry::Vacant(slot) = self.absent.entry(to) {
                    slot.insert(Some(from));
                    self.order.push(to);
                }
            }
            for (block, message) in found.flagged {
                self.flag(&block, message)?;
            }
            self.far.extend(found.far);
            for block in found.reached {
                self.reach(block, &mut seen);
            }
            self.groups += found.validated;
            for row in found.rows {
                self.write(LEXICON, row)?;
            }
        }
        // The shard block itself and any link it holds outside its entries.
        if items.is_some() {
            let mut other = Vec::new();
            for (key, field) in body.as_ref().and_then(Value::as_object).into_iter().flatten() {
                if key != "properties" {
                    links(field, &mut other);
                }
            }
            for to in other.iter().rev() {
                self.walk(view, (*to, *cid), &mut seen)?;
            }
            self.reach(*cid, &mut seen);
        }
        // A shard that does not decode is flagged here.
        self.walk(view, (*cid, top), &mut seen)?;
        Ok(seen)
    }

    /// Let go of a segment after both shards next to it were checked. A block
    /// neither walk reached is an orphan unless another walk reaches it: an
    /// earlier walk can only have done so through the index or a second copy,
    /// and a later walk takes it back out.
    fn release(&mut self, segment: &Segment, seen: [&HashSet<Cid>; 2]) {
        for cid in segment.keys() {
            let reached = seen[0].contains(cid) || seen[1].contains(cid) || self.met.contains(cid) || self.far.contains(cid);
            if !reached && self.loose.insert(*cid) {
                self.candidates.push(*cid);
            }
        }
    }
}

struct Head {
    root: Cid,
    shards: Vec<Option<Cid>>,
    declared: Option<f64>,
}

/// Check the county index block at the single CAR root.
fn head(roots: &[Cid], bytes: Option<&[u8]>, check: &mut Check) -> Result<Option<Head>, Fail> {
    if roots.len() != 1 {
        let listed = roots.iter().map(Cid::to_string).collect::<Vec<_>>().join(" ");
        check.note(ROOT, &listed, format!("expected exactly one root, found {}", roots.len()))?;
        return Ok(None);
    }
    let root = roots[0];
    if root.codec() != DAG_JSON {
        check.note(ROOT, &root.to_string(), "root must be a dag-json block".to_string())?;
        return Ok(None);
    }
    let index: Option<Value> = bytes.and_then(|bytes| serde_json::from_slice(bytes).ok());
    let Some(index) = index.filter(|index| index.is_object() || index.is_array()) else {
        let message = if bytes.is_some() { "root block is not dag-json" } else { "root block is not in the car" };
        check.note(ROOT, &root.to_string(), message.to_string())?;
        return Ok(None);
    };
    let listed = index.get("shards").and_then(Value::as_array);
    let shards: Vec<Option<Cid>> = listed.into_iter().flatten().map(link).collect();
    let declared = index.get("properties").and_then(Value::as_f64);
    let shape = [
        (index.get("label").and_then(Value::as_str) == Some("CountyIndex"), "label must be \"CountyIndex\""),
        (index.get("version").and_then(Value::as_f64) == Some(1.0), "version must be 1"),
        (declared.is_some(), "properties must be a number"),
        (listed.is_some() && shards.iter().all(Option::is_some), "shards must be an array of links"),
    ];
    for (ok, message) in shape {
        if !ok {
            check.note(ROOT, &root.to_string(), message.to_string())?;
        }
    }
    Ok(Some(Head { root, shards, declared }))
}

/// The CIDs among `blocks` whose bytes do not hash to them, checked on `threads` cores.
fn broken(car: &Car, blocks: &[(Cid, Place)], threads: usize) -> Vec<Cid> {
    let intact = |(cid, place): &(Cid, Place)| {
        let hash = cid.hash();
        hash.code() == 0x12 && hash.digest() == Sha256::digest(car.bytes(*place)).as_slice()
    };
    crate::spread(blocks, threads, |block| (!intact(block)).then_some(block.0)).into_iter().flatten().collect()
}

pub fn validate(file: &Path, schemas: &mut Schemas, report: &mut Report, threads: usize) -> Result<Summary, Fail> {
    let car = Car::open(file)?;
    let roots = car.roots.clone();
    let mut bloom = Bloom::new(car.size());
    let mut twins = HashSet::new();

    // First read: hash every block, note every CID, find the county index.
    let mut blocks = 0u64;
    let mut top = None;
    let mut altered = Vec::new();
    let mut batch = Vec::with_capacity(1 << 16);
    let mut all = car.blocks();
    loop {
        let next = all.next().transpose()?;
        if let Some((cid, place)) = next {
            blocks += 1;
            if bloom.add(&cid) {
                twins.insert(cid);
            }
            if roots.len() == 1 && cid == roots[0] {
                top.get_or_insert(place);
            }
            batch.push((cid, place));
        }
        if batch.len() == batch.capacity() || next.is_none() {
            altered.extend(broken(&car, &batch, threads));
            batch.clear();
        }
        if next.is_none() {
            break;
        }
    }
    let mut check = Check {
        report,
        errors: [0; 6],
        twins: &twins,
        absent: HashMap::new(),
        order: Vec::new(),
        flagged: HashSet::new(),
        met: HashSet::new(),
        far: HashSet::new(),
        loose: HashSet::new(),
        candidates: Vec::new(),
        properties: 0,
        groups: 0,
    };
    for cid in altered {
        check.note(INTEGRITY, &cid.to_string(), "block bytes do not hash to their cid".to_string())?;
    }
    let mut summary = Summary { blocks, ..Summary::default() };
    let Some(head) = head(&roots, top.map(|place| car.bytes(place)), &mut check)? else {
        summary.errors = check.errors;
        return Ok(summary);
    };
    let top = (head.root, top.unwrap_or_default());

    // Second read: a shard is checked once the segments on both sides of its block are known.
    let mut lexicon = Lexicon::new();
    let index = OnceLock::new();
    let mut waiting: HashSet<Cid> = head.shards.iter().flatten().copied().collect();
    let times = |shard: &Cid| head.shards.iter().filter(|listed| **listed == Some(*shard)).count();
    let mut done = HashSet::new();
    let mut pending: Option<Cid> = None;
    let mut previous = Segment::new();
    let mut current = Segment::new();
    let mut last = HashSet::new();
    for block in car.blocks() {
        let (cid, place) = block?;
        // A second copy in the same segment adds nothing.
        current.entry(cid).or_insert(place);
        if !waiting.remove(&cid) {
            continue;
        }
        if let Some(shard) = pending {
            let view = View { car: &car, previous: &previous, current: &current, top, bloom: &bloom, index: &index };
            let seen = check.shard(&view, &mut lexicon, schemas, &shard, times(&shard), threads)?;
            check.release(&previous, [&last, &seen]);
            last = seen;
            done.insert(shard);
        }
        previous = std::mem::take(&mut current);
        pending = Some(cid);
    }
    let view = View { car: &car, previous: &previous, current: &current, top, bloom: &bloom, index: &index };
    let mut seen = HashSet::new();
    if let Some(shard) = pending {
        seen = check.shard(&view, &mut lexicon, schemas, &shard, times(&shard), threads)?;
        done.insert(shard);
    }
    // The whole file went by without these shard blocks.
    for shard in head.shards.iter().flatten() {
        if waiting.contains(shard) {
            check.resolve(&view, shard, &head.root, Some(("", "")))?;
        }
    }
    // The index itself and anything else it links to.
    seen.extend(done);
    check.walk(&view, (head.root, head.root), &mut seen)?;
    check.release(&previous, [&last, &seen]);
    check.release(&current, [&seen, &seen]);
    if let Some(declared) = head.declared.filter(|declared| *declared != check.properties as f64) {
        check.note(
            INDEX,
            &head.root.to_string(),
            format!("index declares {declared} properties but shards hold {}", check.properties),
        )?;
    }
    for cid in std::mem::take(&mut check.order) {
        if let Some(from) = check.absent[&cid] {
            check.note(GRAPH, &from.to_string(), format!("link {cid} is not in the car"))?;
        }
    }
    for cid in std::mem::take(&mut check.candidates) {
        if check.loose.contains(&cid) {
            check.note(ORPHANS, &cid.to_string(), "block is not reachable from the root".to_string())?;
        }
    }
    summary.properties = check.properties;
    summary.groups = check.groups;
    summary.lookups = check.far.len() as u64;
    summary.errors = check.errors;
    Ok(summary)
}
