//! CIDs as elephant data uses them: CIDv1, sha2-256, dag-json for JSON that
//! is valid DAG-JSON and raw for everything else.

use cid::multihash::Multihash;
use cid::Cid;
use serde_json::Value;
use sha2::{Digest, Sha256};

pub const DAG_JSON: u64 = 0x0129;
pub const RAW: u64 = 0x55;

/// Whether a string is a CID the way `CID.parse` of js-multiformats reads one:
/// `Qm...` (CIDv0) or a multibase string in base32 (`b`), base58btc (`z`) or
/// base36 (`k`). Elephant data was written against that parser, so a string
/// it rejects is a file path, not a link.
pub fn parses(text: &str) -> bool {
    let known = (text.len() == 46 && text.starts_with("Qm")) || text.starts_with(['b', 'z', 'k']);
    known && Cid::try_from(text).is_ok()
}

pub fn of(codec: u64, bytes: &[u8]) -> Cid {
    let hash = Multihash::<64>::wrap(0x12, &Sha256::digest(bytes)).expect("a sha2-256 digest fits");
    Cid::new_v1(codec, hash)
}

/// Keys in the order RFC 8785 and DAG-JSON write them: by UTF-16 code units.
pub fn order(a: &str, b: &str) -> std::cmp::Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// Names every JavaScript object inherits. js-dag-json mistakes such a key for
/// a duplicate and refuses the block, so elephant-cli 1.x gave it a raw CID.
const INHERITED: [&str; 11] = [
    "constructor",
    "toString",
    "valueOf",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

/// Whether js-dag-json decodes this JSON: the test elephant-cli 1.x used to
/// choose between the dag-json and the raw codec.
pub fn dag_json(value: &Value) -> bool {
    match value {
        Value::Array(items) => items.iter().all(dag_json),
        Value::Object(fields) => {
            if fields.keys().any(|key| INHERITED.contains(&key.as_str())) {
                return false;
            }
            let first = fields.keys().min_by(|a, b| order(a, b));
            let alone = fields.len() == 1;
            match fields.get("/").filter(|_| first.is_some_and(|key| key == "/")) {
                // a link
                Some(Value::String(text)) => alone && parses(text),
                // bytes: `{"/": {"bytes": "<base64>"}}`
                Some(Value::Object(inner))
                    if inner.keys().min_by(|a, b| order(a, b)).is_some_and(|key| key == "bytes")
                        && inner["bytes"].is_string() =>
                {
                    let text = inner["bytes"].as_str().unwrap_or_default();
                    let base64 = text.len() % 4 != 1
                        && text.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/');
                    alone && inner.len() == 1 && base64
                }
                _ => fields.values().all(dag_json),
            }
        }
        _ => true,
    }
}

/// The CID of a JSON block whose bytes are `canonical`.
pub fn of_json(value: &Value, canonical: &str) -> Cid {
    of(if dag_json(value) { DAG_JSON } else { RAW }, canonical.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// The codec elephant-cli 1.58.1 chose for each of these (verified by running it).
    #[test]
    fn chooses_the_codec_elephant_cli_1_chose() {
        let cid = "bafkreihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku";
        for value in [json!({"a": 1}), json!(null), json!("str"), json!([]), json!(1.5), json!({"/": cid})] {
            assert!(dag_json(&value), "{value}");
        }
        assert!(dag_json(&json!({"/": "QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG"})));
        assert!(dag_json(&json!({"!": 1, "/": "notacid"})));
        assert!(dag_json(&json!({"/": {"bytes": "AQID"}})));
        assert!(dag_json(&json!({"/": {"bytes": 1}})));
        assert!(dag_json(&json!({"/": 5})));
        for value in [
            json!({"/": "./x.json"}),
            json!({"a": {"/": "./x.json"}}),
            json!({"/": cid, "z": 1}),
            json!({"/": {"bytes": "@@"}}),
            json!({"/": {"bytes": "AQID", "x": 1}}),
            json!({"/": cid.to_uppercase()}),
            json!({"constructor": 1}),
            json!({"toString": "x"}),
        ] {
            assert!(!dag_json(&value), "{value}");
        }
    }
}
