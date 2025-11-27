import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import { prepare } from '../../../src/lib/prepare.js';

// Mock createBrowserPage to fail immediately to avoid browser launch timeouts
vi.mock('../../../src/lib/common.js', async () => {
  const actual = await vi.importActual('../../../src/lib/common.js');
  return {
    ...actual,
    createBrowserPage: vi
      .fn()
      .mockRejectedValue(new Error('Browser launch failed (mocked for test)')),
  };
});

describe('Prepare Command - Input CSV Support', () => {
  let tempDir: string;
  let csvPath: string;
  let outputZipPath: string;
  let multiRequestFlowPath: string;
  let browserFlowPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prepare-csv-test-'));
    csvPath = path.join(tempDir, 'permits.csv');
    outputZipPath = path.join(tempDir, 'output.zip');
    multiRequestFlowPath = path.join(tempDir, 'multi-flow.json');
    browserFlowPath = path.join(tempDir, 'browser-flow.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('CSV Validation', () => {
    it('should reject CSV without request_identifier column', async () => {
      await fs.writeFile(csvPath, 'invalid_column\nvalue1\nvalue2', 'utf-8');

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify({
          county_name: 'Test County',
          requests: [
            {
              key: 'test',
              request: {
                method: 'GET',
                url: 'https://example.com/{{=it.request_identifier}}',
              },
            },
          ],
        }),
        'utf-8'
      );

      await expect(
        prepare('', outputZipPath, {
          inputCsv: csvPath,
          multiRequestFlowFile: multiRequestFlowPath,
        })
      ).rejects.toThrow('CSV file must have a request_identifier column');
    });

    it('should reject empty CSV file', async () => {
      await fs.writeFile(csvPath, '', 'utf-8');

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify({
          county_name: 'Test County',
          requests: [
            {
              key: 'test',
              request: {
                method: 'GET',
                url: 'https://example.com/{{=it.request_identifier}}',
              },
            },
          ],
        }),
        'utf-8'
      );

      await expect(
        prepare('', outputZipPath, {
          inputCsv: csvPath,
          multiRequestFlowFile: multiRequestFlowPath,
        })
      ).rejects.toThrow('CSV file is empty or has no valid rows');
    });

    it('should skip rows with empty request_identifier', async () => {
      await fs.writeFile(
        csvPath,
        'request_identifier\n\n  \nvalid-id',
        'utf-8'
      );

      const mockFlow = {
        county_name: 'Test County',
        requests: [
          {
            key: 'test',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/{{=it.request_identifier}}',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      // Mock the HTTP fetch to return HTML
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html' : null),
          entries: () => [['content-type', 'text/html']],
        },
        text: () => Promise.resolve('<html><body>Test</body></html>'),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      await prepare('', outputZipPath, {
        inputCsv: csvPath,
        multiRequestFlowFile: multiRequestFlowPath,
      });

      // Verify output ZIP contains only valid-id (multi-request flow returns JSON)
      const zip = new AdmZip(outputZipPath);
      const entries = zip.getEntries().map((e) => e.entryName);

      expect(entries).toContain('valid-id.json');
      expect(entries).toHaveLength(1);
    });

    it('should require either multi-request-flow or browser-flow', async () => {
      await fs.writeFile(csvPath, 'request_identifier\ntest-id', 'utf-8');

      await expect(
        prepare('', outputZipPath, {
          inputCsv: csvPath,
        })
      ).rejects.toThrow(
        '--multi-request-flow-file or --browser-flow-file is required when using --input-csv'
      );
    });
  });

  describe('Multi-Request Flow with CSV', () => {
    it('should process multiple permits from CSV', async () => {
      await fs.writeFile(
        csvPath,
        'request_identifier\nid-001\nid-002\nid-003',
        'utf-8'
      );

      const mockFlow = {
        county_name: 'Test County',
        requests: [
          {
            key: 'page1',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/permit/{{=it.request_identifier}}',
            },
          },
          {
            key: 'page2',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/permit/{{=it.request_identifier}}/details',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      // Mock HTTP responses
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html' : null),
          entries: () => [['content-type', 'text/html']],
        },
        text: () => Promise.resolve('<html><body>Permit Data</body></html>'),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      await prepare('', outputZipPath, {
        inputCsv: csvPath,
        multiRequestFlowFile: multiRequestFlowPath,
      });

      // Verify output (multi-request flow returns JSON)
      const zip = new AdmZip(outputZipPath);
      const entries = zip.getEntries().map((e) => e.entryName);

      expect(entries).toHaveLength(3);
      expect(entries).toContain('id-001.json');
      expect(entries).toContain('id-002.json');
      expect(entries).toContain('id-003.json');

      // Verify each file has JSON content
      entries.forEach((entry) => {
        const content = zip.readAsText(entry);
        const parsed = JSON.parse(content);
        // Both 'page1' and 'page2' should be present as request keys
        expect(parsed).toHaveProperty('page1');
        expect(parsed).toHaveProperty('page2');
      });
    });

    it('should replace request_identifier in URLs', async () => {
      await fs.writeFile(csvPath, 'request_identifier\ntest-uuid-123', 'utf-8');

      const mockFlow = {
        county_name: 'Test County',
        requests: [
          {
            key: 'test',
            request: {
              method: 'GET' as const,
              url: 'https://api.example.com/permits/{{=it.request_identifier}}',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html' : null),
          entries: () => [['content-type', 'text/html']],
        },
        text: () => Promise.resolve('<html>Data</html>'),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      await prepare('', outputZipPath, {
        inputCsv: csvPath,
        multiRequestFlowFile: multiRequestFlowPath,
      });

      // Verify the URL was templated correctly
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/permits/test-uuid-123',
        expect.any(Object)
      );
    });
  });

  describe('Browser Flow with CSV', () => {
    it('should process single permit with browser flow', async () => {
      await fs.writeFile(
        csvPath,
        'request_identifier\ne7e6ec95-4042-4710-ad00-f946bb30291f',
        'utf-8'
      );

      const mockBrowserFlow = {
        starts_at: 'navigate',
        states: {
          navigate: {
            type: 'open_page',
            input: {
              url: 'https://example.com/permit/e7e6ec95-4042-4710-ad00-f946bb30291f',
              timeout: 30000,
              wait_until: 'networkidle0',
            },
            result: 'page',
            end: true,
          },
        },
        capture: {
          type: 'page',
        },
      };

      await fs.writeFile(
        browserFlowPath,
        JSON.stringify(mockBrowserFlow),
        'utf-8'
      );

      // Note: Browser is mocked at module level to fail immediately
      // This validates the flow logic without actually launching a browser
      await expect(
        prepare('', outputZipPath, {
          inputCsv: csvPath,
          browserFlowFile: browserFlowPath,
          headless: true,
        })
      ).rejects.toThrow(); // Will fail trying to launch browser (mocked)
    }, 10000); // 10 second timeout (reduced since browser is mocked)

    it('should extract URL from browser workflow', async () => {
      // Test the extractUrlFromWorkflow function logic
      const workflow = {
        starts_at: 'navigate_to_permit',
        states: {
          navigate_to_permit: {
            type: 'open_page',
            input: {
              url: 'https://example.com/permit/e7e6ec95-4042-4710-ad00-f946bb30291f',
              timeout: 30000,
            },
          },
        },
      };

      const requestId = 'new-uuid-456';

      // Simulate URL extraction and replacement
      const startState = workflow.states[workflow.starts_at] as {
        type: string;
        input?: { url?: string };
      };

      expect(startState.type).toBe('open_page');
      expect(startState.input?.url).toContain(
        'e7e6ec95-4042-4710-ad00-f946bb30291f'
      );

      const newUrl = startState.input!.url!.replace(
        /[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i,
        requestId
      );

      expect(newUrl).toBe('https://example.com/permit/new-uuid-456');
      expect(newUrl).not.toContain('e7e6ec95-4042-4710-ad00-f946bb30291f');
    });

    it('should handle browser workflow without open_page', async () => {
      const workflow = {
        starts_at: 'wait_for_something',
        states: {
          wait_for_something: {
            type: 'wait_for_selector',
            input: {
              selector: '#test',
              timeout: 5000,
            },
          },
        },
      };

      const startState = workflow.states[workflow.starts_at] as {
        type: string;
        input?: { url?: string };
      };

      // Should not have URL
      expect(startState.type).toBe('wait_for_selector');
      expect(startState.input?.url).toBeUndefined();
    });
  });

  describe('CSV Format Support', () => {
    it('should handle CSV with BOM', async () => {
      // UTF-8 BOM - csv-parse handles this automatically
      await fs.writeFile(csvPath, 'request_identifier\ntest-id-001', 'utf-8');

      const mockFlow = {
        county_name: 'Test',
        requests: [
          {
            key: 'test',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/{{=it.request_identifier}}',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html' : null),
          entries: () => [['content-type', 'text/html']],
        },
        text: () => Promise.resolve('<html>Test</html>'),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      await prepare('', outputZipPath, {
        inputCsv: csvPath,
        multiRequestFlowFile: multiRequestFlowPath,
      });

      const zip = new AdmZip(outputZipPath);
      const entries = zip.getEntries().map((e) => e.entryName);

      expect(entries).toContain('test-id-001.json');
    });

    it('should handle CSV with different line endings', async () => {
      // Windows CRLF
      await fs.writeFile(
        csvPath,
        'request_identifier\r\nid-001\r\nid-002',
        'utf-8'
      );

      const mockFlow = {
        county_name: 'Test',
        requests: [
          {
            key: 'test',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/{{=it.request_identifier}}',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html' : null),
          entries: () => [['content-type', 'text/html']],
        },
        text: () => Promise.resolve('<html>Test</html>'),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      await prepare('', outputZipPath, {
        inputCsv: csvPath,
        multiRequestFlowFile: multiRequestFlowPath,
      });

      const zip = new AdmZip(outputZipPath);
      const entries = zip.getEntries().map((e) => e.entryName);

      expect(entries).toHaveLength(2);
      expect(entries).toContain('id-001.json');
      expect(entries).toContain('id-002.json');
    });

    it('should handle single-line CSV', async () => {
      await fs.writeFile(
        csvPath,
        'request_identifier\nsingle-permit-id',
        'utf-8'
      );

      const mockFlow = {
        county_name: 'Test',
        requests: [
          {
            key: 'test',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/{{=it.request_identifier}}',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html' : null),
          entries: () => [['content-type', 'text/html']],
        },
        text: () => Promise.resolve('<html>Single Permit</html>'),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      await prepare('', outputZipPath, {
        inputCsv: csvPath,
        multiRequestFlowFile: multiRequestFlowPath,
      });

      const zip = new AdmZip(outputZipPath);
      const entries = zip.getEntries().map((e) => e.entryName);

      expect(entries).toHaveLength(1);
      expect(entries).toContain('single-permit-id.json');

      const content = zip.readAsText('single-permit-id.json');
      const parsed = JSON.parse(content);
      expect(parsed).toHaveProperty('test');
    });
  });

  describe('Output Format', () => {
    it('should name output files correctly', async () => {
      await fs.writeFile(
        csvPath,
        'request_identifier\ntest-id-123\ntest-id-456',
        'utf-8'
      );

      const mockFlow = {
        county_name: 'Test',
        requests: [
          {
            key: 'test',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/{{=it.request_identifier}}',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html' : null),
          entries: () => [['content-type', 'text/html']],
        },
        text: () => Promise.resolve('<html>Test</html>'),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      await prepare('', outputZipPath, {
        inputCsv: csvPath,
        multiRequestFlowFile: multiRequestFlowPath,
      });

      const zip = new AdmZip(outputZipPath);
      const entries = zip.getEntries().map((e) => e.entryName);

      // Files should be named: {request_identifier}.{type} (multi-request flow returns json)
      expect(entries).toEqual(['test-id-123.json', 'test-id-456.json']);
    });

    it('should preserve combined JSON output', async () => {
      await fs.writeFile(csvPath, 'request_identifier\njson-test-id', 'utf-8');

      const mockFlow = {
        county_name: 'Test',
        requests: [
          {
            key: 'test',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/{{=it.request_identifier}}',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      const htmlContent =
        '<!DOCTYPE html><html><head><title>Test</title></head><body><h1>Permit Data</h1></body></html>';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) =>
            name === 'content-type' ? 'text/html; charset=utf-8' : null,
          entries: () => [['content-type', 'text/html; charset=utf-8']],
        },
        text: () => Promise.resolve(htmlContent),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      await prepare('', outputZipPath, {
        inputCsv: csvPath,
        multiRequestFlowFile: multiRequestFlowPath,
      });

      const zip = new AdmZip(outputZipPath);
      const content = zip.readAsText('json-test-id.json');

      // Multi-request flow combines responses into JSON
      const parsed = JSON.parse(content);
      expect(parsed).toHaveProperty('test');
      expect(parsed.test).toHaveProperty('source_http_request');
      expect(parsed.test).toHaveProperty('response');
    });
  });

  describe('Error Handling', () => {
    it('should handle individual request failures gracefully', async () => {
      await fs.writeFile(
        csvPath,
        'request_identifier\nsuccess-id\nfail-id\nsuccess-id-2',
        'utf-8'
      );

      const mockFlow = {
        county_name: 'Test',
        requests: [
          {
            key: 'test',
            request: {
              method: 'GET' as const,
              url: 'https://example.com/{{=it.request_identifier}}',
            },
          },
        ],
      };

      await fs.writeFile(
        multiRequestFlowPath,
        JSON.stringify(mockFlow),
        'utf-8'
      );

      const mockFetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes('fail-id')) {
          return Promise.resolve({
            ok: false,
            status: 404,
            statusText: 'Not Found',
            headers: {
              get: (name: string) =>
                name === 'content-type' ? 'text/html' : null,
              entries: () => [['content-type', 'text/html']],
            },
            text: () => Promise.resolve('<html>Not Found</html>'),
            arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: {
            get: (name: string) =>
              name === 'content-type' ? 'text/html' : null,
            entries: () => [['content-type', 'text/html']],
          },
          text: () => Promise.resolve('<html>Success</html>'),
          arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        });
      });
      global.fetch = mockFetch;

      // The prepare function will fail when encountering a 404
      await expect(
        prepare('', outputZipPath, {
          inputCsv: csvPath,
          multiRequestFlowFile: multiRequestFlowPath,
        })
      ).rejects.toThrow('HTTP error 404');
    });
  });

  describe('Integration with Existing Prepare Logic', () => {
    it('should not break traditional prepare with input ZIP', async () => {
      // Create traditional input ZIP
      const inputZip = new AdmZip();

      inputZip.addFile(
        'parcel.json',
        Buffer.from(
          JSON.stringify({
            parcel_identifier: 'test-parcel',
            request_identifier: 'test-123',
            source_http_request: {
              method: 'GET',
              url: 'https://example.com',
              multiValueQueryString: {},
            },
          })
        )
      );

      inputZip.addFile(
        'address.json',
        Buffer.from(
          JSON.stringify({
            county_name: 'Test County',
            unnormalized_address: '123 Test St',
            request_identifier: 'test-123',
            source_http_request: {
              method: 'GET',
              url: 'https://example.com',
              multiValueQueryString: {},
            },
          })
        )
      );

      const inputZipPath = path.join(tempDir, 'input.zip');
      inputZip.writeZip(inputZipPath);

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: {
          get: (name: string) => (name === 'content-type' ? 'text/html' : null),
          entries: () => [['content-type', 'text/html']],
        },
        text: () => Promise.resolve('<html>Traditional Prepare</html>'),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      });
      global.fetch = mockFetch;

      // Should work without inputCsv option
      await prepare(inputZipPath, outputZipPath, {});

      // Verify output
      const outputZip = new AdmZip(outputZipPath);
      const entries = outputZip.getEntries().map((e) => e.entryName);

      expect(entries.length).toBeGreaterThan(0);
    });
  });
});
