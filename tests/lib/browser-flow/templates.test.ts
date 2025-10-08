import { describe, it, expect } from 'vitest';
import {
  getTemplate,
  listTemplates,
} from '../../../src/lib/browser-flow/templates/index.js';
import { SEARCH_BY_PARCEL_ID } from '../../../src/lib/browser-flow/templates/search-by-parcel-id.js';
import { validateParameters } from '../../../src/lib/browser-flow/validator.js';

describe('Browser Flow Templates', () => {
  describe('Template Registry', () => {
    it('should list available templates', () => {
      const templates = listTemplates();
      expect(templates).toContain('SEARCH_BY_PARCEL_ID');
    });

    it('should retrieve template by ID', () => {
      const template = getTemplate('SEARCH_BY_PARCEL_ID');
      expect(template).toBeDefined();
      expect(template?.id).toBe('SEARCH_BY_PARCEL_ID');
    });

    it('should return undefined for unknown template', () => {
      const template = getTemplate('UNKNOWN_TEMPLATE');
      expect(template).toBeUndefined();
    });
  });

  describe('SEARCH_BY_PARCEL_ID Template', () => {
    it('should have correct metadata', () => {
      expect(SEARCH_BY_PARCEL_ID.id).toBe('SEARCH_BY_PARCEL_ID');
      expect(SEARCH_BY_PARCEL_ID.name).toBe('Search by Parcel ID');
      expect(SEARCH_BY_PARCEL_ID.description).toContain('parcel ID');
    });

    it('should have valid parameter schema', () => {
      const schema = SEARCH_BY_PARCEL_ID.parametersSchema;
      expect(schema.type).toBe('object');
      expect(schema.properties).toHaveProperty('continue_button_selector');
      expect(schema.properties).toHaveProperty('search_form_selector');
      expect(schema.properties).toHaveProperty('search_result_selector');
      expect(schema.properties).not.toHaveProperty('url');
      expect(schema.required).toContain('search_form_selector');
      expect(schema.required).toContain('search_result_selector');
      expect(schema.required).not.toContain('url');
    });

    it('should create workflow without continue button', () => {
      const params = {
        search_form_selector: '#search',
        search_result_selector: '#results',
      };
      const context = {
        url: 'https://example.com',
        requestId: 'test-123',
      };

      const workflow = SEARCH_BY_PARCEL_ID.createWorkflow(params, context);
      expect(workflow.starts_at).toBe('open_search_page');
      expect(workflow.states.open_search_page.next).toBe(
        'wait_for_search_form_ready'
      );
      expect(workflow.states.wait_for_button).toBeUndefined();
      expect(workflow.states.click_continue_button).toBeUndefined();
      expect(workflow.states.check_search_form).toBeUndefined();
    });

    it('should create workflow with continue button', () => {
      const params = {
        continue_button_selector: '.continue',
        search_form_selector: '#search',
        search_result_selector: '#results',
      };
      const context = {
        url: 'https://example.com',
        requestId: 'test-123',
      };

      const workflow = SEARCH_BY_PARCEL_ID.createWorkflow(params, context);
      expect(workflow.starts_at).toBe('open_search_page');
      expect(workflow.states.open_search_page.next).toBe('race_form_or_button');
      expect(workflow.states.race_form_or_button).toBeDefined();
      expect(workflow.states.race_form_or_button.type).toBe(
        'wait_for_selector_race'
      );
      expect(workflow.states.click_continue_button).toBeDefined();
      const raceInput = workflow.states.race_form_or_button.input as any;
      expect(raceInput.selectors).toHaveLength(2);
      expect(
        raceInput.selectors.some((s: any) => s.selector === '.continue')
      ).toBe(true);
    });

    it('should include template syntax in workflow', () => {
      const params = {
        search_form_selector: '#search',
        search_result_selector: '#results',
      };
      const context = {
        url: 'https://example.com',
        requestId: 'test-123',
      };

      const workflow = SEARCH_BY_PARCEL_ID.createWorkflow(params, context);
      expect((workflow.states.enter_parcel_id.input as any).value).toBe(
        '{{=it.request_identifier}}'
      );
    });

    it('should validate required parameters', () => {
      const params = {
        search_form_selector: '#search',
      };

      const result = validateParameters(SEARCH_BY_PARCEL_ID, params);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'Missing required parameter: search_result_selector'
      );
    });

    it('should validate all parameters correctly', () => {
      const params = {
        continue_button_selector: '.continue',
        search_form_selector: '#search',
        search_result_selector: '#results',
      };

      const result = validateParameters(SEARCH_BY_PARCEL_ID, params);
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });
  });
});
