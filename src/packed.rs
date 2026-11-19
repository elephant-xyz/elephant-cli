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
//! with the CIDs the linked layout has, for the code that reads that, and
//! `validate` checks a root of either layout against its schema.

use crate::canonical::{canonical, cid, link};
use crate::cids;
use crate::lexicon::{Finding, Group, Source};
use serde_json::{json, Map, Value};
use std::borrow::Cow;
use std::collections::{BTreeMap, HashMap, HashSet};

/// The largest packed block, in canonical bytes; a bigger data group stays linked.
const LIMIT: usize = 1 << 20;

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
/// relationships linking two link-free entities of `blocks`, it is too big,
/// or one of its blocks does not have the CID of its canonical JSON.
pub fn pack(root: &str, blocks: &BTreeMap<String, Vec<u8>>) -> Option<(String, Vec<u8>)> {
    // A block is read back from its canonical bytes and has to be filed under the CID those give
    // it, or the packed block could not be unpacked to the same CIDs. It is not when the JSON had a
    // `__proto__` key that decided the codec: canonical JSON drops the key, `hash` chooses before that.
    let read = |key: &str| serde_json::from_slice::<Value>(blocks.get(key)?).ok().filter(|value| cid(value).to_string() == key);
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
            if !entities.contains_key(&cid) {
                entities.insert(cid.clone(), read(&cid).filter(|entity| !linked(entity))?);
            }
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

/// The linked form of a packed data-group root; a root that is not packed comes back as it is.
pub fn unpack(packed: Value) -> Result<Unpacked, Value> {
    let Value::Object(mut root) = packed else {
        return Err(packed);
    };
    let Some(held) = root.shift_remove("entities") else {
        return Err(Value::Object(root));
    };
    let mut findings = Vec::new();
    let entities = match held {
        Value::Object(entities) => Some(entities),
        _ => {
            findings.push(("/entities".to_string(), "entities must be an object".to_string()));
            None
        }
    };
    let mut blocks = HashMap::new();
    let mut used = HashSet::new();
    // A REL back as a relationship block, and the link to it.
    let mut link = |mut block: Value, path: String| -> Value {
        for end in ["from", "to"] {
            let Some(Value::String(entity)) = block.get(end) else {
                continue;
            };
            if entities.as_ref().is_some_and(|entities| !entities.contains_key(entity)) {
                findings.push((format!("{path}/{end}"), format!("{end} {entity} is not a key of entities")));
            }
            used.insert(entity.clone());
            block[end] = json!({ "/": entity });
        }
        let cid = cid(&block).to_string();
        blocks.insert(cid.clone(), block);
        json!({ "/": cid })
    };
    if let Some(Value::Object(listed)) = root.get_mut("relationships") {
        for (key, value) in listed {
            let path = format!("/relationships/{key}");
            *value = match value.take() {
                Value::Null => continue,
                Value::Array(items) => {
                    items.into_iter().enumerate().map(|(at, item)| link(item, format!("{path}/{at}"))).collect()
                }
                item => link(item, path),
            };
        }
    }
    for (key, entity) in entities.into_iter().flatten() {
        if !used.contains(&key) {
            findings.push((format!("/entities/{key}"), format!("entity {key} is not referenced by any relationship")));
        }
        blocks.entry(key).or_insert(entity);
    }
    Ok(Unpacked { root: Value::Object(root), blocks, findings })
}

/// `unpack` for a root that is checked: also the finding only hashing shows,
/// an entity filed under a key that is not its CID. `None` when the root is not packed.
fn verify(packed: &Value) -> Option<Unpacked> {
    let held = packed.as_object()?.get("entities")?;
    let mut renamed = Vec::new();
    for (key, entity) in held.as_object().into_iter().flatten() {
        let own = cid(entity).to_string();
        if own != *key {
            renamed.push((format!("/entities/{key}"), format!("entity key {key} is not the CID of its value, {own}")));
        }
    }
    let mut unpacked = unpack(packed.clone()).ok()?;
    unpacked.findings.extend(renamed);
    Some(unpacked)
}

/// Validate a data-group root against its schema, a packed one as the linked
/// root it stands for, with nothing below it looked up outside the block.
/// Returns the findings about the packing (JSON path and message) and what
/// `Group::validate` says.
pub fn validate<'a>(group: &Group, root: &Value, source: Source<'_, 'a>) -> (Vec<(String, String)>, Option<Vec<Finding>>) {
    let Some(unpacked) = verify(root) else {
        return (Vec::new(), group.validate(root, source));
    };
    let inline = |pointer: &str| {
        unpacked.blocks.get(pointer).map(Cow::Borrowed).ok_or_else(|| format!("{pointer} is not in the packed data group"))
    };
    let found = group.validate(&unpacked.root, &inline);
    (unpacked.findings, found)
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
            let unpacked = verify(&serde_json::from_str(packed).unwrap()).unwrap();
            assert_eq!(cid(&unpacked.root).to_string(), linked);
            assert!(unpacked.findings.is_empty(), "{:?}", unpacked.findings);
        }
    }
}
