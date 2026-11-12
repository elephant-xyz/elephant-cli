//! Lexicon schemas by CID: an on-disk cache in front of the IPFS gateways.

use serde_json::Value;
use std::collections::HashMap;
use std::path::PathBuf;

pub struct Schemas {
    dir: PathBuf,
    offline: bool,
    known: HashMap<String, Value>,
}

impl Schemas {
    /// `dir` defaults to `~/.elephant-cli/schema-cache`, the cache elephant-cli 1.x fills.
    pub fn new(dir: Option<PathBuf>, offline: bool) -> Schemas {
        let home = || PathBuf::from(std::env::var_os("HOME").unwrap_or_default());
        let dir = dir.unwrap_or_else(|| home().join(".elephant-cli").join("schema-cache"));
        Schemas { dir, offline, known: HashMap::new() }
    }

    /// The schema for a CID, from memory, then the cache directory, then a gateway.
    pub fn get(&mut self, cid: &str) -> Result<Value, String> {
        if let Some(known) = self.known.get(cid) {
            return Ok(known.clone());
        }
        cid::Cid::try_from(cid).map_err(|error| format!("{cid} is not a CID: {error}"))?;
        let file = self.dir.join(format!("{cid}.json"));
        let bytes = match std::fs::read(&file) {
            Ok(bytes) => bytes,
            Err(_) if self.offline => {
                return Err(format!("schema {cid} is not in {} and --offline is set", self.dir.display()))
            }
            Err(_) => return Err(format!("schema {cid} is not in {}", self.dir.display())),
        };
        let schema: Value = serde_json::from_slice(&bytes).map_err(|error| format!("{}: {error}", file.display()))?;
        if !schema.is_object() {
            return Err("Invalid JSON schema: not an object".to_string());
        }
        self.known.insert(cid.to_string(), schema.clone());
        Ok(schema)
    }
}
