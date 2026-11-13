//! `upload`: hand a county CAR, or the tables directory `export-tables`
//! wrote, to an IPFS node over the Kubo RPC API, and prove it arrived.
//!
//! A CAR is imported whole (`dag/import`); the node must report the root the
//! archive declares, and a gateway must serve the root block with bytes that
//! hash to it. For tables, every part is added first and the node's CID for
//! it must equal the one `tables.car` records.

use crate::car::Car;
use crate::report::now;
use crate::Fail;
use cid::Cid;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Cursor, Read};
use std::path::Path;
use std::time::{Duration, Instant};

pub struct Target {
    pub api: String,
    token: Option<String>,
    gateway: String,
    timeout: Duration,
}

impl Target {
    /// Options win over `IPFS_API`, `IPFS_API_TOKEN` and `ELEPHANT_CAR_GATEWAY`;
    /// with all three `FILEBASE_*` variables set they make the token.
    pub fn new(api: Option<&str>, token: Option<&str>, gateway: Option<&str>, timeout: &str) -> Result<Target, Fail> {
        let set = |name: &str| std::env::var(name).ok().filter(|value| !value.is_empty());
        let given = |option: Option<&str>| option.filter(|value| !value.is_empty()).map(str::to_string);
        let seconds: f64 = timeout
            .parse()
            .ok()
            .filter(|seconds: &f64| seconds.is_finite() && *seconds > 0.0)
            .ok_or_else(|| format!("--timeout must be a number of seconds greater than zero, got {timeout}"))?;
        let api = given(api).or_else(|| set("IPFS_API")).unwrap_or_else(|| "http://127.0.0.1:5001".to_string());
        let api = api.trim_end_matches('/').to_string();
        let Some((_, rest)) = api.split_once("://").filter(|(scheme, rest)| !scheme.is_empty() && !rest.is_empty()) else {
            return Err(format!("--api must be a URL with a scheme, got {api}").into());
        };
        let filebase = || {
            let parts = [set("FILEBASE_ACCESS_KEY")?, set("FILEBASE_SECRET_KEY")?, set("FILEBASE_BUCKET")?];
            Some(cid::multibase::Base::Base64Pad.encode(parts.join(":")))
        };
        let hosted = rest.split('/').next() == Some("rpc.filebase.io");
        let gateway = given(gateway).or_else(|| set("ELEPHANT_CAR_GATEWAY")).unwrap_or_else(|| match hosted {
            true => "https://ipfs.filebase.io".to_string(),
            false => "http://127.0.0.1:8080".to_string(),
        });
        Ok(Target {
            token: given(token).or_else(|| set("IPFS_API_TOKEN")).or_else(filebase),
            gateway: gateway.trim_end_matches('/').to_string(),
            timeout: Duration::from_secs_f64(seconds),
            api,
        })
    }

    /// POST a file as the one field of a multipart form; the file is streamed, not loaded.
    fn post(&self, call: &str, file: &Path) -> Result<(u16, String), Fail> {
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
        let boundary = format!("----elephant-cli-{stamp:x}-{:x}", std::process::id());
        let name = file.file_name().unwrap_or_default().to_string_lossy();
        let head = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\n"
        );
        let tail = format!("\r\n--{boundary}--\r\n");
        let length = head.len() as u64 + std::fs::metadata(file)?.len() + tail.len() as u64;
        let mut body = Cursor::new(head.into_bytes()).chain(File::open(file)?).chain(Cursor::new(tail.into_bytes()));
        let agent: ureq::Agent = ureq::Agent::config_builder().http_status_as_error(false).build().into();
        let mut request = agent
            .post(format!("{}/api/v0/{call}", self.api))
            .header("content-type", format!("multipart/form-data; boundary={boundary}"))
            .header("content-length", length.to_string());
        if let Some(token) = &self.token {
            request = request.header("authorization", format!("Bearer {token}"));
        }
        let mut response = request.send(ureq::SendBody::from_reader(&mut body))?;
        let status = response.status();
        let text = response.body_mut().with_config().limit(64 << 20).read_to_string()?;
        if !status.is_success() {
            let call = call.split('?').next().unwrap_or(call);
            return Err(format!("{call} failed: {} {}: {text}", status.as_u16(), status.canonical_reason().unwrap_or("")).into());
        }
        Ok((status.as_u16(), text))
    }
}

