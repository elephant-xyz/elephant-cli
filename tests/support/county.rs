//! A tiny county archive for tests, with schemas shaped like the lexicon.
#![allow(dead_code)]

use super::{link, node, text, write_car, Block, Scratch};
use cid::Cid;
use serde_json::{json, Map, Value};
use std::path::Path;

pub struct Schemas {
    pub group: String,
    pub link: String,
    pub property: String,
    pub address: String,
    pub seed: String,
}

fn named(name: &str) -> String {
    text(name).cid.to_string()
}

/// Data group -> relationship -> class schemas, written into the scratch schema cache.
pub fn schemas(scratch: &Scratch) -> Schemas {
    let ids = Schemas {
        group: named("county data group schema"),
        link: named("property_to_address schema"),
        property: named("property class schema"),
        address: named("address class schema"),
        seed: named("seed data group schema"),
    };
    let dir = scratch.path("schemas");
    std::fs::create_dir_all(&dir).unwrap();
    let write = |cid: &str, schema: Value| {
        std::fs::write(dir.join(format!("{cid}.json")), serde_json::to_vec(&schema).unwrap()).unwrap();
    };
    write(
        &ids.group,
        json!({
            "type": "object",
            "title": "County",
            "properties": {
                "label": { "type": "string" },
                "relationships": {
                    "type": "object",
                    "properties": {
                        "property_has_address": {
                            "type": ["array", "null"],
                            "items": { "type": "string", "cid": ids.link },
                        },
                    },
                },
            },
        }),
    );
    write(
        &ids.link,
        json!({
            "type": "object",
            "title": "property_to_address",
            "properties": {
                "from": { "type": "string", "cid": ids.property },
                "to": { "type": "string", "cid": ids.address },
            },
        }),
    );
    write(
        &ids.property,
        json!({
            "type": "object",
            "title": "property",
            "properties": {
                "parcel_identifier": { "type": "string" },
                "units": { "type": ["integer", "null"] },
                "area": { "type": "number" },
                "historic": { "type": "boolean" },
                "source_http_request": { "type": "object" },
                "request_identifier": { "type": "string" },
            },
            "required": ["parcel_identifier"],
        }),
    );
    write(
        &ids.address,
        json!({
            "type": "object",
            "title": "Address",
            "properties": { "city": { "type": "string" }, "request_identifier": { "type": "string" } },
        }),
    );
    write(
        &ids.seed,
        json!({
            "type": "object",
            "title": "Seed",
            "properties": {
                "label": { "type": "string" },
                "relationships": { "type": "object", "properties": {} },
            },
        }),
    );
    ids
}

#[derive(Default, Clone, Copy)]
pub struct Tweaks {
    /// Property `b` gets a number where its schema wants a string.
    pub bad: bool,
    /// Property `b`'s address links to a block that is not in the car.
    pub dangling: bool,
    /// Property `b`'s relationship points at a block that is not in the car.
    pub lost: bool,
    /// One block nothing links to, written last.
    pub extra: bool,
    /// One shard per property, each written right after its property's blocks.
    pub split: bool,
    /// Split, and property `b` links to property `a`'s address block instead of carrying its own.
    pub shared: bool,
    /// Split, and a second copy of `a`'s address block follows `b`'s shard, where nothing links to it.
    pub spare: bool,
    /// Split, and `a`'s address block is written after `b`'s shard, two segments away from the shard that links to it.
    pub trailing: bool,
    /// Split, and property `b`'s address block is written among property `a`'s blocks.
    pub late: bool,
    /// The same blocks written in reverse order: the county index first.
    pub reversed: bool,
    /// The index lists its only shard twice.
    pub twice: bool,
    /// The index lists no shards although the file holds one.
    pub unlisted: bool,
    /// Split, and property `b`'s shard block is listed by the index but not written.
    pub gone: bool,
    /// Property `a`'s address block is written twice in a row.
    pub doubled: bool,
    /// Split, property `a`'s address links to a block that is not in the car, and `b`'s shard lists that block as a data group.
    pub claimed: bool,
    /// Split, written the way a gateway exports the archive: the index, then
    /// each shard block followed by the blocks below it, parents first.
    pub exported: bool,
}

pub struct County {
    pub root: Cid,
    pub blocks: Vec<Block>,
    pub nowhere: Cid,
}

