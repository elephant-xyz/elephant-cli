# Browser Flow Templates

## Overview

Browser Flow Templates provide a flexible and reusable way to automate browser interactions for different county appraiser websites. Instead of hardcoding browser automation logic, you can use predefined templates with customizable parameters to handle various website structures.

## Table of Contents

- [Quick Start](#quick-start)
- [Available Templates](#available-templates)
- [Using Browser Flow Templates](#using-browser-flow-templates)
- [Template Parameters](#template-parameters)
- [Creating Custom Templates](#creating-custom-templates)
- [Examples](#examples)
- [Troubleshooting](#troubleshooting)

## Quick Start

To use a browser flow template with the `prepare` command:

```bash
npx elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{"search_form_selector":"#search","search_result_selector":"#results"}'
```

**Note:** The URL is automatically extracted from the `property_seed.json` file's `source_http_request` field in your input ZIP file.

## Available Templates

### SEARCH_BY_PARCEL_ID

This template automates the process of searching for property information by parcel ID on county appraiser websites.

**Use Case:** When you need to:
1. Navigate to a property search page
2. Optionally handle up to two continue/accept buttons in sequence
3. Enter a parcel ID into a search form
4. Submit the search
5. Wait for results to load
6. Optionally click on a property details button
7. Work with content inside iframes

## Using Browser Flow Templates

### Command Line Options

The `prepare` command supports two new options for browser flow templates:

- `--browser-flow-template <template>`: Specifies the template name (e.g., `SEARCH_BY_PARCEL_ID`)
- `--browser-flow-parameters <json>`: JSON string containing template parameters

### Basic Usage

```bash
# Minimal parameters (no continue button)
npx elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "search_form_selector": "#ctlBodyPane_ctl03_ctl01_txtParcelID",
    "search_result_selector": "#results"
  }'

# With one continue button
npx elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "continue_button_selector": ".btn.btn-primary.button-1",
    "search_form_selector": "#ctlBodyPane_ctl03_ctl01_txtParcelID",
    "search_result_selector": "#ctlBodyPane_ctl10_ctl01_lstBuildings_ctl00"
  }'

# With two continue buttons
npx elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "continue_button_selector": ".btn-accept-terms",
    "continue2_button_selector": ".btn-disclaimer-agree",
    "search_form_selector": "#ctlBodyPane_ctl03_ctl01_txtParcelID",
    "search_result_selector": "#ctlBodyPane_ctl10_ctl01_lstBuildings_ctl00"
  }'
```

**Important:** The URL is not part of the parameters. It's automatically constructed from the `source_http_request` field in the `property_seed.json` file within your input ZIP.

## Template Parameters

### SEARCH_BY_PARCEL_ID Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `search_form_selector` | string | Yes | CSS selector for the parcel ID search input field |
| `search_result_selector` | string | Yes | CSS selector to wait for when search results load |
| `continue_button_selector` | string | No | CSS selector for the first continue/accept button (if present) |
| `continue2_button_selector` | string | No | CSS selector for the second continue/accept button (if present) |
| `property_details_button` | string | No | CSS selector for property details button to click after search results |
| `property_details_selector` | string | No | CSS selector to wait for after clicking property details button |
| `iframe_selector` | string | No | CSS selector for iframe containing the search form and results |
| `capture_iframe_selector` | string | No | CSS selector for iframe to capture final content from |

**Note:** The URL is automatically extracted from your input data's `property_seed.json` file and does not need to be specified as a parameter.

**Optional Continue Buttons:** The `continue_button_selector` and `continue2_button_selector` parameters handle intermittent disclaimer/terms acceptance dialogs. The workflow intelligently waits for either the search form or continue buttons to appear, whichever comes first, eliminating unnecessary waiting time. If a button appears, it's clicked and the process repeats until the search form is found. This works efficiently whether buttons are present or not.

### Parameter Validation

All parameters are validated before execution:
- Required parameters must be present
- String parameters must meet minimum length requirements
- Unknown parameters will cause validation errors

If validation fails, the command will display detailed error messages explaining what needs to be corrected.

## Creating Custom Templates

While custom template creation is an advanced feature, here's the basic structure:

### Template Structure

Templates are defined in `src/lib/browser-flow/templates/` and must implement the `BrowserFlowTemplate` interface:

```typescript
interface BrowserFlowTemplate {
  id: string;                          // Unique template identifier
  name: string;                        // Human-readable name
  description: string;                 // Template description
  parametersSchema: ParametersSchema;  // JSON Schema for parameters
  createWorkflow: (params) => Workflow; // Function to generate workflow
}
```

### Workflow Actions

Templates can use the following workflow actions:

- **open_page**: Navigate to a URL
- **wait_for_selector**: Wait for an element to appear (supports `iframe_selector`)
- **click**: Click an element (supports `iframe_selector`)
- **type**: Type text into an input field (supports `iframe_selector`)
- **keyboard_press**: Press a keyboard key (e.g., Enter)

**Note:** Actions marked with `iframe_selector` support can operate on elements inside an iframe by specifying the `iframe_selector` parameter.

### Dynamic Values

Templates support dynamic values using dot template syntax:

- `{{=it.request_identifier}}`: The parcel ID from the input data
- `{{=it.continue_button}}`: Stored result from a previous step

## Examples

### Example 1: Simple Search Form

For a website with a straightforward search form and no modal dialogs:

```bash
npx elephant-cli prepare property_data.zip \
  --output-zip prepared_data.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "search_form_selector": "input#parcel-search",
    "search_result_selector": "div.property-details"
  }'
```

### Example 2: Complex Multi-Step Flow

For a website that requires accepting terms before searching:

```bash
npx elephant-cli prepare property_data.zip \
  --output-zip prepared_data.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "continue_button_selector": "button.accept-terms",
    "search_form_selector": "input[name=\"parcelId\"]",
    "search_result_selector": "section.assessment-results"
  }'
```

### Example 3: Multiple Continue Buttons

For websites with multiple disclaimer/agreement screens:

```bash
npx elephant-cli prepare property_data.zip \
  --output-zip prepared_data.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "continue_button_selector": "#terms-accept-btn",
    "continue2_button_selector": "#disclaimer-continue",
    "search_form_selector": "input.parcel-search",
    "search_result_selector": "div.property-info"
  }'
```

### Example 4: Working with IFrames

For websites where the search form is inside an iframe:

```bash
npx elephant-cli prepare property_data.zip \
  --output-zip prepared_data.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "search_form_selector": "input#parcel-search",
    "search_result_selector": ".resultstable",
    "iframe_selector": "iframe#recordSearchContent_1_iframe",
    "capture_iframe_selector": "iframe#recordSearchContent_1_iframe"
  }'
```

**Note:** 
- `iframe_selector` tells the workflow where to find elements (form, buttons, etc.)
- `capture_iframe_selector` specifies which iframe's content to capture at the end

### Example 5: Clicking Property Details

For websites that show search results as a list and require clicking for details:

```bash
npx elephant-cli prepare property_data.zip \
  --output-zip prepared_data.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "search_form_selector": "#searchInput",
    "search_result_selector": ".property-list-item",
    "property_details_button": ".property-list-item:first-child a",
    "property_details_selector": "#ownerDiv",
    "iframe_selector": "iframe#mainContent",
    "capture_iframe_selector": "iframe#mainContent"
  }'
```

### Example 6: Complete Workflow with All Features

For complex websites with disclaimers, iframes, and property details pages:

```bash
npx elephant-cli prepare property_data.zip \
  --output-zip prepared_data.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "continue_button_selector": "button.accept-terms",
    "search_form_selector": "input[name=\"parcelId\"]",
    "search_result_selector": "table.resultstable > tbody > tr.hv",
    "property_details_button": "table.resultstable > tbody > tr.hv > td:nth-child(2)",
    "property_details_selector": "#ownerDiv",
    "iframe_selector": "iframe#recordSearchContent_1_iframe",
    "capture_iframe_selector": "iframe#recordSearchContent_1_iframe"
  }'
```

This example:
1. Clicks a disclaimer/accept button
2. Works inside an iframe for the search form
3. Waits for search results in the iframe
4. Clicks on the first property in the results
5. Waits for property details to load
6. Captures the final content from the iframe

### Example 7: Using with Shell Scripts

Create a reusable configuration:

```bash
#!/bin/bash
# prepare-county-data.sh

TEMPLATE="SEARCH_BY_PARCEL_ID"
PARAMS='{
  "continue_button_selector": ".btn.btn-primary.button-1",
  "search_form_selector": "#ctlBodyPane_ctl03_ctl01_txtParcelID",
  "search_result_selector": "#results"
}'

npx elephant-cli prepare "$1" \
  --output-zip "$2" \
  --browser-flow-template "$TEMPLATE" \
  --browser-flow-parameters "$PARAMS"
```

## Troubleshooting

### Common Issues

1. **"Template not found" Error**
   - Verify the template name is spelled correctly
   - Check available templates using the error message output

2. **"Invalid parameters JSON format" Error**
   - Ensure parameters are valid JSON
   - Use single quotes around the JSON string in bash
   - Escape special characters if needed

3. **"Missing required parameter" Error**
   - Check that all required parameters are included
   - Refer to the parameter table for required fields

4. **Selector Timeout Errors**
   - Verify selectors are correct using browser developer tools
   - Ensure the page has loaded before the selector is searched
   - Consider increasing timeout values in custom templates

5. **IFrame Not Found Error**
   - Verify the iframe selector is correct
   - Ensure the iframe has loaded before trying to access it
   - Check if the iframe has a `name` or `id` attribute you can target

6. **Elements Not Found Inside IFrame**
   - Make sure you're using `iframe_selector` parameter for operations inside iframes
   - Use `capture_iframe_selector` to specify which iframe content to capture
   - Elements inside iframes require the iframe to be specified explicitly

### Debugging Tips

1. **Test Selectors**: Use browser developer tools to verify CSS selectors:
   ```javascript
   document.querySelector('#your-selector')
   ```

2. **Test IFrame Selectors**: To test selectors inside an iframe:
   ```javascript
   // First, get the iframe
   const iframe = document.querySelector('iframe#your-iframe-selector');
   // Then test selectors within it
   iframe.contentDocument.querySelector('#element-inside-iframe');
   ```

3. **Run Without Headless Mode**: Debug browser interactions visually:
   ```bash
   npx elephant-cli prepare input.zip \
     --output-zip output.zip \
     --no-headless \
     --browser-flow-template SEARCH_BY_PARCEL_ID \
     --browser-flow-parameters '{"...":"..."}'
   ```

4. **Check Logs**: Enable debug logging for detailed execution information:
   ```bash
   LOG_LEVEL=debug npx elephant-cli prepare ...
   ```

### Getting Help

If you encounter issues:

1. Check this documentation for examples and parameter requirements
2. Verify your selectors using browser developer tools
3. Review the error messages - they provide specific details about what went wrong
4. Report issues at: https://github.com/anthropics/claude-code/issues

## Technical Details

### Architecture

The browser flow template system consists of:

1. **Template Definitions**: Located in `src/lib/browser-flow/templates/`
2. **Template Registry**: Manages available templates
3. **Parameter Validator**: Ensures parameters meet schema requirements
4. **Workflow Generator**: Creates Puppeteer automation workflows
5. **Execution Engine**: Runs the generated workflows using Puppeteer

### Workflow Execution

When a browser flow template is used:

1. The template is loaded from the registry
2. Parameters are parsed and validated against the template schema
3. A workflow is generated with the provided parameters
4. The workflow is executed using Puppeteer
5. The resulting HTML is cleaned and returned

### Schema Validation

Parameters are validated using a JSON Schema-like structure that supports:
- Type checking (string, number, boolean)
- Required field validation
- String length constraints
- Pattern matching (regex)
- Custom validation rules

This ensures that workflows receive valid inputs and fail fast with helpful error messages when parameters are incorrect.