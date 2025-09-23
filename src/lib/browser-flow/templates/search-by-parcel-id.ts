import { BrowserFlowTemplate } from '../types.js';
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
    },
    required: ['search_form_selector', 'search_result_selector'],
  },
  createWorkflow: (
    params: Record<string, any>,
    context?: Record<string, any>
  ): Workflow => {
    if (!context?.url) {
      throw new Error('URL must be provided in context');
    }
    const workflow: Workflow = {
      starts_at: 'open_search_page',
      states: {
        open_search_page: {
          type: 'open_page',
          next: params.continue_button_selector
            ? 'wait_for_button'
            : 'enter_parcel_id',
          input: {
            url: context.url,
            timeout: 30000,
            wait_until: 'networkidle2',
          },
        },
        enter_parcel_id: {
          type: 'type',
          input: {
            selector: params.search_form_selector,
            value: '{{=it.request_identifier}}',
            delay: 100,
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
          end: true,
          input: {
            selector: params.search_result_selector,
            timeout: 60000,
            visible: true,
          },
        },
      },
    };

    if (params.continue_button_selector) {
      workflow.states.wait_for_button = {
        type: 'wait_for_selector',
        input: {
          selector: params.continue_button_selector,
          timeout: 15000,
          visible: true,
        },
        next: 'click_continue_button',
        result: 'continue_button',
      };
      workflow.states.click_continue_button = {
        type: 'click',
        input: {
          selector: '{{=it.continue_button}}',
        },
        next: 'enter_parcel_id',
      };
    }

    return workflow;
  },
};
