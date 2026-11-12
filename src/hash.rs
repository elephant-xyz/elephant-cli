//! `hash`: give every JSON file a data group reaches its canonical bytes and
//! CID, and pack the result as a hashed ZIP per property, a CSV of data-group
//! CIDs and a county CAR.
//!
//! Bytes and CIDs are those elephant-cli 1.x produced: links
//! `{"/": "./file.json"}` become `{"/": "<cid>"}` depth first, JSON is
//! canonicalised (see `canonical`), and the CAR holds each property's blocks
//! right before the shard block that lists it.

use crate::canonical::canonical;
use crate::car;
use crate::cids::{self, RAW};
use crate::property::Property;
use crate::validate::{scan, Shared};
use crate::Fail;
use serde_json::{Map, Value};
use std::collections::BTreeMap;
use std::fs::File;
use std::io::{BufWriter, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// The Seed data group schema elephant-cli 1.x hard-coded, next to the manifest's `Seed`.
const SEED: &str = "bafkreif7ywbjxu3s6jfi6ginvmsufeux3cd5eujuivg2y7tmqt2qk4rsoe";
const IMAGES: [&str; 6] = ["png", "jpg", "jpeg", "gif", "svg", "webp"];
/// Properties per shard block of the county index.
const SHARD: usize = 5000;

fn image(name: &str) -> bool {
    name.rsplit_once('.').is_some_and(|(_, extension)| IMAGES.contains(&extension.to_lowercase().as_str()))
}

/// One property, hashed.
pub struct Hashed {
    /// The CID of its link-resolved Seed data group.
    pub cid: String,
    /// One per data-group root: schema CID, root CID, file name. The seed comes first.
    pub groups: Vec<(String, String, String)>,
    /// Every JSON block reached, by CID.
    pub blocks: BTreeMap<String, Vec<u8>>,
    /// Roots that could not be hashed: file name and reason.
    pub errors: Vec<(String, String)>,
}

struct Work<'a> {
    property: &'a Property,
    blocks: BTreeMap<String, Vec<u8>>,
    /// The files being hashed, outermost first, to stop a cycle of links.
    open: Vec<String>,
}

impl Work<'_> {
    /// The CID a pointer to a file resolves to; a JSON file becomes a block.
    fn file(&mut self, pointer: &str, folder: &str) -> Result<String, String> {
        let name = format!("{folder}{}", pointer.strip_prefix("./").unwrap_or(pointer));
        let json = name.to_lowercase().ends_with(".json");
        if !image(&name) && !json {
            return Err(format!("cannot link {pointer}: only JSON and image files can be linked"));
        }
        let missing = || format!("ENOENT: no such file or directory, open '{}'", self.property.path(&name));
        let bytes = self.property.read(&name).ok_or_else(missing)?;
        if !json {
            return Ok(cids::of(RAW, &bytes).to_string());
        }
        if self.open.contains(&name) {
            return Err(format!("{name} links back to itself through {}", self.open.join(" -> ")));
        }
        let value: Value = serde_json::from_slice(&bytes).map_err(|error| format!("{name}: {error}"))?;
        self.open.push(name.clone());
        let folder = name.rsplit_once('/').map_or(String::new(), |(folder, _)| format!("{folder}/"));
        let resolved = self.resolve(&value, None, &folder)?;
        self.open.pop();
        Ok(self.block(&resolved))
    }

    fn block(&mut self, value: &Value) -> String {
        let text = canonical(value);
        let cid = cids::of_json(value, &text).to_string();
        self.blocks.insert(cid.clone(), text.into_bytes());
        cid
    }

    /// Replace file pointers by CIDs, and `ipfs_url` values by `ipfs://` URIs.
    fn resolve(&mut self, value: &Value, field: Option<&str>, folder: &str) -> Result<Value, String> {
        match value {
            Value::String(text) if field == Some("ipfs_url") => Ok(Value::String(match text {
                text if text.starts_with("ipfs://") => text.clone(),
                text if cids::parses(text) => format!("ipfs://{text}"),
                text if image(text) => format!("ipfs://{}", self.file(text, folder)?),
                text => text.clone(),
            })),
            Value::Array(items) => {
                items.iter().map(|item| self.resolve(item, field, folder)).collect::<Result<_, _>>().map(Value::Array)
            }
            Value::Object(fields) => {
                if let (1, Some(Value::String(pointer))) = (fields.len(), fields.get("/")) {
                    if cids::parses(pointer) {
                        return Ok(value.clone());
                    }
                    let mut link = Map::new();
                    link.insert("/".to_string(), Value::String(self.file(pointer, folder)?));
                    return Ok(Value::Object(link));
                }
                let mut resolved = Map::with_capacity(fields.len());
                for (key, inner) in fields {
                    resolved.insert(key.clone(), self.resolve(inner, Some(key), folder)?);
                }
                Ok(Value::Object(resolved))
            }
            other => Ok(other.clone()),
        }
    }
}

