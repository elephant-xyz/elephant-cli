# Identify Static Parts Command

## Overview

The `identify-static-parts` command analyzes multiple HTML files to identify DOM elements that are identical across all files. This is useful for detecting boilerplate content, navigation headers, footers, and other static UI elements that appear consistently across different property pages or documents.

## Table of Contents

- [Usage](#usage)
- [How It Works](#how-it-works)
- [Output Format](#output-format)
- [Examples](#examples)
- [Algorithm Details](#algorithm-details)
- [Limitations](#limitations)

## Usage

### Basic Usage

```bash
npx elephant-cli identify-static-parts --input-zip properties.zip
```

### With Custom Output Path

```bash
npx elephant-cli identify-static-parts \
  --input-zip properties.zip \
  --output static-selectors.csv
```

### Options

| Option | Required | Default | Description |
|--------|----------|---------|-------------|
| `--input-zip` | Yes | - | Path to zip file containing HTML files (minimum 2 files) |
| `--output` | No | `static-parts.csv` | Output CSV file path |

## How It Works

The command performs the following steps:

1. **Extract HTML Files**: Unzips the input archive and identifies all HTML files (minimum 2 required)

2. **Canonicalization**: For each HTML file, normalizes the DOM by:
   - Removing comments, scripts, and stylesheets
   - Stripping volatile attributes (style, data-*, ARIA, event handlers)
   - Normalizing whitespace
   - Sorting attributes alphabetically

3. **Hash Calculation**: Computes SHA1 hashes for each candidate element's canonical form

4. **Intersection**: Identifies elements that appear with identical content in ALL HTML files

5. **Selector Building**: Generates robust CSS selectors for matched elements:
   - Prefers ID selectors when available
   - Falls back to structural selectors with tag names, classes, and nth-of-type
   - Validates uniqueness across all documents

6. **Minimization**: Removes redundant selectors (e.g., if parent div is selected, child divs are excluded)

7. **CSV Output**: Writes selectors to a CSV file with a `cssSelector` column

## Output Format

The command generates a CSV file with the following structure:

```csv
cssSelector
"#header"
"#navigation"
"body > footer:nth-of-type(1)"
"div.container:nth-of-type(1) > aside.sidebar"
```

Each row contains a single CSS selector that can be used to target static content in the HTML files.

## Examples

### Example 1: Property Records

Input: A zip file containing multiple county property HTML pages

```bash
npx elephant-cli identify-static-parts --input-zip county-properties.zip
```

Output (`static-parts.csv`):
```csv
cssSelector
"#ProgressBar"
"#Toolbar"
"#pagefooter"
"header.officeheader"
"#footer-bottom"
```

These selectors identify the page chrome (progress bar, toolbar, footer) that appears on every property page, allowing you to filter out boilerplate when extracting property-specific data.

### Example 2: Multiple Property Types

```bash
npx elephant-cli identify-static-parts \
  --input-zip diverse-properties.zip \
  --output boilerplate.csv
```

If the HTML files contain varying table structures but consistent headers/footers, the command will identify only the truly static elements, ignoring the varying table content.

## Algorithm Details

### Candidate Selection

The algorithm only considers elements that meet these criteria:

**Included:**
- Container tags: DIV, NAV, HEADER, FOOTER, SECTION, ASIDE, MAIN, ARTICLE, UL, OL
- Any element with an ID attribute
- Elements with sufficient content (>10 characters or >1 child)

**Excluded:**
- `<table>` elements (to preserve data tables)
- Any element inside a `<table>` (to preserve table headers and data)
- Elements with insufficient content
- Script and style tags

### Canonicalization Rules

When comparing elements, the following are normalized or ignored:

**Volatile Attributes (Ignored):**
- `style`, `tabindex`, `contenteditable`
- ARIA attributes: `aria-selected`, `aria-expanded`, `aria-hidden`, etc.
- Event handlers: `onclick`, `onmouseover`, etc.
- `data-*` attributes

**Normalized:**
- Whitespace collapsed to single spaces
- Attributes sorted alphabetically
- HTML comments removed

### Selector Priority

1. **ID Selectors**: `#header` (preferred if unique)
2. **Structural Path**: `body > div.container:nth-of-type(1) > header`
3. **Fallback**: Full path from body with nth-of-type indices

## Limitations

1. **Minimum 2 Files**: The command requires at least 2 HTML files in the zip archive

2. **Table Exclusion**: The algorithm explicitly excludes table elements and their contents to avoid identifying data tables as static. This means:
   - Table headers/footers won't be identified even if identical
   - Navigation elements inside tables won't be detected

3. **Content Sensitivity**: Elements must be byte-identical (after canonicalization) to be identified. Small variations in text, attributes, or structure will cause elements to be excluded.

4. **Performance**: Large HTML files (>1MB) or many files (>100) may take longer to process

5. **Memory Usage**: All HTML files are loaded into memory simultaneously. Very large datasets may require significant RAM.

## Use Cases

### 1. Data Extraction Pipelines

Use identified selectors to remove boilerplate before extracting property data:

```javascript
// Remove static parts identified by the command
const selectorsToRemove = [
  '#header', '#footer', '#navigation'
];

selectorsToRemove.forEach(sel => {
  document.querySelectorAll(sel).forEach(el => el.remove());
});

// Now extract property-specific data
const propertyData = extractData(document.body);
```

### 2. Template Detection

Identify which parts of your HTML files are templates vs. dynamic content, useful for:
- Auditing data consistency
- Detecting layout changes over time
- Building extraction scripts

### 3. Content Quality Assurance

Verify that navigation, headers, and footers are consistent across all documents in a batch.

## Integration with Other Commands

The `identify-static-parts` command complements other CLI commands:

```bash
# 1. Prepare data
npx elephant-cli prepare input.zip --output-zip prepared.zip

# 2. Identify static parts (optional cleanup step)
npx elephant-cli identify-static-parts \
  --input-zip prepared.zip \
  --output static-parts.csv

# 3. Transform data
npx elephant-cli transform prepared.zip --output-zip transformed.zip

# 4. Mirror validate
npx elephant-cli mirror-validate \
  --prepare-zip prepared.zip \
  --transform-zip transformed.zip
```

## Technical Notes

- **Hashing Algorithm**: SHA1 is used for content hashing (canonicalized HTML)
- **DOM Parser**: JSDOM library for parsing and manipulating HTML
- **Selector Validation**: All selectors are validated to ensure they match exactly one element per document
- **Deterministic Output**: Given the same input files, the command produces identical output
