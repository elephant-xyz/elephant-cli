//! Lexicon schemas by CID and the manifest that names them: an on-disk cache
//! in front of the network.
//!
//! - `ELEPHANT_SCHEMA_MANIFEST_URL` replaces the manifest URL (a local file path works too).
//! - `ELEPHANT_IPFS_GATEWAYS` replaces the gateway list (comma-separated origins).
//! - Offline, both come from the cache directory only.

use cid::Cid;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;

const MANIFEST: &str = "https://lexicon.elephant.xyz/api/manifest";
const GATEWAYS: [&str; 3] = ["https://ipfs.filebase.io", "https://gateway.pinata.cloud", "https://trustless-gateway.link"];

pub struct Schemas {
    dir: PathBuf,
    offline: bool,
    known: HashMap<String, Value>,
    manifest: Option<Value>,
}

fn http(url: &str, accept: &str, seconds: u64) -> Result<Vec<u8>, String> {
    let agent: ureq::Agent = ureq::Agent::config_builder().timeout_global(Some(Duration::from_secs(seconds))).build().into();
    let mut response = agent.get(url).header("accept", accept).call().map_err(|error| error.to_string())?;
    response.body_mut().with_config().limit(64 << 20).read_to_vec().map_err(|error| error.to_string())
}

/// The gateways to fetch blocks from, in order.
pub fn gateways() -> Vec<String> {
    let listed = std::env::var("ELEPHANT_IPFS_GATEWAYS").unwrap_or_default();
    let named: Vec<String> = listed
        .split(',')
        .map(|origin| origin.trim().trim_end_matches('/').to_string())
        .filter(|origin| !origin.is_empty())
        .collect();
    if named.is_empty() {
        return GATEWAYS.map(str::to_string).to_vec();
    }
    named
}

impl Schemas {
    /// `dir` defaults to `~/.elephant-cli/schema-cache`, the cache elephant-cli 1.x fills
    /// (`/tmp/elephant-cli/schema-cache` on Lambda and Airflow, as in 1.x).
    pub fn new(dir: Option<PathBuf>, offline: bool) -> Schemas {
        let hosted = ["AWS_LAMBDA_FUNCTION_NAME", "AIRFLOW_HOME", "AIRFLOW__CORE__DAGS_FOLDER", "AIRFLOW__CORE__EXECUTOR"]
            .iter()
            .any(|name| std::env::var_os(name).is_some());
        let home = || match hosted {
            true => PathBuf::from("/tmp/elephant-cli"),
            // USERPROFILE is the home directory on Windows, where HOME is usually unset
            false => PathBuf::from(std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")).unwrap_or_default())
                .join(".elephant-cli"),
        };
        let dir = dir.unwrap_or_else(|| home().join("schema-cache"));
        Schemas { dir, offline, known: HashMap::new(), manifest: None }
    }

    /// The bytes of a block, from the first gateway that serves bytes hashing to its CID.
    /// Whether `--offline` was given: nothing may use the network.
    pub fn offline(&self) -> bool {
        self.offline
    }

    pub fn fetch(&self, cid: &str) -> Result<Vec<u8>, String> {
        let parsed = Cid::try_from(cid).map_err(|error| format!("{cid} is not a CID: {error}"))?;
        if self.offline {
            return Err(format!("{cid} is not available: --offline is set"));
        }
        for gateway in gateways() {
            let fetched = http(&format!("{gateway}/ipfs/{cid}?format=raw"), "application/vnd.ipld.raw", 15);
            let Ok(bytes) = fetched else {
                continue;
            };
            if parsed.hash().code() == 0x12 && parsed.hash().digest() == Sha256::digest(&bytes).as_slice() {
                return Ok(bytes);
            }
        }
        Err(format!("Failed to fetch from any IPFS gateway: {cid}"))
    }

    /// The schema for a CID, from memory, then the cache directory, then a gateway.
    pub fn get(&mut self, cid: &str) -> Result<Value, String> {
        if let Some(known) = self.known.get(cid) {
            return Ok(known.clone());
        }
        Cid::try_from(cid).map_err(|error| format!("{cid} is not a CID: {error}"))?;
        let file = self.dir.join(format!("{cid}.json"));
        let cached = std::fs::read(&file).ok();
        let bytes = match (cached, self.offline) {
            (Some(bytes), _) => bytes,
            (None, true) => return Err(format!("schema {cid} is not in {} and --offline is set", self.dir.display())),
            (None, false) => self.fetch(cid)?,
        };
        let schema: Value = serde_json::from_slice(&bytes).map_err(|error| format!("schema {cid}: {error}"))?;
        if !schema.is_object() {
            return Err("Invalid JSON schema: not an object".to_string());
        }
        if !file.exists() {
            let _ = std::fs::create_dir_all(&self.dir);
            let _ = std::fs::write(&file, schema.to_string());
        }
        self.known.insert(cid.to_string(), schema.clone());
        Ok(schema)
    }

    /// The lexicon manifest: `{"<name>": {"ipfsCid": "...", "type": "dataGroup" | "class" | "relationship"}}`.
    /// Fetched once per run and kept as `manifest.json` in the cache directory for offline runs.
    fn manifest(&mut self) -> Result<&Value, String> {
        if self.manifest.is_none() {
            let kept = self.dir.join("manifest.json");
            let url = std::env::var("ELEPHANT_SCHEMA_MANIFEST_URL").unwrap_or_else(|_| MANIFEST.to_string());
            let fresh = match (self.offline, url.starts_with("http://") || url.starts_with("https://")) {
                (true, _) => Err("--offline is set".to_string()),
                (false, true) => http(&url, "application/json", 30),
                (false, false) => std::fs::read(&url).map_err(|error| format!("{url}: {error}")),
            };
            let parsed = |bytes: Vec<u8>| serde_json::from_slice::<Value>(&bytes).map_err(|error| error.to_string());
            let manifest = match fresh.and_then(parsed) {
                Ok(manifest) => {
                    let _ = std::fs::create_dir_all(&self.dir);
                    let _ = std::fs::write(&kept, manifest.to_string());
                    manifest
                }
                Err(reason) => std::fs::read(&kept).map_err(|_| reason.clone()).and_then(parsed).map_err(|_| {
                    format!("Failed to load schema manifest from Elephant Network ({reason}; no copy in {})", kept.display())
                })?,
            };
            self.manifest = Some(manifest);
        }
        Ok(self.manifest.as_ref().expect("just loaded"))
    }

    /// The schema CID of the data group a root file's `label` names, if the manifest has one.
    pub fn group(&mut self, label: &str) -> Result<Option<String>, String> {
        let manifest = self.manifest()?;
        let spellings = [label.to_string(), label.replace(' ', "_"), label.replace('_', " ")];
        let Some(entry) = spellings.iter().find_map(|name| manifest.get(name)) else {
            return Ok(None);
        };
        if entry.get("type").and_then(Value::as_str) != Some("dataGroup") {
            return Ok(None);
        }
        Ok(entry.get("ipfsCid").and_then(Value::as_str).map(str::to_string))
    }
}