/// Hash one property. `Err` means nothing could be hashed.
pub fn property(property: &Property, shared: &Mutex<Shared>) -> Result<Hashed, String> {
    let found = scan(property, shared)?;
    let seed = shared.lock().expect("shared state").schemas.group("Seed")?;
    let seeded = |cid: &String| cid == SEED || Some(cid) == seed.as_ref();
    let Some(first) = found.roots.iter().position(|(_, cid)| seeded(cid)) else {
        return Err("Property CID could not be determined: the property has no Seed data group".to_string());
    };
    let mut hashed = Hashed {
        // Until the seed resolves, the property goes by the CID of the seed file as written.
        cid: cids::of_json(&found.parsed[&found.roots[first].0], &canonical(&found.parsed[&found.roots[first].0])).to_string(),
        groups: Vec::new(),
        blocks: BTreeMap::new(),
        errors: Vec::new(),
    };
    let order = std::iter::once(first).chain((0..found.roots.len()).filter(|at| *at != first));
    for at in order {
        let (name, group) = &found.roots[at];
        let mut work = Work { property, blocks: BTreeMap::new(), open: vec![name.clone()] };
        let resolved = match work.resolve(&found.parsed[name], None, "") {
            Ok(resolved) => resolved,
            Err(reason) => {
                hashed.errors.push((name.clone(), format!("Processing error: {reason}")));
                continue;
            }
        };
        let cid = work.block(&resolved);
        if at == first {
            hashed.cid = cid.clone();
        }
        hashed.blocks.append(&mut work.blocks);
        hashed.groups.push((group.clone(), cid, name.clone()));
    }
    Ok(hashed)
}

/// Write a property's hashed ZIP: `<property cid>/<cid>.json` for every block
/// and `<property cid>/<name>` for every image directly in the property.
pub fn zip(file: &Path, property: &Property, hashed: &Hashed) -> Result<(), String> {
    let mut entries: BTreeMap<String, Vec<u8>> =
        hashed.blocks.iter().map(|(cid, bytes)| (format!("{}/{cid}.json", hashed.cid), bytes.clone())).collect();
    for name in property.names().into_iter().filter(|name| image(name)) {
        let bytes = property.read(&name).ok_or_else(|| format!("cannot read {name}"))?;
        entries.insert(format!("{}/{name}", hashed.cid), bytes.into_owned());
    }
    let failed = |error: &dyn std::fmt::Display| format!("cannot write {}: {error}", file.display());
    if let Some(parent) = file.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent).map_err(|error| failed(&error))?;
    }
    let mut writer = zip::ZipWriter::new(File::create(file).map_err(|error| failed(&error))?);
    let options = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    for (name, bytes) in entries {
        writer.start_file(name, options).map_err(|error| failed(&error))?;
        writer.write_all(&bytes).map_err(|error| failed(&error))?;
    }
    writer.finish().map_err(|error| failed(&error))?;
    Ok(())
}