/// What a gateway answered: its `Content-Range` header and the body.
type Served = (Option<String>, Vec<u8>);

/// GET from a gateway. `None` for anything but a 2xx answer.
fn get(url: &str, range: bool, within: Duration) -> Result<Option<Served>, Fail> {
    let agent: ureq::Agent =
        ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(within)).build().into();
    let request = agent.get(url);
    let request = if range { request.header("range", "bytes=0-0") } else { request };
    let mut response = request.call()?;
    if !response.status().is_success() {
        return Ok(None);
    }
    let ranged = response.headers().get("content-range").and_then(|value| value.to_str().ok()).map(str::to_string);
    Ok(Some((ranged, response.body_mut().with_config().limit(1 << 30).read_to_vec()?)))
}

/// Try `step` every two seconds until it gives a value or the time is up.
fn poll<T>(deadline: Instant, what: &str, mut step: impl FnMut(Duration) -> Result<Option<T>, Fail>) -> Result<T, Fail> {
    let mut reason = String::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now()).max(Duration::from_millis(1));
        match step(left) {
            Ok(Some(value)) => return Ok(value),
            Ok(None) => {}
            Err(error) => reason = format!(": {error}"),
        }
        if Instant::now() >= deadline {
            return Err(format!("Timed out waiting for {what}{reason}").into());
        }
        std::thread::sleep(Duration::from_secs(2).min(deadline.saturating_duration_since(Instant::now())));
    }
}

/// The JSON objects of an NDJSON answer.
fn lines(text: &str) -> Result<Vec<Value>, Fail> {
    let kept = text.lines().filter(|line| line.trim_start().starts_with('{'));
    Ok(kept.map(serde_json::from_str).collect::<Result<_, _>>()?)
}

/// Whether two CID strings name the same bytes, whatever their codecs.
fn same(a: &str, b: &Cid) -> bool {
    Cid::try_from(a).is_ok_and(|a| a.hash() == b.hash())
}

pub struct Imported {
    pub root: Cid,
    pub blocks: u64,
    pub gateway_url: String,
    pub uploaded_at: String,
}

/// Import a CAR and read its root block back through the gateway.
pub fn car(file: &Path, target: &Target) -> Result<Imported, Fail> {
    let roots = Car::open(file)?.roots;
    let [root] = roots[..] else {
        return Err(format!("Expected one root in {}, found {}", file.display(), roots.len()).into());
    };
    if root.hash().code() != 0x12 {
        return Err(format!(
            "Unsupported root hash: {root} uses multihash code {}, only sha2-256 roots can be verified",
            root.hash().code()
        )
        .into());
    }
    let (_, text) = target.post("dag/import?pin-roots=true&stats=true", file)?;
    let answers = lines(&text)?;
    let reported: Vec<&Value> = answers.iter().filter_map(|answer| answer.get("Root")).collect();
    let [node] = reported[..] else {
        return Err(format!("dag/import returned {} roots, expected one; response: {text}", reported.len()).into());
    };
    let named = node["Cid"]["/"].as_str().unwrap_or_default();
    if let Some(problem) = node["PinErrorMsg"].as_str().filter(|problem| !problem.is_empty()) {
        return Err(format!("Pinning {named} failed: {problem}").into());
    }
    if !same(named, &root) {
        return Err(format!("dag/import reported root {named} but the CAR root is {root}").into());
    }
    let blocks = answers.iter().find_map(|answer| answer["Stats"]["BlockCount"].as_u64()).unwrap_or(0);
    let uploaded_at = now();
    let gateway_url = format!("{}/ipfs/{root}", target.gateway);
    let deadline = Instant::now() + target.timeout;
    let bytes = poll(deadline, &format!("{gateway_url} to resolve"), |left| {
        Ok(get(&format!("{gateway_url}?format=raw"), false, left)?.map(|(_, bytes)| bytes))
    })?;
    let digest = Sha256::digest(&bytes);
    if root.hash().digest() != digest.as_slice() {
        let served = crate::cids::of(root.codec(), &bytes);
        return Err(format!("Gateway bytes for {root} hash to {served}, not the root").into());
    }
    Ok(Imported { root, blocks, gateway_url, uploaded_at })
}

