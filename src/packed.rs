//! Packed data groups: one block holding a data group's root, its
//! relationships and the entities they link, instead of one block each.
//!
//! ```text
//! { "entities":      { "<entity cid>": <entity>, ... },
//!   "label":         <label>,
//!   "relationships": { "<key>": null | REL | [REL, ...] } }
//! ```
//!
//! A REL is a relationship block whose `from` and `to` hold the CID of an
//! entity as a plain string: `{"/": ...}` would be a real link in dag-json,
//! and the entity is not a block of its own. A root is packed when it is an
//! object with an `entities` member; `unpack` gives back the linked form,
//! with the CIDs the linked layout has, for the code that reads that.

use crate::canonical::canonical;
use crate::cids;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashMap, HashSet};

/// The largest packed block, in canonical bytes; a bigger data group stays linked.
const LIMIT: usize = 1 << 20;

/// The target of a link: an object holding only `"/"` with a string.
fn link(value: &Value) -> Option<&str> {
    value.as_object().filter(|fields| fields.len() == 1)?.get("/")?.as_str()
}

/// Whether a value holds a link anywhere.
fn linked(value: &Value) -> bool {
    match value {
        Value::Array(items) => items.iter().any(linked),
        Value::Object(fields) => link(value).is_some() || fields.values().any(linked),
        _ => false,
    }
}

/// Pack the data group whose linked root is the block `root` of `blocks`:
/// the CID and the canonical bytes of the packed block. `None` when the data
/// group has to stay linked: it is the Seed, it holds something other than
/// relationships linking two link-free entities of `blocks`, or it is too big.
pub fn pack(root: &str, blocks: &BTreeMap<String, Vec<u8>>) -> Option<(String, Vec<u8>)> {
    let read = |cid: &str| serde_json::from_slice::<Value>(blocks.get(cid)?).ok();
    // The canonical bytes, so a list of relationships is in the order of the linked root.
    let top = read(root)?;
    let fields = top.as_object().filter(|fields| fields.len() == 2)?;
    let label = fields.get("label").filter(|label| *label != "Seed")?;
    let mut entities = Map::new();
    let mut pack = |item: &Value| -> Option<Value> {
        let mut relation = read(link(item)?)?;
        for end in ["from", "to"] {
            let side = relation.as_object_mut()?.get_mut(end)?;
            let cid = link(side)?.to_string();
            let entity = read(&cid).filter(|entity| !linked(entity))?;
            entities.insert(cid.clone(), entity);
            *side = Value::String(cid);
        }
        (!linked(&relation)).then_some(relation)
    };
    let mut relationships = Map::new();
    for (key, value) in fields.get("relationships")?.as_object()? {
        let packed = match value {
            Value::Null => Value::Null,
            Value::Array(items) => Value::Array(items.iter().map(&mut pack).collect::<Option<_>>()?),
            item => pack(item)?,
        };
        relationships.insert(key.clone(), packed);
    }
    let value = json!({ "entities": entities, "label": label, "relationships": relationships });
    let text = canonical(&value);
    (text.len() <= LIMIT).then(|| (cids::of_json(&value, &text).to_string(), text.into_bytes()))
}

/// A packed data group as the linked layout holds it.
pub struct Unpacked {
    /// The data-group root, linking to its relationship blocks.
    pub root: Value,
    /// What the links below the root name: relationship blocks by CID, entities by key.
    pub blocks: HashMap<String, Value>,
    /// What is wrong with the packing itself: the JSON path and the message.
    pub findings: Vec<(String, String)>,
}

/// The CID a JSON value has as a block of the linked layout.
fn cid(value: &Value) -> String {
    cids::of_json(value, &canonical(value)).to_string()
}

/// The linked form of a packed data-group root; `None` when the root is not packed.
pub fn unpack(packed: &Value) -> Option<Unpacked> {
    let fields = packed.as_object()?;
    let held = fields.get("entities")?;
    let entities = held.as_object();
    let mut findings = Vec::new();
    if entities.is_none() {
        findings.push(("/entities".to_string(), "entities must be an object".to_string()));
    }
    let mut blocks = HashMap::new();
    let mut used = HashSet::new();
    // A REL back as a relationship block, and the link to it.
    let mut link = |relation: &Value, path: String| -> Value {
        let mut block = relation.clone();
        for end in ["from", "to"] {
            let Some(Value::String(entity)) = block.get(end).cloned() else {
                continue;
            };
            if entities.is_some_and(|entities| !entities.contains_key(&entity)) {
                findings.push((format!("{path}/{end}"), format!("{end} {entity} is not a key of entities")));
            }
            block[end] = json!({ "/": entity });
            used.insert(entity);
        }
        let cid = cid(&block);
        blocks.insert(cid.clone(), block);
        json!({ "/": cid })
    };
    let mut root: Map<String, Value> =
        fields.iter().filter(|(key, _)| *key != "entities").map(|(key, value)| (key.clone(), value.clone())).collect();
    if let Some(Value::Object(listed)) = root.get_mut("relationships") {
        for (key, value) in listed {
            let path = format!("/relationships/{key}");
            *value = match &*value {
                Value::Null => continue,
                Value::Array(items) => items.iter().enumerate().map(|(at, item)| link(item, format!("{path}/{at}"))).collect(),
                item => link(item, path),
            };
        }
    }
    for (key, entity) in entities.into_iter().flatten() {
        let own = cid(entity);
        if own != *key {
            findings.push((format!("/entities/{key}"), format!("entity key {key} is not the CID of its value, {own}")));
        }
        if !used.contains(key) {
            findings.push((format!("/entities/{key}"), format!("entity {key} is not referenced by any relationship")));
        }
        blocks.entry(key.clone()).or_insert_with(|| entity.clone());
    }
    Some(Unpacked { root: Value::Object(root), blocks, findings })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The packed blocks and the CIDs of their linked roots came from
    /// elephant-cli 1.x and a reference packer (tests/packed.rs).
    #[test]
    fn unpacks_to_the_linked_root_elephant_cli_1_wrote() {
        for (packed, linked) in [
            (
                include_str!("../tests/fixtures/packed/vector-1/packed.json"),
                "baguqeerad7ribhalqwds5cm4l4mpclt7cr4qbuyrv3rxex4n5bwvga4pewja",
            ),
            (
                include_str!("../tests/fixtures/packed/vector-2/packed.json"),
                "baguqeerap73zkcd4lmiy2blzhbmh6hwdivicucv7nfi5kqvrh5y2kvg4z5mq",
            ),
        ] {
            let unpacked = unpack(&serde_json::from_str(packed).unwrap()).unwrap();
            assert_eq!(cid(&unpacked.root), linked);
            assert!(unpacked.findings.is_empty(), "{:?}", unpacked.findings);
        }
    }
}