/// A county CAR being written: each property's blocks, a shard block after
/// every `SHARD` properties, and the county index last.
pub struct Archive {
    path: PathBuf,
    out: BufWriter<File>,
    pending: Vec<String>,
    shards: Vec<String>,
    properties: u64,
    blocks: u64,
}

fn linked(cid: &str) -> String {
    format!("{{\"/\":\"{cid}\"}}")
}

impl Archive {
    pub fn create(path: &Path) -> Result<Archive, Fail> {
        if let Some(parent) = path.parent().filter(|parent| !parent.as_os_str().is_empty()) {
            std::fs::create_dir_all(parent)?;
        }
        let mut out = BufWriter::new(File::create(path).map_err(|error| format!("cannot write {}: {error}", path.display()))?);
        // The root is only known at the end: a placeholder of the same length holds its place.
        out.write_all(&car::header(&[cids::of(cids::DAG_JSON, b"{}")]))?;
        Ok(Archive { path: path.to_path_buf(), out, pending: Vec::new(), shards: Vec::new(), properties: 0, blocks: 0 })
    }

    fn put(&mut self, json: String) -> Result<String, Fail> {
        let cid = cids::of(cids::DAG_JSON, json.as_bytes());
        car::put(&mut self.out, &cid, json.as_bytes())?;
        self.blocks += 1;
        Ok(cid.to_string())
    }

    fn shard(&mut self) -> Result<(), Fail> {
        let shard = self.put(format!("{{\"properties\":[{}]}}", self.pending.join(",")))?;
        self.shards.push(shard);
        self.pending.clear();
        Ok(())
    }

    /// Append a property's blocks, in CID order, and list it in the current shard.
    pub fn add(&mut self, hashed: &Hashed) -> Result<(), Fail> {
        for (cid, bytes) in &hashed.blocks {
            car::put(&mut self.out, &cid::Cid::try_from(cid.as_str())?, bytes)?;
            self.blocks += 1;
        }
        // One entry per schema; of two roots with the same schema the later file wins.
        let groups: BTreeMap<&str, &str> = hashed.groups.iter().map(|(group, cid, _)| (group.as_str(), cid.as_str())).collect();
        let listed: Vec<String> = groups.iter().map(|(group, cid)| format!("\"{group}\":{}", linked(cid))).collect();
        self.pending.push(format!("{{\"data_groups\":{{{}}},\"property_cid\":{}}}", listed.join(","), linked(&hashed.cid)));
        self.properties += 1;
        if self.pending.len() == SHARD {
            self.shard()?;
        }
        Ok(())
    }

    /// Write the last shard and the index, and put the index CID in the header.
    /// Returns the number of blocks in the file and the root.
    pub fn close(mut self) -> Result<(u64, String), Fail> {
        if !self.pending.is_empty() {
            self.shard()?;
        }
        let shards: Vec<String> = self.shards.iter().map(|shard| linked(shard)).collect();
        let root = self.put(format!(
            "{{\"label\":\"CountyIndex\",\"properties\":{},\"shards\":[{}],\"version\":1}}",
            self.properties,
            shards.join(",")
        ))?;
        self.out.seek(SeekFrom::Start(0))?;
        self.out.write_all(&car::header(&[cid::Cid::try_from(root.as_str())?]))?;
        self.out.flush()?;
        Ok((self.blocks, root))
    }

    /// Remove the unfinished file.
    pub fn abort(self) {
        drop(self.out);
        let _ = std::fs::remove_file(&self.path);
    }
}

/// What a `hash` run produced.
pub struct Outcome {
    pub properties: usize,
    /// Properties that failed entirely or had a root that could not be hashed.
    pub failed: Vec<String>,
    /// `<property>: <file>: <reason>` for everything that went wrong.
    pub errors: Vec<String>,
    pub groups: usize,
    /// The property CID, when the input was a single property.
    pub cid: Option<String>,
    /// Blocks in the CAR and its root, when one was asked for.
    pub car: Option<(u64, String)>,
}

