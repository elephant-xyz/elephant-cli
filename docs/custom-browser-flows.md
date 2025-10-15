# Custom Browser Flows

## Overview

Custom browser flows allow you to define complex, site-specific browser automation workflows without being constrained by predefined templates. You can create a JSON file that describes exactly what actions the browser should take, providing maximum flexibility for handling unique website structures.

## Table of Contents

- [When to Use Custom Flows](#when-to-use-custom-flows)
- [Quick Start](#quick-start)
- [Workflow Structure](#workflow-structure)
- [Available Actions](#available-actions)
- [Dynamic Values](#dynamic-values)
- [Capture Configuration](#capture-configuration)
- [Complete Examples](#complete-examples)
- [Validation and Error Handling](#validation-and-error-handling)
- [Best Practices](#best-practices)

## When to Use Custom Flows

Use custom browser flows when:

- **Templates are too limiting**: Your workflow requires specific actions not covered by existing templates
- **Complex multi-step interactions**: Multiple iframes, conditional clicks, or unusual navigation patterns
- **Site-specific requirements**: The website has a unique structure that doesn't fit standard patterns
- **Precise control needed**: You need exact control over timing, selectors, and action sequences

Consider using [browser flow templates](./browser-flow-templates.md) when your use case fits a standard pattern, as they provide simpler parameter-based configuration.

## Quick Start

### 1. Create a workflow JSON file

```json
{
  "starts_at": "open_page",
  "states": {
    "open_page": {
      "type": "open_page",
      "input": {
        "url": "{{=it.url}}",
        "timeout": 30000,
        "wait_until": "domcontentloaded"
      },
      "next": "enter_parcel_id"
    },
    "enter_parcel_id": {
      "type": "type",
      "input": {
        "selector": "#parcel-search",
        "value": "{{=it.request_identifier}}",
        "delay": 100
      },
      "next": "press_enter"
    },
    "press_enter": {
      "type": "keyboard_press",
      "input": {
        "key": "Enter"
      },
      "next": "wait_for_results"
    },
    "wait_for_results": {
      "type": "wait_for_selector",
      "input": {
        "selector": "#property-details",
        "timeout": 60000,
        "visible": true
      },
      "end": true
    }
  }
}
```

### 2. Use it with the prepare command

```bash
npx elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-file workflow.json
```

## Workflow Structure

A workflow is a JSON object with the following top-level properties:

```typescript
{
  "starts_at": "state_name",        // Required: Initial state to execute
  "states": {                        // Required: Map of state definitions
    "state_name": { ... }
  },
  "capture": {                       // Optional: Content capture configuration
    "type": "page" | "iframe",
    "selector": "iframe_selector"    // Required when type is "iframe"
  }
}
```

### State Definition

Each state represents a single action and has this structure:

```typescript
{
  "type": "action_type",             // Required: Type of action to perform
  "input": { ... },                  // Required: Action-specific parameters
  "next": "next_state_name",         // Optional: Next state to execute
  "next_map": { ... },               // Optional: For wait_for_selector_race - conditional routing
  "result": "variable_name",         // Optional: Store result in variable
  "end": true                        // Optional: Mark this as final state
}
```

**Important**: Either `next`, `next_map` (for `wait_for_selector_race`), or `end: true` must be specified.

## Available Actions

### open_page

Navigate to a URL.

```json
{
  "type": "open_page",
  "input": {
    "url": "https://example.com",                    // Required
    "timeout": 30000,                                 // Optional (default: 30000ms)
    "wait_until": "domcontentloaded"                 // Optional (default: domcontentloaded)
  }
}
```

**wait_until options**: `load`, `domcontentloaded`, `networkidle0`, `networkidle2`

### wait_for_selector

Wait for an element to appear.

```json
{
  "type": "wait_for_selector",
  "input": {
    "selector": "#element-id",                       // Required: CSS selector
    "timeout": 60000,                                // Optional (default: 30000ms)
    "visible": true,                                 // Optional (default: false)
    "iframe_selector": "#iframe-id"                  // Optional: Selector for iframe context
  },
  "continue_on_timeout": true,                       // Optional: Continue even if selector times out
  "next_on_timeout": "fallback_state"                // Optional: State to go to on timeout
}
```

**Timeout Handling**: Use `continue_on_timeout: true` to gracefully handle cases where an element might not appear. This is useful for:
- Optional elements (e.g., disclaimer buttons that may or may not show)
- Implementing delays without using a selector (wait for a non-existent element)
- Handling intermittent UI elements

**Important**: When `continue_on_timeout: true` is set, you **must** also specify `next_on_timeout` to define which state to go to when the timeout occurs. If `next_on_timeout` is missing, an error will be thrown.

**Example - Optional Element**:
```json
{
  "wait_for_optional_button": {
    "type": "wait_for_selector",
    "input": {
      "selector": "#disclaimer-button",
      "timeout": 10000,
      "visible": true
    },
    "continue_on_timeout": true,
    "next": "click_disclaimer",
    "next_on_timeout": "enter_search"
  }
}
```

**Example - Delay/Sleep**:
```json
{
  "wait_5_seconds": {
    "type": "wait_for_selector",
    "input": {
      "selector": "#non-existent-element",
      "timeout": 5000
    },
    "continue_on_timeout": true,
    "next": "next_step",
    "next_on_timeout": "next_step"
  }
}
```

### wait_for_selector_race

Wait for multiple selectors in parallel and proceed with whichever appears first. This is useful for handling pages where different elements might appear depending on the scenario (e.g., a search form might appear immediately, or a disclaimer button might appear first).

```json
{
  "type": "wait_for_selector_race",
  "input": {
    "selectors": [                                    // Required: Array of selectors to race
      {
        "selector": "#search-form",                   // Required: CSS selector
        "label": "search_form",                       // Required: Label for routing
        "timeout": 30000                              // Optional (default: 30000ms)
      },
      {
        "selector": "#disclaimer-button",
        "label": "disclaimer",
        "timeout": 30000
      }
    ],
    "visible": true,                                  // Optional (default: false)
    "iframe_selector": "#frame-id"                    // Optional: Selector for iframe context
  },
  "next_map": {                                       // Required: Routing based on winner
    "search_form": "enter_search",
    "disclaimer": "click_disclaimer"
  },
  "validate_winner": {                                // Optional: Post-race validation
    "search_form": {
      "check_selector": "#disclaimer-button",         // Check if this also exists
      "if_exists_goto": "click_disclaimer"            // If yes, go here instead
    }
  }
}
```

**How It Works**:
1. All selectors are checked in parallel using `Promise.race()`
2. The first selector that appears wins the race
3. The workflow routes to the state specified in `next_map` for that label
4. **Optional validation**: If `validate_winner` is configured, it checks if another selector also exists and can redirect accordingly

**Winner Validation**: The `validate_winner` feature ensures correct priority when multiple elements are present. For example, if the search form appears first but a disclaimer button also exists on the page, you can redirect to click the disclaimer first.

**Example - Handle Optional Disclaimer**:
```json
{
  "check_page_state": {
    "type": "wait_for_selector_race",
    "input": {
      "selectors": [
        {
          "selector": "#search-input",
          "label": "search_ready",
          "timeout": 30000
        },
        {
          "selector": "button#accept-terms",
          "label": "terms_button",
          "timeout": 30000
        }
      ],
      "visible": true
    },
    "next_map": {
      "search_ready": "enter_search",
      "terms_button": "click_terms"
    },
    "validate_winner": {
      "search_ready": {
        "check_selector": "button#accept-terms",
        "if_exists_goto": "click_terms"
      }
    }
  }
}
```

**Example - Multiple Disclaimer Screens**:
```json
{
  "check_for_disclaimers": {
    "type": "wait_for_selector_race",
    "input": {
      "selectors": [
        {
          "selector": "#search-form",
          "label": "form",
          "timeout": 30000
        },
        {
          "selector": "#disclaimer1",
          "label": "disclaimer1",
          "timeout": 30000
        },
        {
          "selector": "#disclaimer2",
          "label": "disclaimer2",
          "timeout": 30000
        }
      ],
      "visible": true
    },
    "next_map": {
      "form": "enter_parcel_id",
      "disclaimer1": "click_disclaimer1",
      "disclaimer2": "click_disclaimer2"
    }
  }
}
```

### click

Click an element.

```json
{
  "type": "click",
  "input": {
    "selector": "button.submit",                     // Required: CSS selector
    "iframe_selector": "#iframe-id"                  // Optional: Selector for iframe context
  }
}
```

### type

Type text into an input field.

```json
{
  "type": "type",
  "input": {
    "selector": "input#search",                      // Required: CSS selector
    "value": "text to type",                         // Required: Text to type
    "delay": 100,                                    // Optional: Delay between keystrokes (ms)
    "iframe_selector": "#iframe-id"                  // Optional: Selector for iframe context
  }
}
```

### keyboard_press

Press a keyboard key.

```json
{
  "type": "keyboard_press",
  "input": {
    "key": "Enter"                                   // Required: Key to press
  }
}
```

**Common keys**: `Enter`, `Tab`, `Escape`, `ArrowDown`, `ArrowUp`, `Backspace`

## Dynamic Values

You can use template syntax to inject runtime values into your workflow:

| Variable | Description | Example |
|----------|-------------|---------|
| `{{=it.request_identifier}}` | Parcel ID from input data | `"12-34-56-789"` |
| `{{=it.url}}` | URL from `source_http_request` | `"https://example.com/search"` |
| `{{=it.variable_name}}` | Stored result from previous state | Depends on state |

### Storing and Using Results

Use the `result` field to store values from `wait_for_selector` actions:

```json
{
  "states": {
    "find_button": {
      "type": "wait_for_selector",
      "input": {
        "selector": "button.continue"
      },
      "result": "continue_button",                   // Store selector
      "next": "click_button"
    },
    "click_button": {
      "type": "click",
      "input": {
        "selector": "{{=it.continue_button}}"        // Use stored value
      },
      "end": true
    }
  }
}
```

## Capture Configuration

Control what content is captured at the end of the workflow:

### Capture Entire Page (Default)

```json
{
  "capture": {
    "type": "page"
  }
}
```

Or omit the `capture` field entirely - page capture is the default.

### Capture from IFrame

```json
{
  "capture": {
    "type": "iframe",
    "selector": "#main-content-frame"
  }
}
```

## Complete Examples

### Example 1: Simple Search Flow

Basic parcel ID search with direct URL navigation:

```json
{
  "starts_at": "open_page",
  "states": {
    "open_page": {
      "type": "open_page",
      "input": {
        "url": "{{=it.url}}",
        "timeout": 30000
      },
      "next": "enter_parcel"
    },
    "enter_parcel": {
      "type": "type",
      "input": {
        "selector": "input#parcel-id",
        "value": "{{=it.request_identifier}}",
        "delay": 50
      },
      "next": "submit_search"
    },
    "submit_search": {
      "type": "keyboard_press",
      "input": {
        "key": "Enter"
      },
      "next": "wait_results"
    },
    "wait_results": {
      "type": "wait_for_selector",
      "input": {
        "selector": "div.property-details",
        "timeout": 60000,
        "visible": true
      },
      "end": true
    }
  }
}
```

### Example 2: Multi-Step with Disclaimer Buttons

Handle two disclaimer screens before searching:

```json
{
  "starts_at": "open_page",
  "states": {
    "open_page": {
      "type": "open_page",
      "input": {
        "url": "{{=it.url}}"
      },
      "next": "wait_first_disclaimer"
    },
    "wait_first_disclaimer": {
      "type": "wait_for_selector",
      "input": {
        "selector": "button#accept-terms",
        "timeout": 15000,
        "visible": true
      },
      "next": "click_first_disclaimer"
    },
    "click_first_disclaimer": {
      "type": "click",
      "input": {
        "selector": "button#accept-terms"
      },
      "next": "wait_second_disclaimer"
    },
    "wait_second_disclaimer": {
      "type": "wait_for_selector",
      "input": {
        "selector": "button#continue",
        "timeout": 15000,
        "visible": true
      },
      "next": "click_second_disclaimer"
    },
    "click_second_disclaimer": {
      "type": "click",
      "input": {
        "selector": "button#continue"
      },
      "next": "wait_search_form"
    },
    "wait_search_form": {
      "type": "wait_for_selector",
      "input": {
        "selector": "input#search",
        "timeout": 30000,
        "visible": true
      },
      "next": "enter_parcel"
    },
    "enter_parcel": {
      "type": "type",
      "input": {
        "selector": "input#search",
        "value": "{{=it.request_identifier}}"
      },
      "next": "submit"
    },
    "submit": {
      "type": "keyboard_press",
      "input": {
        "key": "Enter"
      },
      "next": "wait_results"
    },
    "wait_results": {
      "type": "wait_for_selector",
      "input": {
        "selector": "div.results",
        "timeout": 60000,
        "visible": true
      },
      "end": true
    }
  }
}
```

### Example 3: Working with IFrames

Search within an iframe and capture its content:

```json
{
  "starts_at": "open_page",
  "capture": {
    "type": "iframe",
    "selector": "iframe#search-frame"
  },
  "states": {
    "open_page": {
      "type": "open_page",
      "input": {
        "url": "{{=it.url}}"
      },
      "next": "wait_iframe"
    },
    "wait_iframe": {
      "type": "wait_for_selector",
      "input": {
        "selector": "iframe#search-frame",
        "timeout": 30000
      },
      "next": "enter_parcel"
    },
    "enter_parcel": {
      "type": "type",
      "input": {
        "selector": "input#parcel-search",
        "value": "{{=it.request_identifier}}",
        "iframe_selector": "iframe#search-frame"
      },
      "next": "submit"
    },
    "submit": {
      "type": "keyboard_press",
      "input": {
        "key": "Enter"
      },
      "next": "wait_results"
    },
    "wait_results": {
      "type": "wait_for_selector",
      "input": {
        "selector": "table.results",
        "timeout": 60000,
        "visible": true,
        "iframe_selector": "iframe#search-frame"
      },
      "end": true
    }
  }
}
```

### Example 4: Click Through to Details Page

Search, then click on the first result to view details:

```json
{
  "starts_at": "open_page",
  "states": {
    "open_page": {
      "type": "open_page",
      "input": {
        "url": "{{=it.url}}"
      },
      "next": "enter_parcel"
    },
    "enter_parcel": {
      "type": "type",
      "input": {
        "selector": "input#search",
        "value": "{{=it.request_identifier}}"
      },
      "next": "submit"
    },
    "submit": {
      "type": "keyboard_press",
      "input": {
        "key": "Enter"
      },
      "next": "wait_results"
    },
    "wait_results": {
      "type": "wait_for_selector",
      "input": {
        "selector": "table.results tbody tr",
        "timeout": 60000,
        "visible": true
      },
      "next": "click_first_result"
    },
    "click_first_result": {
      "type": "click",
      "input": {
        "selector": "table.results tbody tr:first-child td:nth-child(2)"
      },
      "next": "wait_details"
    },
    "wait_details": {
      "type": "wait_for_selector",
      "input": {
        "selector": "#property-details",
        "timeout": 60000,
        "visible": true
      },
      "end": true
    }
  }
}
```

### Example 5: Multiple IFrames

Navigate through nested iframes:

```json
{
  "starts_at": "open_page",
  "capture": {
    "type": "iframe",
    "selector": "iframe#content-frame"
  },
  "states": {
    "open_page": {
      "type": "open_page",
      "input": {
        "url": "{{=it.url}}"
      },
      "next": "click_disclaimer"
    },
    "click_disclaimer": {
      "type": "click",
      "input": {
        "selector": "button#accept"
      },
      "next": "wait_search_iframe"
    },
    "wait_search_iframe": {
      "type": "wait_for_selector",
      "input": {
        "selector": "iframe#search-frame",
        "timeout": 30000
      },
      "next": "enter_search"
    },
    "enter_search": {
      "type": "type",
      "input": {
        "selector": "input#query",
        "value": "{{=it.request_identifier}}",
        "iframe_selector": "iframe#search-frame"
      },
      "next": "submit"
    },
    "submit": {
      "type": "click",
      "input": {
        "selector": "button#search-btn",
        "iframe_selector": "iframe#search-frame"
      },
      "next": "wait_results"
    },
    "wait_results": {
      "type": "wait_for_selector",
      "input": {
        "selector": "table.results",
        "timeout": 60000,
        "visible": true,
        "iframe_selector": "iframe#search-frame"
      },
      "next": "click_result"
    },
    "click_result": {
      "type": "click",
      "input": {
        "selector": "table.results tr:first-child",
        "iframe_selector": "iframe#search-frame"
      },
      "next": "wait_content_iframe"
    },
    "wait_content_iframe": {
      "type": "wait_for_selector",
      "input": {
        "selector": "iframe#content-frame",
        "timeout": 30000
      },
      "next": "wait_property_details"
    },
    "wait_property_details": {
      "type": "wait_for_selector",
      "input": {
        "selector": "#property-info",
        "timeout": 60000,
        "visible": true,
        "iframe_selector": "iframe#content-frame"
      },
      "end": true
    }
  }
}
```

## Validation and Error Handling

### Validation Rules

The workflow is validated before execution:

1. **Required fields**: `starts_at` and `states` must be present
2. **State references**: All `next` and `starts_at` must reference existing states
3. **Action types**: Must be one of the valid action types
4. **Input parameters**: Each action type has required and optional parameters
5. **Flow completion**: At least one state must have `end: true` or be a terminal state
6. **Capture config**: If type is `iframe`, selector must be provided

### Common Validation Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `starts_at references unknown state` | The initial state name doesn't exist | Check state name spelling |
| `next references unknown state` | A `next` field points to non-existent state | Verify all state names |
| `input.url must be a non-empty string` | Missing or empty URL in `open_page` | Provide valid URL |
| `selector must be a non-empty string` | Empty selector | Provide valid CSS selector |
| `states must contain at least one state` | Empty states object | Add at least one state |

### Runtime Errors

If the workflow fails during execution:

- **Timeout errors**: Increase timeout values for slow-loading elements
- **Selector not found**: Verify selectors using browser dev tools
- **IFrame errors**: Ensure iframe exists before trying to access it
- **Navigation errors**: Check URL validity and network connectivity

## Best Practices

### 1. Use Descriptive State Names

```json
// Good
"wait_for_disclaimer_button"
"click_accept_terms"
"enter_parcel_id"

// Bad
"step1"
"action2"
"wait1"
```

### 2. Set Appropriate Timeouts

```json
// Short timeout for expected elements
"timeout": 10000

// Longer timeout for search results or slow operations
"timeout": 60000
```

### 3. Mark Elements as Visible When Needed

```json
{
  "type": "wait_for_selector",
  "input": {
    "selector": "button#submit",
    "visible": true  // Ensures button is actually visible, not just in DOM
  }
}
```

### 4. Use IFrame Selectors Consistently

When working with iframes, always specify `iframe_selector` for all actions within that iframe:

```json
// All actions on elements inside the iframe need iframe_selector
{
  "type": "type",
  "input": {
    "selector": "#input",
    "iframe_selector": "#main-frame"  // ✓ Correct
  }
}
```

### 5. Test Selectors First

Before creating your workflow, test selectors in browser console:

```javascript
// Main page
document.querySelector('#your-selector')

// Inside iframe
document.querySelector('iframe#frame-selector').contentDocument.querySelector('#element')
```

### 6. Keep Workflows Readable

Use proper JSON formatting and organize complex workflows with comments (in a separate doc):

```json
{
  "starts_at": "open_page",
  "states": {
    "open_page": {
      "type": "open_page",
      "input": { "url": "{{=it.url}}" },
      "next": "handle_disclaimer"
    },

    "handle_disclaimer": {
      "type": "click",
      "input": { "selector": "#accept" },
      "next": "enter_search"
    }
  }
}
```

### 7. Handle Different Capture Scenarios

Choose the right capture configuration:

```json
// Capture main page (default)
"capture": { "type": "page" }

// Capture specific iframe with results
"capture": { "type": "iframe", "selector": "#results-frame" }
```

### 8. Debug with Non-Headless Mode

Test your workflow visually:

```bash
npx elephant-cli prepare input.zip \
  --output-zip output.zip \
  --browser-flow-file workflow.json \
  --no-headless
```

### 9. Version Control Your Workflows

Store workflow files in version control with meaningful names:

```
workflows/
  ├── county-a-search.json
  ├── county-b-with-disclaimers.json
  └── county-c-iframe-search.json
```

### 10. Document Site-Specific Requirements

Keep notes about why certain steps are needed:

```
workflow-notes.md:
- County X requires 2 disclaimer clicks before search
- Results are in nested iframe #content > #results
- Must wait for visible: true on search button (it's hidden initially)
```

## Troubleshooting

### Workflow Doesn't Execute

1. **Check validation**: Run the command and look for validation errors
2. **Verify JSON**: Ensure your JSON is valid (use a JSON validator)
3. **Check file path**: Make sure the path to your workflow file is correct

### Elements Not Found

1. **Test selectors**: Use browser dev tools to verify selectors
2. **Check timing**: Element might not be loaded yet - increase timeout
3. **IFrame context**: If element is in iframe, add `iframe_selector`
4. **Visibility**: Try adding `"visible": true` to wait_for_selector

### Capture Returns Wrong Content

1. **Check capture config**: Verify you're capturing from the right source
2. **Wait for content**: Ensure the final state waits for all content to load
3. **IFrame timing**: When capturing from iframe, ensure it's fully loaded

### Timeout Errors

1. **Increase timeouts**: Some sites are slow to respond
2. **Check network**: Verify the site is accessible
3. **Simplify workflow**: Test each step individually to isolate the issue

## Getting Help

If you encounter issues:

1. Review this documentation and examples
2. Test your selectors in browser dev tools
3. Run with `--no-headless` to visually debug
4. Enable debug logging: `LOG_LEVEL=debug npx elephant-cli prepare ...`
5. Check validation error messages for specific issues

For more information on browser flows, see:
- [Browser Flow Templates](./browser-flow-templates.md) - Pre-built template options
- [README](../README.md) - General CLI documentation
