# Browser Flow Templates

## Overview

Browser Flow Templates provide a flexible and reusable way to automate browser interactions for different county appraiser websites. Instead of hardcoding browser automation logic, you can use predefined templates with customizable parameters to handle various website structures.

## Table of Contents

- [Quick Start](#quick-start)
- [Available Templates](#available-templates)
- [Using Browser Flow Templates](#using-browser-flow-templates)
- [Template Parameters](#template-parameters)
- [Creating Custom Templates](#creating-custom-templates)
- [Migration from Legacy Approach](#migration-from-legacy-approach)
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
2. Optionally handle a continue/accept button
3. Enter a parcel ID into a search form
4. Submit the search
5. Wait for results to load

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

# With continue button
npx elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "continue_button_selector": ".btn.btn-primary.button-1",
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
| `continue_button_selector` | string | No | CSS selector for the continue/accept button (if present) |

**Note:** The URL is automatically extracted from your input data's `property_seed.json` file and does not need to be specified as a parameter.

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
- **wait_for_selector**: Wait for an element to appear
- **click**: Click an element
- **type**: Type text into an input field
- **keyboard_press**: Press a keyboard key (e.g., Enter)

### Dynamic Values

Templates support dynamic values using dot template syntax:

- `{{=it.request_identifier}}`: The parcel ID from the input data
- `{{=it.continue_button}}`: Stored result from a previous step

## Migration from Legacy Approach

### From WEIRED_COUNTY Environment Variable

The `WEIRED_COUNTY` environment variable is now deprecated. Replace:

```bash
# Old approach (deprecated)
WEIRED_COUNTY=1 npx elephant-cli prepare input.zip --output-zip output.zip

# New approach
npx elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-template SEARCH_BY_PARCEL_ID \
  --browser-flow-parameters '{
    "continue_button_selector": ".btn.btn-primary.button-1",
    "search_form_selector": "#ctlBodyPane_ctl03_ctl01_txtParcelID",
    "search_result_selector": "#ctlBodyPane_ctl10_ctl01_lstBuildings_ctl00_dynamicBuildingDataRightColumn_divSummary"
  }'
```

The URL is now automatically extracted from the input data, eliminating the need to hardcode it in the workflow.

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

### Example 3: Using with Shell Scripts

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

### Debugging Tips

1. **Test Selectors**: Use browser developer tools to verify CSS selectors:
   ```javascript
   document.querySelector('#your-selector')
   ```

2. **Run Without Headless Mode**: Debug browser interactions visually:
   ```bash
   npx elephant-cli prepare input.zip \
     --output-zip output.zip \
     --no-headless \
     --browser-flow-template SEARCH_BY_PARCEL_ID \
     --browser-flow-parameters '{"...":"..."}'
   ```

3. **Check Logs**: Enable debug logging for detailed execution information:
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