/// Hash a single property or every property of a batch directory.
pub fn run(
    input: &Path,
    output_zip: &Path,
    output_csv: &Path,
    output_car: Option<&Path>,
    shared: &Mutex<Shared>,
    threads: usize,
) -> Result<Outcome, Fail> {
    let children = crate::property::children(input);
    let single = children.is_empty();
    let names = match single {
        true => vec![crate::property::stem(input)],
        false => crate::property::stems(&children, input)?,
    };
    if !single && output_zip.is_file() {
        return Err(format!(
            "Output ZIP path {} is a file; with a directory input it must be a directory that receives one ZIP per property",
            output_zip.display()
        )
        .into());
    }
    let inputs: Vec<(PathBuf, PathBuf)> = match single {
        true => vec![(input.to_path_buf(), output_zip.to_path_buf())],
        false => {
            children.iter().zip(&names).map(|(child, name)| (child.clone(), output_zip.join(format!("{name}.zip")))).collect()
        }
    };
    let work = |(from, to): &(PathBuf, PathBuf)| -> Result<Hashed, String> {
        let opened = Property::open(from)?;
        let hashed = property(&opened, shared)?;
        zip(to, &opened, &hashed)?;
        Ok(hashed)
    };
    if let Some(parent) = output_csv.parent().filter(|parent| !parent.as_os_str().is_empty()) {
        std::fs::create_dir_all(parent)?;
    }
    let mut csv =
        BufWriter::new(File::create(output_csv).map_err(|error| format!("cannot write {}: {error}", output_csv.display()))?);
    writeln!(csv, "propertyCid,dataGroupCid,dataCid,filePath,uploadedAt")?;
    let mut archive = output_car.map(Archive::create).transpose()?;
    let mut outcome =
        Outcome { properties: names.len(), failed: Vec::new(), errors: Vec::new(), groups: 0, cid: None, car: None };
    let mut done = 0;
    // A slice of the batch at a time: hashed on every core, written in order.
    for slice in inputs.chunks(threads * 64) {
        let results: Vec<Result<Hashed, String>> = std::thread::scope(|scope| {
            let work = &work;
            let workers: Vec<_> = slice
                .chunks(slice.len().div_ceil(threads).max(1))
                .map(|chunk| scope.spawn(move || chunk.iter().map(work).collect::<Vec<_>>()))
                .collect();
            workers.into_iter().flat_map(|worker| worker.join().expect("worker thread")).collect()
        });
        for result in results {
            let name = &names[done];
            done += 1;
            let hashed = match result {
                Ok(hashed) => hashed,
                Err(reason) if single => {
                    if let Some(archive) = archive {
                        archive.abort();
                    }
                    drop(csv);
                    let _ = std::fs::remove_file(output_csv);
                    return Err(reason.into());
                }
                Err(reason) => {
                    outcome.errors.push(format!("{name}: {reason}"));
                    outcome.failed.push(name.clone());
                    continue;
                }
            };
            for (group, cid, file) in &hashed.groups {
                writeln!(csv, "{},{group},{cid},{file},", hashed.cid)?;
            }
            if let Some(archive) = archive.as_mut() {
                archive.add(&hashed)?;
            }
            outcome.groups += hashed.groups.len();
            outcome.errors.extend(hashed.errors.iter().map(|(file, reason)| format!("{name}: {file}: {reason}")));
            if !hashed.errors.is_empty() {
                outcome.failed.push(name.clone());
            }
            outcome.cid = single.then_some(hashed.cid);
        }
    }
    csv.flush()?;
    if let Some(archive) = archive {
        outcome.car = Some(archive.close()?);
    }
    Ok(outcome)
}