pub struct Tables {
    pub imported: Imported,
    pub county_root: String,
    pub parts: usize,
}

/// The size a gateway serves at `url`, asked for with a one-byte range first.
fn served(url: &str, within: Duration) -> Result<Option<u64>, Fail> {
    let Some((ranged, _)) = get(url, true, within)? else {
        return Ok(None);
    };
    let total = ranged.and_then(|ranged| ranged.rsplit('/').next().and_then(|total| total.parse().ok()));
    match total {
        Some(total) => Ok(Some(total)),
        None => Ok(get(url, false, within)?.map(|(_, bytes)| bytes.len() as u64)),
    }
}

/// Add every part of a tables directory, import `tables.car`, and read the first part back.
pub fn tables(dir: &Path, target: &Target) -> Result<Tables, Fail> {
    let index = dir.join("tables.car");
    let archive = Car::open(&index)?;
    let blocks: Vec<_> = archive.blocks().collect::<Result<_, _>>()?;
    let document: Option<Value> = match (&archive.roots[..], &blocks[..]) {
        ([root], [(cid, place)]) if root == cid => serde_json::from_slice(archive.bytes(*place)).ok(),
        _ => None,
    };
    let link = |value: &Value| value["/"].as_str().and_then(|text| Cid::try_from(text).ok());
    let held = document.as_ref().filter(|document| document["label"] == "CountyTables");
    let (Some(county), Some(listed)) =
        (held.and_then(|held| link(&held["county_root"])), held.and_then(|held| held["tables"].as_object()))
    else {
        return Err(format!("{} does not hold a CountyTables root", index.display()).into());
    };
    // Every part is checked on disk before anything is sent.
    let mut parts = Vec::new();
    for (table, entry) in listed {
        for (at, part) in entry["parts"].as_array().into_iter().flatten().enumerate() {
            let file = dir.join(table).join(format!("part-{at:05}.parquet"));
            let Some(cid) = link(&part["cid"]) else {
                return Err(format!("{} records no CID for {table} part {at}", index.display()).into());
            };
            let Ok(found) = std::fs::metadata(&file) else {
                return Err(format!("{} is missing but {} records it", file.display(), index.display()).into());
            };
            let recorded = part["bytes"].as_u64().unwrap_or(0);
            if found.len() != recorded {
                return Err(
                    format!("{} is {} bytes but {} records {recorded}", file.display(), found.len(), index.display()).into()
                );
            }
            parts.push((table.clone(), at, file, cid, recorded));
        }
    }
    for (_, _, file, cid, _) in &parts {
        let (_, text) = target
            .post("add?pin=true&cid-version=1&raw-leaves=true&chunker=size-262144", file)
            .map_err(|error| error.to_string().replacen("add failed:", &format!("add failed for {}:", file.display()), 1))?;
        let answers = lines(&text)?;
        let hash = answers.iter().find_map(|answer| answer["Hash"].as_str());
        if !hash.is_some_and(|hash| same(hash, cid)) {
            return Err(
                format!("add returned {} for {} but the index records {cid}", hash.unwrap_or("no CID"), file.display()).into()
            );
        }
    }
    let imported = car(&index, target)?;
    if let Some((table, at, _, cid, recorded)) = parts.first() {
        let deadline = Instant::now() + target.timeout;
        let what = format!("{table} part {at} to resolve on {}", target.gateway);
        let size = poll(deadline, &what, |left| {
            let by_path = served(&format!("{}/tables/{table}/parts/{at}/cid", imported.gateway_url), left)?;
            match by_path {
                Some(size) => Ok(Some(size)),
                None => served(&format!("{}/ipfs/{cid}", target.gateway), left),
            }
        })?;
        if size != *recorded {
            return Err(format!("Gateway serves {size} bytes for {cid} but the index records {recorded}").into());
        }
    }
    Ok(Tables { imported, county_root: county.to_string(), parts: parts.len() })
}
