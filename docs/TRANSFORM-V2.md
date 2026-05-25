# Transform v2 Handler Packages

Transform v2 consumes Browser Flow v2 prepared ZIPs and runs a packaged JavaScript handler to produce Elephant data-group JSON. It is separate from the v1 five-script `--scripts-zip` runner.

## Table of Contents

- [Purpose](#purpose)
- [Command](#command)
- [Input ZIP](#input-zip)
- [Handler Package](#handler-package)
- [Handler Context](#handler-context)
- [Outputs](#outputs)
- [Relationships And Data-Group Roots](#relationships-and-data-group-roots)
- [Metadata Rules](#metadata-rules)
- [Example Handler](#example-handler)
- [Troubleshooting](#troubleshooting)

## Purpose

Use transform v2 when `prepare --browser-flow-version 2` produced a capture manifest and one or more named HTML captures. A v2 handler reads those captures and writes entity and relationship JSON through constrained helper functions.

Transform v2 does not replace generated v1 scripts yet. `generate-transform` still emits the current five-script bundle for use with `--scripts-zip`.

## Command

```bash
elephant-cli transform \
  --transform-version 2 \
  --transform-zip county-transform-v2.zip \
  --input-zip prepared-site.zip \
  --output-zip transformed-data.zip
```

**Required inputs**

- `--transform-version 2`
- `--transform-zip <path>` pointing to a v2 handler package
- `--input-zip <path>` pointing to a Browser Flow v2 prepared ZIP

**Outputs**

- `transformed-data.zip`, or the path passed with `--output-zip`
- Files inside the ZIP are written under `data/`

**Options**

| Option | Purpose | Default |
| --- | --- | --- |
| `--transform-version <version>` | Selects the transform runtime. Must be `2` for handler packages. | None |
| `--transform-zip <path>` | ZIP containing root-level `handler.js`. | Required for v2 |
| `--input-zip <path>` | Browser Flow v2 prepared ZIP. | Required |
| `--output-zip <path>` | Destination transformed bundle. | `transformed-data.zip` |
| `--data-group <label>` | Data-group label used for the CID-named root file. | `County` |

Do not pass `--scripts-zip` with transform v2. `--scripts-zip` is reserved for the v1 five-script runner.

## Input ZIP

Transform v2 requires the Browser Flow v2 prepared structure:

```text
prepared-site.zip
├── address.json
├── parcel.json
├── captures.json
└── captures/
    ├── property-detail.html
    └── tax-detail.html
```

`parcel.json` must include `source_http_request` and `request_identifier`. `captures.json` must list the named captures that the handler reads.

There is no root-level `input.html` fallback in transform v2. Use v1 transform scripts for legacy prepared ZIPs.

## Handler Package

A transform v2 package is a ZIP with a root ES module named `handler.js`:

```text
county-transform-v2.zip
└── handler.js
```

`handler.js` must export `handler(context)`:

```js
export async function handler(context) {
  const html = await context.readCapture('property-detail');
  await context.writeJson('property', {
    parcel_identifier: context.input.parcel.parcel_identifier,
    raw_html_length: html.length,
  });
}
```

The handler may import local helper modules bundled in the same ZIP.

### Package Config

`handler.js` may export `config`:

```js
export const config = {
  timeoutMs: 120000,
};
```

`timeoutMs` defaults to `120000`. It must be between `1000` and `600000`.

## Handler Context

The handler receives a context with input data and helper functions:

```ts
interface TransformV2Context {
  input: {
    request_identifier: string;
    source_http_request: Request;
    address: Record<string, unknown>;
    parcel: Record<string, unknown>;
    captures: BrowserFlowV2Manifest;
    readCapture(name: string): Promise<string>;
  };
  readCapture(name: string): Promise<string>;
  writeJson(name: string, value: Record<string, unknown>): Promise<void>;
  writeRelationship(options: {
    type: string;
    name: string;
    from: string;
    to: string;
  }): Promise<void>;
  logger: Logger;
}
```

`readCapture(name)` reads one capture by its `captures.json` name. Handlers can read multiple captures.

`writeJson(name, value)` writes one entity output. `name` is a snake_case filename stem; the CLI writes `data/<name>.json`.

`writeRelationship(options)` writes one relationship output. `type` is the data-group relationship key, such as `property_has_address`. `name` is a snake_case filename stem. `from` and `to` must reference entity output stems already written with `writeJson()`.

## Outputs

Transform v2 writes a ZIP with files under `data/`:

```text
transformed-data.zip
└── data/
    ├── property.json
    ├── address.json
    ├── relationship_property_address.json
    └── <data-group-schema-cid>.json
```

The CLI does not automatically copy `address.json` or `parcel.json` into output. If a handler wants seed records in the transformed bundle, it must write them explicitly:

```js
await writeJson('address', input.address);
await writeJson('parcel', input.parcel);
```

## Relationships And Data-Group Roots

Handlers write relationships with explicit data-group relationship keys:

```js
await writeRelationship({
  type: 'property_has_address',
  name: 'relationship_property_address',
  from: 'property',
  to: 'address',
});
```

The CLI writes the relationship file:

```json
{
  "from": { "/": "./property.json" },
  "to": { "/": "./address.json" }
}
```

Then it creates the CID-named data-group root. Relationship cardinality is derived from the selected data-group schema, so singleton relationship keys become a single IPLD reference and array relationship keys become arrays.

## Metadata Rules

For entity outputs written through `writeJson()`:

- `request_identifier` is always set to the input request identifier from `parcel.json`.
- `source_http_request` is copied from `parcel.json` when the handler did not provide one.
- Handler-provided `source_http_request` is preserved so different captures can point to different source requests.

Relationship outputs do not receive `source_http_request` or `request_identifier`.

## Example Handler

```js
export const config = {
  timeoutMs: 120000,
};

export async function handler({ input, readCapture, writeJson, writeRelationship }) {
  const html = await readCapture('property-detail');

  await writeJson('property', {
    parcel_identifier: input.parcel.parcel_identifier,
    page_has_property_heading: html.includes('Property Detail'),
  });

  await writeJson('address', input.address);

  await writeRelationship({
    type: 'property_has_address',
    name: 'relationship_property_address',
    from: 'property',
    to: 'address',
  });
}
```

Package it:

```bash
zip county-transform-v2.zip handler.js
```

Run it:

```bash
elephant-cli transform \
  --transform-version 2 \
  --transform-zip county-transform-v2.zip \
  --input-zip prepared-site.zip \
  --output-zip transformed-data.zip
```

## Troubleshooting

`--transform-zip requires --transform-version 2` means the handler package flag was passed without selecting the v2 runtime.

`--scripts-zip cannot be used with transform v2` means the v1 and v2 package contracts were mixed.

`captures.json is required for transform v2` means the input ZIP was not produced by Browser Flow v2 or the manifest was removed.

`Unknown capture: <name>` means the handler requested a capture name that is not listed in `captures.json`.

`Invalid output name` means a helper name was not a snake_case filename stem.

`Relationship type "<type>" is not valid for <data-group>` means the selected data-group schema does not define that relationship key.