/// Two properties `a` and `b`, each a data-group root -> one
/// `property_has_address` relationship block -> a property and an address
/// entity, in that block order, then the shard and the county index (and the
/// extra block last).
pub fn build(file: &Path, ids: &Schemas, tweaks: Tweaks) -> County {
    let nowhere = text("nowhere").cid;
    let split = tweaks.split
        || tweaks.shared
        || tweaks.spare
        || tweaks.trailing
        || tweaks.late
        || tweaks.gone
        || tweaks.claimed
        || tweaks.exported;
    let mut blocks: Vec<Block> = Vec::new();
    let mut entries: Vec<Value> = Vec::new();
    let mut shards: Vec<Block> = Vec::new();
    let mut addresses: Vec<Block> = Vec::new();
    let mut exported: Vec<Vec<Block>> = Vec::new();
    let address_of = |suffix: &str| {
        let mut fields = Map::new();
        fields.insert("city".to_string(), json!(format!("City {suffix}")));
        fields.insert("request_identifier".to_string(), json!(format!("req-{suffix}")));
        if (tweaks.dangling && suffix == "b") || (tweaks.claimed && suffix == "a") {
            fields.insert("extra".to_string(), link(&nowhere));
        }
        node(&Value::Object(fields))
    };
    for (index, suffix) in ["a", "b"].into_iter().enumerate() {
        let b = suffix == "b";
        let parcel = if tweaks.bad && b { json!(7) } else { json!(format!("parcel-{suffix}")) };
        let property = node(&json!({
            "parcel_identifier": parcel,
            "units": if index == 0 { json!(3) } else { Value::Null },
            "area": 12.5 + index as f64,
            "historic": b,
            "source_http_request": { "method": "GET", "url": format!("https://x/{suffix}") },
            "request_identifier": format!("req-{suffix}"),
        }));
        addresses.push(address_of(suffix));
        let address = addresses[if tweaks.shared { 0 } else { index }].clone();
        let relation = node(&json!({ "from": link(&property.cid), "to": link(&address.cid) }));
        let target = if tweaks.lost && b { nowhere } else { relation.cid };
        let root = node(&json!({ "label": "County", "relationships": { "property_has_address": [link(&target)] } }));
        blocks.extend([root.clone(), relation.clone(), property.clone()]);
        if !(b && (tweaks.shared || tweaks.late)) && !(!b && tweaks.trailing) {
            blocks.push(address.clone());
        }
        if !b && tweaks.late {
            blocks.push(address_of("b"));
        }
        if !b && tweaks.doubled {
            blocks.push(address.clone());
        }
        let mut groups = Map::new();
        groups.insert(ids.group.clone(), link(&root.cid));
        if tweaks.claimed && b {
            groups.insert(ids.seed.clone(), link(&nowhere));
        }
        entries.push(json!({ "property_cid": link(&root.cid), "data_groups": groups }));
        if split {
            let shard = node(&json!({ "properties": [entries[index]] }));
            shards.push(shard.clone());
            if !(tweaks.gone && b) {
                blocks.push(shard.clone());
            }
            exported.push(vec![shard, root, relation, property, address]);
            if b && (tweaks.spare || tweaks.trailing) {
                blocks.push(addresses[0].clone());
            }
        }
    }
    if !split {
        let shard = node(&json!({ "properties": entries }));
        shards.push(shard.clone());
        blocks.push(shard);
    }
    let mut listed: Vec<Value> = shards.iter().map(|shard| link(&shard.cid)).collect();
    if tweaks.twice {
        listed.extend(listed.clone());
    }
    if tweaks.unlisted {
        listed.clear();
    }
    let index = node(&json!({
        "label": "CountyIndex",
        "version": 1,
        "properties": entries.len(),
        "shards": listed,
    }));
    blocks.push(index.clone());
    if tweaks.extra {
        blocks.push(text("unreachable"));
    }
    let written: Vec<Block> = if tweaks.exported {
        std::iter::once(index.clone()).chain(exported.into_iter().flatten()).collect()
    } else if tweaks.reversed {
        blocks.iter().rev().cloned().collect()
    } else {
        blocks.clone()
    };
    write_car(file, &index.cid, &written);
    County { root: index.cid, blocks, nowhere }
}
