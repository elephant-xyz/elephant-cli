# Elephant CLI

This context describes the county data preparation and transformation language used by the Elephant CLI. It exists so workflow, package, and data-group terms stay consistent across commands, docs, and tests.

## Language

**Seed Record**:
The canonical request metadata for one parcel lookup, represented by `address.json` and `parcel.json`.
_Avoid_: Legacy seed file, property seed when referring to the v2 structure

**Capture Manifest**:
The `captures.json` file produced by Browser Flow v2 that names captured source pages and their relative HTML paths.
_Avoid_: Input manifest, HTML list

**Capture**:
A named source HTML artifact under `captures/` that a transform handler can read.
_Avoid_: Page, response file

**Transform v2 Handler Package**:
A ZIP package with a root `handler.js` entrypoint that transforms prepared captures into Elephant data-group records.
_Avoid_: Scripts ZIP, generated scripts bundle

**Entity Output**:
A schema-targeted JSON record written by a transform handler through `writeJson()`.
_Avoid_: Data file when the distinction from relationships matters

**Relationship Output**:
A JSON file written by a transform handler through `writeRelationship()` that links two entity outputs.
_Avoid_: Edge file, link file

**Relationship Key**:
The data-group relationship property name, such as `property_has_address`, used to place relationship outputs in a data-group root.
_Avoid_: Relationship schema name when referring to `*_has_*` keys

**Data-Group Root**:
The CID-named JSON file with `label` and `relationships` that indexes relationship outputs for one data group.
_Avoid_: Manifest, bundle root

**County CAR**:
The single archive `hash --output-car` writes for one data group of one county: every property's blocks, the **Shards** and the **County Index** as its root.
_Avoid_: Bundle, archive file when the county archive is meant

**County Index**:
The root block of a **County CAR**: the property count and links to the **Shards**.
_Avoid_: Manifest, root file

**Shard**:
A block of a **County CAR** listing up to 5000 properties with their data-group CIDs.
_Avoid_: Chunk, page

**Finding**:
One row of a validation CSV: a thing `validate` found wrong, with where and why.
_Avoid_: Warning, issue

**Tables Directory**:
What `export-tables` writes for a **County CAR**: Parquet parts per table and `tables.car`, the document recording every part by CID.
_Avoid_: Export folder, Parquet dump

**Schema Cache**:
The directory holding the lexicon manifest and one `<cid>.json` per schema; with it the CLI runs offline.
_Avoid_: Schema folder, lexicon directory

## Relationships

- A **Seed Record** can produce one **Capture Manifest** through Browser Flow v2.
- A **Capture Manifest** lists one or more **Captures**.
- A **Transform v2 Handler Package** reads **Captures** and writes **Entity Outputs** and **Relationship Outputs**.
- A **Relationship Output** links exactly two **Entity Outputs**.
- A **Data-Group Root** indexes **Relationship Outputs** by **Relationship Key**.
- A **County CAR** has one **County Index**, which links one or more **Shards**; a **Shard** lists properties and their **Data-Group Roots**.
- A **Tables Directory** is exported from exactly one **County CAR**.

## Example dialogue

> **Dev:** "Can the v2 transform package read both the details page and the tax page?"
> **Domain expert:** "Yes. Browser Flow v2 records both as **Captures** in the **Capture Manifest**, and the **Transform v2 Handler Package** calls `readCapture(name)` for each one it needs."

## Flagged ambiguities

- "scripts ZIP" now means the v1 five-script transform bundle only; the v2 package is a **Transform v2 Handler Package**.
- "relationship name" was split into **Relationship Key** for data-group properties and output filename stem for the physical JSON file.
