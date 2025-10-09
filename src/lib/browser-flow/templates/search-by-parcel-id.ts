import {
  BrowserFlowTemplate,
  BrowserFlowParameters,
  BrowserFlowContext,
} from '../types.js';
import { Workflow } from '../../withBrowserFlow.js';

export const SEARCH_BY_PARCEL_ID: BrowserFlowTemplate = {
  id: 'SEARCH_BY_PARCEL_ID',
  name: 'Search by Parcel ID',
  description:
    'Browser flow template for searching property information by parcel ID',
  parametersSchema: {
    type: 'object',
    properties: {
      continue_button_selector: {
        type: 'string',
        description: 'CSS selector for the continue/accept button (if present)',
        minLength: 1,
      },
      continue2_button_selector: {
        type: 'string',
        description:
          'CSS selector for the second continue/accept button (if present)',
        minLength: 1,
      },
      search_form_selector: {
        type: 'string',
        description: 'CSS selector for the parcel ID search input field',
        minLength: 1,
      },
      search_result_selector: {
        type: 'string',
        description: 'CSS selector to wait for when search results load',
        minLength: 1,
      },
      property_details_button: {
        type: 'string',
        description:
          'CSS selector for property details button to click after search results',
        minLength: 1,
      },
      property_details_selector: {
        type: 'string',
        description:
          'CSS selector to wait for after clicking property details button',
        minLength: 1,
      },
      iframe_selector: {
        type: 'string',
        description:
          'CSS selector for iframe containing the search form and results',
        minLength: 1,
      },
      capture_iframe_selector: {
        type: 'string',
        description: 'CSS selector for iframe to capture content from',
        minLength: 1,
      },
    },
    required: ['search_form_selector', 'search_result_selector'],
  },
  createWorkflow: (
    params: BrowserFlowParameters,
    context?: BrowserFlowContext
  ): Workflow => {
    if (!context?.url) {
      throw new Error('URL must be provided in context');
    }
    const workflow: Workflow = {
      starts_at: 'open_search_page',
      capture: params.capture_iframe_selector
        ? { type: 'iframe', selector: params.capture_iframe_selector as string }
        : undefined,
      states: {
        open_search_page: {
          type: 'open_page',
          next:
            params.continue_button_selector || params.continue2_button_selector
              ? 'race_form_or_button'
              : 'wait_for_search_form_ready',
          input: {
            url: context.url,
            timeout: 30000,
            wait_until: 'domcontentloaded',
          },
        },
        wait_for_search_form_ready: {
          type: 'wait_for_selector',
          input: {
            selector: params.search_form_selector as string,
            timeout: 30000,
            visible: true,
            iframe_selector: params.iframe_selector as string | undefined,
          },
          next: 'enter_parcel_id',
        },
        enter_parcel_id: {
          type: 'type',
          input: {
            selector: params.search_form_selector as string,
            value: '{{=it.request_identifier}}',
            delay: 100,
            iframe_selector: params.iframe_selector as string | undefined,
          },
          next: 'press_enter',
        },
        press_enter: {
          type: 'keyboard_press',
          input: {
            key: 'Enter',
          },
          next: 'wait_for_search_results',
        },
        wait_for_search_results: {
          type: 'wait_for_selector',
          end: !params.property_details_button,
          input: {
            selector: params.search_result_selector as string,
            timeout: 30000,
            visible: true,
            iframe_selector: params.iframe_selector as string | undefined,
          },
          next: params.property_details_button
            ? 'click_property_details'
            : undefined,
        },
      },
    };

    if (params.continue_button_selector || params.continue2_button_selector) {
      const raceSelectors = [
        {
          selector: params.search_form_selector as string,
          label: 'search_form',
          timeout: 30000,
        },
      ];

      if (params.continue_button_selector) {
        raceSelectors.push({
          selector: params.continue_button_selector as string,
          label: 'continue_button',
          timeout: 30000,
        });
      } else if (params.continue2_button_selector) {
        raceSelectors.push({
          selector: params.continue2_button_selector as string,
          label: 'continue_button2',
          timeout: 30000,
        });
      }

      const nextMap: Record<string, string> = {
        search_form: 'wait_for_search_form_ready',
      };

      const validateWinner: Record<
        string,
        { check_selector: string; if_exists_goto: string }
      > = {};

      if (params.continue_button_selector) {
        nextMap.continue_button = 'click_continue_button';
        validateWinner.search_form = {
          check_selector: params.continue_button_selector as string,
          if_exists_goto: 'click_continue_button',
        };
      } else if (params.continue2_button_selector) {
        nextMap.continue_button2 = 'click_continue_button2';
        validateWinner.search_form = {
          check_selector: params.continue2_button_selector as string,
          if_exists_goto: 'click_continue_button2',
        };
      }

      workflow.states.race_form_or_button = {
        type: 'wait_for_selector_race',
        input: {
          selectors: raceSelectors,
          visible: true,
          iframe_selector: params.iframe_selector as string | undefined,
        },
        next_map: nextMap,
        validate_winner: validateWinner,
      };
    }

    if (params.continue_button_selector) {
      workflow.states.click_continue_button = {
        type: 'click',
        input: {
          selector: params.continue_button_selector as string,
          iframe_selector: params.iframe_selector as string | undefined,
        },
        next: params.continue2_button_selector
          ? 'race_form_or_button2'
          : 'wait_for_search_form_ready',
      };

      if (params.continue2_button_selector) {
        const race2Selectors = [
          {
            selector: params.search_form_selector as string,
            label: 'search_form',
            timeout: 30000,
          },
          {
            selector: params.continue2_button_selector as string,
            label: 'continue_button2',
            timeout: 30000,
          },
        ];

        workflow.states.race_form_or_button2 = {
          type: 'wait_for_selector_race',
          input: {
            selectors: race2Selectors,
            visible: true,
            iframe_selector: params.iframe_selector as string | undefined,
          },
          next_map: {
            search_form: 'wait_for_search_form_ready',
            continue_button2: 'click_continue_button2',
          },
          validate_winner: {
            search_form: {
              check_selector: params.continue2_button_selector as string,
              if_exists_goto: 'click_continue_button2',
            },
          },
        };
      }
    }

    if (params.continue2_button_selector) {
      workflow.states.click_continue_button2 = {
        type: 'click',
        input: {
          selector: params.continue2_button_selector as string,
          iframe_selector: params.iframe_selector as string | undefined,
        },
        next: 'wait_for_search_form_ready',
      };
    }

    if (params.property_details_button) {
      workflow.states.click_property_details = {
        type: 'click',
        input: {
          selector: params.property_details_button as string,
          iframe_selector: params.iframe_selector as string | undefined,
        },
        next: params.property_details_selector
          ? 'wait_for_property_details'
          : undefined,
        end: !params.property_details_selector,
      };

      if (params.property_details_selector) {
        workflow.states.wait_for_property_details = {
          type: 'wait_for_selector',
          input: {
            selector: params.property_details_selector as string,
            timeout: 30000,
            visible: true,
            iframe_selector: params.iframe_selector as string | undefined,
          },
          end: true,
        };
      }
    }

    return workflow;
  },
};
