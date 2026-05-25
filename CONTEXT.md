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

## Relationships

- A **Seed Record** can produce one **Capture Manifest** through Browser Flow v2.
- A **Capture Manifest** lists one or more **Captures**.
- A **Transform v2 Handler Package** reads **Captures** and writes **Entity Outputs** and **Relationship Outputs**.
- A **Relationship Output** links exactly two **Entity Outputs**.
- A **Data-Group Root** indexes **Relationship Outputs** by **Relationship Key**.

## Example dialogue

> **Dev:** "Can the v2 transform package read both the details page and the tax page?"
> **Domain expert:** "Yes. Browser Flow v2 records both as **Captures** in the **Capture Manifest**, and the **Transform v2 Handler Package** calls `readCapture(name)` for each one it needs."

## Flagged ambiguities

- "scripts ZIP" now means the v1 five-script transform bundle only; the v2 package is a **Transform v2 Handler Package**.
- "relationship name" was split into **Relationship Key** for data-group properties and output filename stem for the physical JSON file.
