import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createWorkflowFromTemplate } from '../../../src/lib/browser-flow/index.js';
import { logger } from '../../../src/utils/logger.js';

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('Browser Flow Index', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createWorkflowFromTemplate', () => {
    it('should create workflow from valid template', () => {
      const params = JSON.stringify({
        search_form_selector: '#search',
        search_result_selector: '#results',
      });
      const context = {
        requestId: 'test-request-id',
        url: 'https://example.com',
      };

      const workflow = createWorkflowFromTemplate(
        'SEARCH_BY_PARCEL_ID',
        params,
        context
      );

      expect(workflow).toBeDefined();
      expect(workflow?.starts_at).toBe('open_search_page');
      expect(logger.info).toHaveBeenCalledWith(
        'Using browser flow template: SEARCH_BY_PARCEL_ID'
      );
    });

    it('should return null for unknown template', () => {
      const params = JSON.stringify({
        search_form_selector: '#search',
      });
      const context = {
        requestId: 'test-request-id',
        url: 'https://example.com',
      };

      const workflow = createWorkflowFromTemplate(
        'UNKNOWN_TEMPLATE',
        params,
        context
      );

      expect(workflow).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Template not found: UNKNOWN_TEMPLATE'
      );
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('Available templates:')
      );
    });

    it('should return null for invalid JSON parameters', () => {
      const context = {
        requestId: 'test-request-id',
        url: 'https://example.com',
      };

      const workflow = createWorkflowFromTemplate(
        'SEARCH_BY_PARCEL_ID',
        '{invalid json}',
        context
      );

      expect(workflow).toBeNull();
      expect(logger.error).toHaveBeenCalledWith(
        'Invalid parameters JSON format'
      );
    });

    it('should return null for invalid parameters', () => {
      const params = JSON.stringify({
        // missing required parameters
      });
      const context = {
        requestId: 'test-request-id',
        url: 'https://example.com',
      };

      const workflow = createWorkflowFromTemplate(
        'SEARCH_BY_PARCEL_ID',
        params,
        context
      );

      expect(workflow).toBeNull();
      expect(logger.error).toHaveBeenCalledWith('Parameter validation failed:');
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Missing required parameter:')
      );
    });

    it('should log debug information for valid workflow creation', () => {
      const params = {
        search_form_selector: '#search',
        search_result_selector: '#results',
      };
      const context = {
        requestId: 'test-request-id',
        url: 'https://example.com',
      };

      const workflow = createWorkflowFromTemplate(
        'SEARCH_BY_PARCEL_ID',
        JSON.stringify(params),
        context
      );

      expect(workflow).toBeDefined();
      expect(logger.debug).toHaveBeenCalledWith(
        `Template parameters: ${JSON.stringify(params)}`
      );
      expect(logger.debug).toHaveBeenCalledWith(
        'Context URL: https://example.com'
      );
    });
  });
});
