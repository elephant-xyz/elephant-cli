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
      expect(result.errors).toContain('Workflow must be an object');
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
      expect(result.errors).toContain('starts_at must be a string');
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
      expect(result.errors).toContain('states must be an object');
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
      expect(result.errors?.[0]).toContain(
        'type must be one of: open_page, wait_for_selector, click, type, keyboard_press'
      );
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
      expect(result.errors?.[0]).toContain('url must be a non-empty string');
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
      expect(result.errors?.[0]).toContain(
        'selector must be a non-empty string'
      );
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
      expect(result.errors?.[0]).toContain('value must be a string');
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
      expect(result.errors?.[0]).toContain('key must be a non-empty string');
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
      expect(result.errors).toContain(
        'capture.type must be either "page" or "iframe"'
      );
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
      expect(result.errors).toContain(
        'capture.selector must be a non-empty string when type is "iframe"'
      );
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
