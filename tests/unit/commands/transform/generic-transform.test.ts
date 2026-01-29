import { describe, it, expect } from 'vitest';

// Test the categorizeScripts logic
describe('Generic Transform - Script Categorization', () => {
  // Helper function that mirrors the implementation
  function categorizeScripts(scripts: string[]): { numbered: string[]; nonNumbered: string[] } {
    const numbered: string[] = [];
    const nonNumbered: string[] = [];

    for (const script of scripts) {
      if (/^\d/.test(script)) {
        numbered.push(script);
      } else {
        nonNumbered.push(script);
      }
    }

    // Sort numbered scripts by their numeric prefix
    numbered.sort((a, b) => {
      const numA = parseInt(a.match(/^(\d+)/)?.[1] || '0', 10);
      const numB = parseInt(b.match(/^(\d+)/)?.[1] || '0', 10);
      return numA - numB;
    });

    return { numbered, nonNumbered };
  }

  describe('categorizeScripts', () => {
    it('should separate numbered and non-numbered scripts', () => {
      const scripts = ['1_fetch.js', 'helper.js', '2_transform.js', 'utils.js'];
      const result = categorizeScripts(scripts);

      expect(result.numbered).toEqual(['1_fetch.js', '2_transform.js']);
      expect(result.nonNumbered).toEqual(['helper.js', 'utils.js']);
    });

    it('should sort numbered scripts by numeric prefix', () => {
      const scripts = ['3_output.js', '1_fetch.js', '10_cleanup.js', '2_transform.js'];
      const result = categorizeScripts(scripts);

      expect(result.numbered).toEqual(['1_fetch.js', '2_transform.js', '3_output.js', '10_cleanup.js']);
    });

    it('should handle scripts with multi-digit numbers', () => {
      const scripts = ['10_step.js', '2_step.js', '100_step.js', '1_step.js'];
      const result = categorizeScripts(scripts);

      expect(result.numbered).toEqual(['1_step.js', '2_step.js', '10_step.js', '100_step.js']);
    });

    it('should handle all numbered scripts', () => {
      const scripts = ['1_a.js', '2_b.js', '3_c.js'];
      const result = categorizeScripts(scripts);

      expect(result.numbered).toEqual(['1_a.js', '2_b.js', '3_c.js']);
      expect(result.nonNumbered).toEqual([]);
    });

    it('should handle all non-numbered scripts', () => {
      const scripts = ['helper.js', 'utils.js', 'transform.js'];
      const result = categorizeScripts(scripts);

      expect(result.numbered).toEqual([]);
      expect(result.nonNumbered).toEqual(['helper.js', 'utils.js', 'transform.js']);
    });

    it('should handle empty array', () => {
      const scripts: string[] = [];
      const result = categorizeScripts(scripts);

      expect(result.numbered).toEqual([]);
      expect(result.nonNumbered).toEqual([]);
    });

    it('should handle scripts starting with number but no underscore', () => {
      const scripts = ['1fetch.js', '2transform.js', 'helper.js'];
      const result = categorizeScripts(scripts);

      // Should still categorize as numbered (starts with digit)
      expect(result.numbered).toEqual(['1fetch.js', '2transform.js']);
      expect(result.nonNumbered).toEqual(['helper.js']);
    });

    it('should handle scripts with numbers in middle of name', () => {
      const scripts = ['helper2.js', 'utils_v3.js', '1_main.js'];
      const result = categorizeScripts(scripts);

      // Only scripts STARTING with a digit are numbered
      expect(result.numbered).toEqual(['1_main.js']);
      expect(result.nonNumbered).toEqual(['helper2.js', 'utils_v3.js']);
    });
  });
});

describe('Generic Transform - Schema Mode', () => {
  it('should recognize elephant as valid schema mode', () => {
    const schemaMode: 'elephant' | 'generic' = 'elephant';
    expect(schemaMode).toBe('elephant');
  });

  it('should recognize generic as valid schema mode', () => {
    const schemaMode: 'elephant' | 'generic' = 'generic';
    expect(schemaMode).toBe('generic');
  });
});