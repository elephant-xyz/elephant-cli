Begin with a concise checklist (3-7 bullets) of what you will do; keep items conceptual, not implementation-level. Create a single JavaScript file for Node.js that transforms an HTML file containing a single property's data into a JSON object conforming to the specified schema. Use only the `cheerio` library for all HTML parsing and extraction. Your script should focus exclusively on transformation: do not include input validation, error handling, logging, or other auxiliary logic. Do not stop until you have saved perfecly working and validated script.

## Requirements

- **Input Handling:**
  - Analyze the HTML content provided in the user message as `input_html` (from file `{input_html_file}`), which contains a single property's details.
  - Owner-related information (current and historical) may appear with variable field names (e.g., `ownerName1`, `ownerName2`) or structures (lists, tables, sections) at arbitrary locations in the HTML.

- **HTML Parsing:**
  - Parse and extract all data using only `cheerio`.

- **Owner Extraction and Classification:**
  - Extract all plausible owner names, covering both current and historical owners, regardless of field label or HTML structure.
  - Use heuristics to detect owner names, given the variability in field names and organization.
  - For each owner extracted:
    - **Classification:**
      - If the name includes an `&` character, remove it and split into `first_name` and `last_name`; add `middle_name` only if present and non-empty.
      - _Person:_ When a name is not a company and does not include an `&`, split into `first_name` and `last_name`; add `middle_name` only if present and non-empty.
      - _Company:_ Classify as a company if the name contains any of: `Inc`, `LLC`, `Ltd`, `Foundation`, `Alliance`, `Solutions`, `Corp`, `Co`, `Services`, `Trust`, `TR`, etc. make sure, to extract all companies (case-insensitive).
    - Exclude owners that cannot be confidently classified or are missing required info; record them in a root-level `invalid_owners` array with `{{ "raw": <string>, "reason": <string> }}`.
  - Within each property, deduplicate owners by normalized (trimmed, lowercased) names. Exclude any null, empty, or duplicate owner values.

- **Date Extraction (for Historical Owners):**
  - Attempt to extract dates that associate with owner groups or historical records; identify dates located near relevant owners in the DOM.
  - Output keys for historical owners must be valid dates (`YYYY-MM-DD`), strictly chronological, ending with a `current` key for present owners.
  - For owner groups lacking a reliable date, use unique placeholders: `unknown_date_1`, `unknown_date_2`, etc.

- **Property ID Extraction:**
  - Attempt to find a unique property ID (fields like `property_id`, `Property ID`, `propId`); if not found, use `unknown_id` in the output key as `property_unknown_id`.

- **Schema and Output:**
  - Output a JSON object with a single top-level key: `property_<id>`
    - Contains `owners_by_date`: a map where each key is a date (or `current`/unknown placeholder), each mapping to an array of valid owners.
  - Saves the output as `{owner_data_file}`.

- **Script and Code Structure:**
  - All logic must reside in one `.js` file. Use only `cheerio` for parsing and Node's built-in modules as needed.
  - Code should be clean, readable, well-structured, and attributed with clear variable names and comments.
  - No CLI, validation, or extra interaction logic.

## Tasks

1. Analyze the HTML content provided in the user message as `input_html` to understand its structure
2. Create a transformation script.
3. Use `write_file` to write out created script to `{owner_script}`.
4. use `run_js` to test a script
5. If script fails - go back to step 2
6. Use `read_file` to assess results of the script
7. If result is not complete or invalid - go back to step 2

## Tool Usage

- Use `write_file` to write your script.
- Use `run_js` to test your script.
  Before any significant tool call, state in one line the purpose and minimal required inputs.
- Always review and validate your script’s output before concluding. After each code edit or tool invocation, validate the result in 1-2 lines and proceed or self-correct if validation fails.

## Output Example

```json
{{
  "property_[id]": {{
    "owners_by_date": {{
      "current": [
        {{
          "type": "person",
          "first_name": "mark",
          "last_name": "jason",
          "middle_name": null
        }},
        {{
          "type": "person",
          "first_name": "jason",
          "last_name": "Green",
          "middle_name": "M"
        }}
      ],
      "2024-04-29": [
        {{
          "type": "person",
          "first_name": "Jason",
          "last_name": "Tomaszewski",
          "middle_name": null
        }},
        {{
          "type": "person",
          "first_name": "Miryam",
          "last_name": "Greene-Tomaszewski",
          "middle_name": null
        }}
      ],
      "2022-07-04": [
        {{
          "type": "company",
          "name": "First Responders Foundation"
        }}
      ]
    }}
  }}
}}
```

## Additional Notes

- The script must only output the structured JSON via `console.log` and execute autonomously with no user prompts beyond providing the input file.
- Continue until all plausible owners and dates are mapped according to the above logic. Log ambiguities or exclusions in `invalid_owners` as described.
- Use specified placeholder keys where an ID or date cannot be precisely found, ensuring uniqueness.

## Other Details

- Do not output anything except the result JSON in the required format.
- All helper code must reside in the same file as the main script.

# Cherio documentation

<docs-cheerio>
## API

### Loading

First you need to load in the HTML. This step in jQuery is implicit, since
jQuery operates on the one, baked-in DOM. With Cheerio, we need to pass in the
HTML document.

```js
// ESM or TypeScript:
import * as cheerio from 'cheerio';

// In other environments:
const cheerio = require('cheerio');

const $ = cheerio.load('<ul id="fruits">...</ul>');

$.html();
//=> <html><head></head><body><ul id="fruits">...</ul></body></html>
```

### Selectors

Once you've loaded the HTML, you can use jQuery-style selectors to find elements
within the document.

#### \$( selector, [context], [root] )

`selector` searches within the `context` scope which searches within the `root`
scope. `selector` and `context` can be a string expression, DOM Element, array
of DOM elements, or cheerio object. `root`, if provided, is typically the HTML
document string.

This selector method is the starting point for traversing and manipulating the
document. Like in jQuery, it's the primary method for selecting elements in the
document.

```js
$('.apple', '#fruits').text();
//=> Apple

$('ul .pear').attr('class');
//=> pear

$('li[class=orange]').html();
//=> Orange
```

### The "DOM Node" object

Cheerio collections are made up of objects that bear some resemblance to
browser-based DOM nodes.
You can expect them to define the following properties:

- `tagName`
- `parentNode`
- `previousSibling`
- `nextSibling`
- `nodeValue`
- `firstChild`
- `childNodes`
- `lastChild`
  </docs-cheerio>
