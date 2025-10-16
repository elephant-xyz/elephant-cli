import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  validateCustomFlow,
  loadCustomFlow,
} from '../../../src/lib/browser-flow/customFlow.js';
import { promises as fs } from 'fs';
import { Workflow } from '../../../src/lib/withBrowserFlow.js';

vi.mock('fs', () => ({
  promises: {
    readFile: vi.fn(),
  },
}));

describe('Custom Browser Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateCustomFlow', () => {
    it('should validate a valid workflow', () => {
      const workflow: Workflow = {
        starts_at: 'open_page',
        states: {
          open_page: {
            type: 'open_page',
            input: {
              url: 'https://example.com',
              timeout: 30000,
              wait_until: 'domcontentloaded',
            },
            next: 'wait_for_element',
          },
          wait_for_element: {
            type: 'wait_for_selector',
            input: {
              selector: '#content',
              timeout: 10000,
              visible: true,
            },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate workflow with capture config', () => {
      const workflow: Workflow = {
        starts_at: 'open_page',
        capture: {
          type: 'iframe',
          selector: '#main-iframe',
        },
        states: {
          open_page: {
            type: 'open_page',
            input: {
              url: 'https://example.com',
            },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(true);
    });

    it('should reject non-object workflow', () => {
      const result = validateCustomFlow('not an object');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Expected object, received string');
    });

    it('should reject workflow without starts_at', () => {
      const workflow = {
        states: {
          test: {
            type: 'open_page',
            input: { url: 'https://example.com' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('starts_at: Required');
    });

    it('should reject workflow with invalid starts_at reference', () => {
      const workflow = {
        starts_at: 'non_existent_state',
        states: {
          test: {
            type: 'open_page',
            input: { url: 'https://example.com' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'starts_at references unknown state "non_existent_state"'
      );
    });

    it('should reject workflow without states', () => {
      const workflow = {
        starts_at: 'test',
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('states: Required');
    });

    it('should reject workflow with empty states', () => {
      const workflow = {
        starts_at: 'test',
        states: {},
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('states must contain at least one state');
    });

    it('should reject state with invalid type', () => {
      const workflow = {
        starts_at: 'test',
        states: {
          test: {
            type: 'invalid_type',
            input: {},
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid discriminator value');
    });

    it('should reject state with invalid next reference', () => {
      const workflow = {
        starts_at: 'test',
        states: {
          test: {
            type: 'open_page',
            input: { url: 'https://example.com' },
            next: 'non_existent',
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain(
        'next references unknown state "non_existent"'
      );
    });

    it('should validate open_page input', () => {
      const workflow = {
        starts_at: 'test',
        states: {
          test: {
            type: 'open_page',
            input: {
              url: '',
            },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain(
        'String must contain at least 1 character'
      );
    });

    it('should validate wait_for_selector input', () => {
      const workflow = {
        starts_at: 'test',
        states: {
          test: {
            type: 'wait_for_selector',
            input: {
              selector: '',
              timeout: 'not a number',
            },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.some((e) => e.includes('selector'))).toBe(true);
      expect(result.errors!.some((e) => e.includes('timeout'))).toBe(true);
    });

    it('should validate click input', () => {
      const workflow = {
        starts_at: 'test',
        states: {
          test: {
            type: 'click',
            input: {
              selector: 123,
            },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Expected string');
    });

    it('should validate type input', () => {
      const workflow = {
        starts_at: 'test',
        states: {
          test: {
            type: 'type',
            input: {
              selector: '#input',
              value: 123,
            },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Expected string');
    });

    it('should validate keyboard_press input', () => {
      const workflow = {
        starts_at: 'test',
        states: {
          test: {
            type: 'keyboard_press',
            input: {
              key: '',
            },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain(
        'String must contain at least 1 character'
      );
    });

    it('should validate capture config with invalid type', () => {
      const workflow = {
        starts_at: 'test',
        capture: {
          type: 'invalid',
        },
        states: {
          test: {
            type: 'open_page',
            input: { url: 'https://example.com' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Invalid discriminator value');
    });

    it('should validate iframe capture requires selector', () => {
      const workflow = {
        starts_at: 'test',
        capture: {
          type: 'iframe',
        },
        states: {
          test: {
            type: 'open_page',
            input: { url: 'https://example.com' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('capture.selector');
      expect(result.errors?.[0]).toContain('Required');
    });

    it('should validate complex workflow with all node types', () => {
      const workflow: Workflow = {
        starts_at: 'open_page',
        capture: { type: 'page' },
        states: {
          open_page: {
            type: 'open_page',
            input: {
              url: 'https://example.com',
              timeout: 30000,
              wait_until: 'networkidle0',
            },
            next: 'wait_for_button',
          },
          wait_for_button: {
            type: 'wait_for_selector',
            input: {
              selector: '#continue-btn',
              timeout: 10000,
              visible: true,
              iframe_selector: '#main-frame',
            },
            next: 'click_button',
          },
          click_button: {
            type: 'click',
            input: {
              selector: '#continue-btn',
              iframe_selector: '#main-frame',
            },
            next: 'type_search',
          },
          type_search: {
            type: 'type',
            input: {
              selector: '#search-input',
              value: 'test query',
              delay: 50,
            },
            next: 'press_enter',
          },
          press_enter: {
            type: 'keyboard_press',
            input: {
              key: 'Enter',
            },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should validate wait_for_selector_race with valid next_map', () => {
      const workflow = {
        starts_at: 'race_state',
        states: {
          race_state: {
            type: 'wait_for_selector_race',
            input: {
              selectors: [
                { selector: '#option1', label: 'opt1', timeout: 5000 },
                { selector: '#option2', label: 'opt2' },
              ],
              visible: true,
            },
            next_map: {
              opt1: 'handle_opt1',
              opt2: 'handle_opt2',
            },
          },
          handle_opt1: {
            type: 'click',
            input: { selector: '#button1' },
            end: true,
          },
          handle_opt2: {
            type: 'click',
            input: { selector: '#button2' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(true);
    });

    it('should validate wait_for_selector_race with validate_winner', () => {
      const workflow = {
        starts_at: 'race_state',
        states: {
          race_state: {
            type: 'wait_for_selector_race',
            input: {
              selectors: [
                { selector: '#form', label: 'form' },
                { selector: '#button', label: 'button' },
              ],
            },
            next_map: {
              form: 'handle_form',
              button: 'handle_button',
            },
            validate_winner: {
              form: {
                check_selector: '#button',
                if_exists_goto: 'handle_button',
              },
            },
          },
          handle_form: {
            type: 'type',
            input: { selector: '#input', value: 'test' },
            end: true,
          },
          handle_button: {
            type: 'click',
            input: { selector: '#button' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(true);
    });

    it('should reject wait_for_selector_race with empty selectors array', () => {
      const workflow = {
        starts_at: 'race_state',
        states: {
          race_state: {
            type: 'wait_for_selector_race',
            input: {
              selectors: [],
            },
            next_map: {},
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('Array must contain at least 1');
    });

    it('should reject wait_for_selector_race with invalid selector option', () => {
      const workflow = {
        starts_at: 'race_state',
        states: {
          race_state: {
            type: 'wait_for_selector_race',
            input: {
              selectors: [{ selector: '', label: 'test' }],
            },
            next_map: { test: 'next_state' },
          },
          next_state: {
            type: 'click',
            input: { selector: '#btn' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain('String must contain at least 1');
    });

    it('should reject wait_for_selector_race with invalid next_map reference', () => {
      const workflow = {
        starts_at: 'race_state',
        states: {
          race_state: {
            type: 'wait_for_selector_race',
            input: {
              selectors: [{ selector: '#test', label: 'test' }],
            },
            next_map: {
              test: 'non_existent_state',
            },
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain(
        'next_map["test"] references unknown state "non_existent_state"'
      );
    });

    it('should reject wait_for_selector_race with invalid validate_winner reference', () => {
      const workflow = {
        starts_at: 'race_state',
        states: {
          race_state: {
            type: 'wait_for_selector_race',
            input: {
              selectors: [{ selector: '#test', label: 'test' }],
            },
            next_map: {
              test: 'next_state',
            },
            validate_winner: {
              test: {
                check_selector: '#other',
                if_exists_goto: 'non_existent_state',
              },
            },
          },
          next_state: {
            type: 'click',
            input: { selector: '#btn' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain(
        'validate_winner["test"].if_exists_goto references unknown state "non_existent_state"'
      );
    });

    it('should validate wait_for_selector with continue_on_timeout and next_on_timeout', () => {
      const workflow = {
        starts_at: 'wait_optional',
        states: {
          wait_optional: {
            type: 'wait_for_selector',
            input: {
              selector: '#optional-button',
              timeout: 5000,
            },
            continue_on_timeout: true,
            next_on_timeout: 'handle_timeout',
            next: 'handle_found',
          },
          handle_timeout: {
            type: 'click',
            input: { selector: '#skip-button' },
            end: true,
          },
          handle_found: {
            type: 'click',
            input: { selector: '#optional-button' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(true);
    });

    it('should reject wait_for_selector with invalid next_on_timeout reference', () => {
      const workflow = {
        starts_at: 'wait_optional',
        states: {
          wait_optional: {
            type: 'wait_for_selector',
            input: {
              selector: '#optional-button',
            },
            continue_on_timeout: true,
            next_on_timeout: 'non_existent_state',
            next: 'handle_found',
          },
          handle_found: {
            type: 'click',
            input: { selector: '#optional-button' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(false);
      expect(result.errors?.[0]).toContain(
        'next_on_timeout references unknown state "non_existent_state"'
      );
    });

    it('should validate workflow with multiple timeout handling scenarios', () => {
      const workflow = {
        starts_at: 'wait_button1',
        states: {
          wait_button1: {
            type: 'wait_for_selector',
            input: {
              selector: '#button1',
              timeout: 5000,
            },
            continue_on_timeout: true,
            next_on_timeout: 'wait_button2',
            next: 'click_button1',
          },
          click_button1: {
            type: 'click',
            input: { selector: '#button1' },
            next: 'final',
          },
          wait_button2: {
            type: 'wait_for_selector',
            input: {
              selector: '#button2',
              timeout: 5000,
            },
            continue_on_timeout: true,
            next_on_timeout: 'final',
            next: 'click_button2',
          },
          click_button2: {
            type: 'click',
            input: { selector: '#button2' },
            next: 'final',
          },
          final: {
            type: 'wait_for_selector',
            input: { selector: '#result' },
            end: true,
          },
        },
      };

      const result = validateCustomFlow(workflow);
      expect(result.valid).toBe(true);
    });
  });

  describe('loadCustomFlow', () => {
    it('should load and validate a valid workflow from file', async () => {
      const workflow: Workflow = {
        starts_at: 'open_page',
        states: {
          open_page: {
            type: 'open_page',
            input: {
              url: 'https://example.com',
            },
            end: true,
          },
        },
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(workflow));

      const result = await loadCustomFlow('/path/to/workflow.json');
      expect(result).toEqual(workflow);
      expect(fs.readFile).toHaveBeenCalledWith(
        '/path/to/workflow.json',
        'utf-8'
      );
    });

    it('should throw error for invalid JSON', async () => {
      vi.mocked(fs.readFile).mockResolvedValue('invalid json');

      await expect(loadCustomFlow('/path/to/invalid.json')).rejects.toThrow();
    });

    it('should throw error for invalid workflow structure', async () => {
      const invalidWorkflow = {
        starts_at: 'missing_state',
        states: {},
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(invalidWorkflow));

      await expect(loadCustomFlow('/path/to/invalid.json')).rejects.toThrow(
        'Invalid custom browser flow definition'
      );
    });
  });
});
