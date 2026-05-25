# Browser Flow v2 Handler Packages

Browser Flow v2 lets `prepare` run a packaged JavaScript handler when a county
site needs browser automation that is easier to express in code than in the JSON
browser flow format. The handler receives a Puppeteer `page`, the prepared seed
input, and helper functions for writing clean HTML captures into the prepared
site ZIP.

## Table of Contents

- [When to Use Browser Flow v2](#when-to-use-browser-flow-v2)
- [Quick Start](#quick-start)
- [Prepare Command](#prepare-command)
- [Handler Package Structure](#handler-package-structure)
- [Handler API](#handler-api)
- [Input Data](#input-data)
- [Output Bundle](#output-bundle)
- [Options](#options)
- [Complete Example](#complete-example)
- [Troubleshooting](#troubleshooting)
- [Best Practices](#best-practices)

## When to Use Browser Flow v2

Use Browser Flow v2 when a county website requires logic that does not fit the
template or JSON workflow model:

- Conditional navigation based on page content.
- Repeated searches, tabs, or pages before the final property detail page.
- Custom JavaScript evaluation with Puppeteer.
- Multiple HTML captures from one browser session.
- County-specific code that should live outside the CLI source tree.

Use [browser flow templates](./browser-flow-templates.md) for common search
forms, and [custom browser flows](./custom-browser-flows.md) when a declarative
JSON workflow is enough.

## Quick Start

Create a `handler.js` file:

```javascript
export async function handler({ input, page, saveHtml, saveSourceUrl }) {
  await page.goto(input.url, { waitUntil: 'domcontentloaded' });
  await page.type('#parcel-search', input.request_identifier);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#property-details', { timeout: 60000 });

  await saveSourceUrl(page.url());
  await saveHtml({ name: 'property-detail' });
}
```

Package it:

```bash
zip -r county-browser-flow-v2.zip handler.js
```

Run `prepare`:

```bash
elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --browser-flow-version 2 \
  --browser-flow-zip county-browser-flow-v2.zip
```

## Prepare Command

**Purpose**

`prepare` uses the handler package to open a browser, navigate the county site,
and save one or more cleaned HTML captures for downstream `generate-transform`
and `transform` work.

**Required inputs**

- `prepare-input.zip`, containing `property_seed.json` and
  `unnormalized_address.json` at the ZIP root.
- A Browser Flow v2 ZIP containing `handler.js` at the ZIP root.

The command also supports the newer input names `parcel.json` and
`address.json`.

**Example invocation**

```bash
elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --browser-flow-version 2 \
  --browser-flow-zip county-browser-flow-v2.zip
```

## Handler Package Structure

The handler ZIP must contain `handler.js` at the root:

```text
county-browser-flow-v2.zip
└── handler.js
```

`handler.js` must be an ES module that exports an async `handler` function:

```javascript
export async function handler(context) {
  // Use context.page, context.input, and capture helpers here.
}
```

If you split code across files, keep imports relative and include those files in
the ZIP:

```text
county-browser-flow-v2.zip
├── handler.js
└── selectors.js
```

Bundle third-party dependencies into the handler package or avoid them. The CLI
extracts the ZIP and imports `handler.js`; it does not install dependencies for
the package at runtime.

## Handler API

The handler receives a single context object:

```typescript
type BrowserFlowV2Context = {
  page: Page;
  input: BrowserFlowV2Input;
  saveHtml(options: { name: string; html?: string }): Promise<void>;
  saveSourceUrl(url: string): Promise<void>;
  logger: {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
  };
};
```

### `page`

A Puppeteer `Page` instance. Use it for navigation, typing, clicking, waiting,
and evaluating page content.

```javascript
await page.goto(input.url, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('#property-details');
```

### `input`

The normalized prepare input. It includes the request identifier, the full source
URL built from `source_http_request`, and the original parcel and address JSON
objects.

```javascript
const parcel = input.request_identifier;
const county = input.address.county_name;
```

### `saveSourceUrl(url)`

Records the final source URL represented by the captures. The handler must call
this exactly once.

```javascript
await saveSourceUrl(page.url());
```

### `saveHtml({ name, html })`

Writes one cleaned HTML capture. The handler must save at least one capture.

```javascript
await saveHtml({ name: 'property-detail' });
```

If `html` is omitted, the CLI captures `await page.content()`. Saved HTML is
cleaned before it is written: scripts, styles, `noscript` blocks, stylesheet
links, and inline `style` attributes are removed while the document structure is
preserved.

Capture names must be kebab-case lowercase identifiers:

```text
property-detail
tax-history
owner-summary
```

The CLI writes those captures under `captures/<name>.html`.

### `logger`

Use `logger` for progress messages that should appear in CLI logs:

```javascript
logger.info(`Opening property page for ${input.request_identifier}`);
```

## Input Data

The input ZIP can use either the standard workflow names:

```text
prepare-input.zip
├── property_seed.json
└── unnormalized_address.json
```

or the newer shorter names:

```text
prepare-input.zip
├── parcel.json
└── address.json
```

The parcel file must include:

```json
{
  "request_identifier": "parcel-123",
  "source_http_request": {
    "method": "GET",
    "url": "https://county.example/search",
    "multiValueQueryString": {
      "id": ["parcel-123"]
    }
  }
}
```

The handler receives `input.url` as the fully constructed URL, including query
parameters from `multiValueQueryString`.

## Output Bundle

Browser Flow v2 preserves the input files and adds a capture manifest plus HTML
captures:

```text
prepared-site.zip
├── property_seed.json
├── unnormalized_address.json
├── captures.json
└── captures/
    └── property-detail.html
```

`captures.json` records the source URL and every capture:

```json
{
  "version": 2,
  "request_identifier": "parcel-123",
  "sourceUrl": "https://county.example/details?id=parcel-123",
  "captures": [
    {
      "name": "property-detail",
      "path": "captures/property-detail.html",
      "type": "html"
    }
  ]
}
```

Downstream scripts should read `captures.json` when they need to know which
capture files are present.

## Options

| Option                      | Purpose                                                        | Required |
| --------------------------- | -------------------------------------------------------------- | -------- |
| `--browser-flow-version 2`  | Enables Browser Flow v2 handler package mode.                  | Yes      |
| `--browser-flow-zip <path>` | Path to the ZIP containing `handler.js`.                       | Yes      |
| `--output-zip <path>`       | Destination prepared site ZIP.                                 | Yes      |
| `--no-headless`             | Runs the browser visibly for local debugging.                  | No       |
| `--proxy <url>`             | Uses an authenticated proxy, formatted as `user:pass@ip:port`. | No       |

Do not combine Browser Flow v2 with `--browser-flow-template`,
`--browser-flow-file`, `--multi-request-flow-file`, or `--input-csv`. Browser
Flow v2 is a separate `prepare-input.zip` path.

## Complete Example

`handler.js`:

```javascript
export async function handler({
  input,
  page,
  saveHtml,
  saveSourceUrl,
  logger,
}) {
  logger.info(`Preparing ${input.request_identifier}`);

  await page.goto(input.url, { waitUntil: 'domcontentloaded' });

  const accept = await page.$('#acceptDataDisclaimer');
  if (accept) {
    await accept.click();
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' });
  }

  await page.waitForSelector('#property-details', { timeout: 60000 });

  await saveSourceUrl(page.url());
  await saveHtml({ name: 'property-detail' });
}
```

Package and run:

```bash
zip -r county-browser-flow-v2.zip handler.js

elephant-cli prepare prepare-input.zip \
  --output-zip prepared-site.zip \
  --browser-flow-version 2 \
  --browser-flow-zip county-browser-flow-v2.zip
```

Inspect the output:

```bash
unzip -l prepared-site.zip
unzip -p prepared-site.zip captures.json
```

## Troubleshooting

### `--browser-flow-zip requires --browser-flow-version 2`

Add the version flag:

```bash
--browser-flow-version 2
```

### `--browser-flow-zip is required for browser flow v2`

Provide the handler package:

```bash
--browser-flow-zip county-browser-flow-v2.zip
```

### `Browser flow v2 package must export a handler function`

Make sure `handler.js` is at the ZIP root and exports `handler`:

```javascript
export async function handler(context) {}
```

### `Browser flow v2 handler must call saveSourceUrl`

Call `saveSourceUrl(page.url())` after the handler reaches the page represented
by the captures.

### `Browser flow v2 handler must save at least one capture`

Call `saveHtml({ name: 'property-detail' })` or pass explicit HTML:

```javascript
await saveHtml({ name: 'property-detail', html: await page.content() });
```

### `Invalid capture name`

Use lowercase kebab-case capture names. For example, use `property-detail`, not
`Property Detail` or `property_detail`.

## Best Practices

- Keep each handler focused on one county source workflow.
- Save the final detail page URL with `saveSourceUrl`.
- Prefer semantic capture names such as `property-detail`, `owner-summary`, or
  `tax-history`.
- Use `--no-headless` while developing selectors locally.
- Log major milestones with `logger.info`.
- Keep waits tied to selectors that prove the data is loaded.
- Avoid writing files directly from the handler; use `saveHtml` so the CLI can
  clean, name, and manifest captures consistently.
