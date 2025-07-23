import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PinataService } from '../../../src/services/pinata.service.js';
import { promises as fsPromises } from 'fs';

// Mock modules
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      readFile: vi.fn(),
      readdir: vi.fn(),
    },
  };
});

vi.mock('../../../src/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    technical: vi.fn(),
  },
}));

describe('PinataService - Directory Upload', () => {
  let pinataService: PinataService;
  const mockJwt = 'test-jwt-token';

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock fetch globally
    global.fetch = vi.fn();
    
    pinataService = new PinataService(mockJwt);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should upload a directory with multiple files', async () => {
    const mockFiles = [
      { name: 'index.html', isFile: () => true, isDirectory: () => false },
      { name: 'style.css', isFile: () => true, isDirectory: () => false },
      { name: 'script.js', isFile: () => true, isDirectory: () => false },
    ];

    // Mock readdir to return files
    (fsPromises.readdir as any).mockImplementation(async (path: string, options?: any) => {
      if (options?.withFileTypes) {
        return mockFiles;
      }
      return mockFiles.map(f => f.name);
    });

    // Mock readFile to return content for each file
    (fsPromises.readFile as any).mockImplementation(async (path: string) => {
      if (path.includes('index.html')) {
        return Buffer.from('<html><body>Test</body></html>');
      } else if (path.includes('style.css')) {
        return Buffer.from('body { color: black; }');
      } else if (path.includes('script.js')) {
        return Buffer.from('console.log("test");');
      }
      return Buffer.from('');
    });

    // Mock successful uploads
    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        IpfsHash: 'Qm' + Math.random().toString(36).substring(2, 15),
        PinSize: 1234,
        Timestamp: new Date().toISOString(),
      }),
    });

    const result = await pinataService.uploadDirectory(
      '/test/html/property1',
      'property1',
      {
        name: 'fact-sheet-property1',
        keyvalues: {
          type: 'fact-sheet-html',
        },
      }
    );

    expect(result.success).toBe(true);
    expect(result.cid).toBeDefined();
    expect(result.propertyCid).toBe('property1');
    expect(result.dataGroupCid).toBe('html-fact-sheet');

    // Verify that fetch was called for each file plus the index
    const fetchCalls = (global.fetch as any).mock.calls;
    expect(fetchCalls.length).toBe(4); // 3 files + 1 index file

    // Verify the index file upload
    const indexUploadCall = fetchCalls[fetchCalls.length - 1];
    const formData = indexUploadCall[1].body;
    expect(indexUploadCall[0]).toContain('pinFileToIPFS');
  });

  it('should handle empty directories', async () => {
    // Mock empty directory
    (fsPromises.readdir as any).mockResolvedValue([]);

    const result = await pinataService.uploadDirectory(
      '/test/empty',
      'empty-dir',
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe('No files found in directory');
  });

  it('should handle upload failures gracefully', async () => {
    const mockFiles = [
      { name: 'index.html', isFile: () => true, isDirectory: () => false },
    ];

    (fsPromises.readdir as any).mockImplementation(async (path: string, options?: any) => {
      if (options?.withFileTypes) {
        return mockFiles;
      }
      return mockFiles.map(f => f.name);
    });

    (fsPromises.readFile as any).mockResolvedValue(Buffer.from('<html></html>'));

    // Mock the uploadFile method to fail
    pinataService.uploadFile = vi.fn().mockResolvedValue({
      success: false,
      error: 'Network error',
    });

    const result = await pinataService.uploadDirectory(
      '/test/fail',
      'fail-dir',
      {}
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Failed to upload directory index');
  });

  it('should handle nested directories', async () => {
    const mockStructure = [
      { name: 'index.html', isFile: () => true, isDirectory: () => false },
      { name: 'assets', isFile: () => false, isDirectory: () => true },
    ];

    const mockAssets = [
      { name: 'logo.png', isFile: () => true, isDirectory: () => false },
      { name: 'style.css', isFile: () => true, isDirectory: () => false },
    ];

    (fsPromises.readdir as any).mockImplementation(async (path: string, options?: any) => {
      if (path.includes('assets')) {
        return options?.withFileTypes ? mockAssets : mockAssets.map(f => f.name);
      }
      return options?.withFileTypes ? mockStructure : mockStructure.map(f => f.name);
    });

    (fsPromises.readFile as any).mockResolvedValue(Buffer.from('test content'));

    (global.fetch as any).mockResolvedValue({
      ok: true,
      json: async () => ({
        IpfsHash: 'Qm' + Math.random().toString(36).substring(2, 15),
        PinSize: 1234,
        Timestamp: new Date().toISOString(),
      }),
    });

    const result = await pinataService.uploadDirectory(
      '/test/nested',
      'nested-dir',
      {}
    );

    expect(result.success).toBe(true);
    
    // Should upload 3 files (index.html, logo.png, style.css) + 1 index
    const fetchCalls = (global.fetch as any).mock.calls;
    expect(fetchCalls.length).toBe(4);
  });
});