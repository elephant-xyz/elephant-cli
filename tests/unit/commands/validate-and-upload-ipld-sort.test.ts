import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { handleValidateAndUpload } from '../../../src/commands/validate-and-upload.js';
import { promises as fsPromises } from 'fs';
import path from 'path';
import os from 'os';

// Mock all dependencies
vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    realpath: vi.fn(),
  },
  writeFileSync: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('100'),
}));

describe('Validate and Upload - IPLD Array Sorting', () => {
  let tempDir: string;
  const mockServices = {
    fileScannerService: {
      validateStructure: vi
        .fn()
        .mockResolvedValue({ isValid: true, errors: [] }),
      countTotalFiles: vi.fn().mockResolvedValue(1),
      scanDirectory: vi.fn(),
      getAllDataGroupCids: vi.fn().mockResolvedValue(new Set(['QmTestSchema'])),
    },
    schemaCacheService: {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          links: { type: 'array' },
        },
      }),
    },
    jsonValidatorService: {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessage: vi.fn(),
    },
    cidCalculatorService: {
      calculateCidAutoFormat: vi.fn().mockResolvedValue('QmCalculatedCID'),
    },
    csvReporterService: {
      initialize: vi.fn(),
      finalize: vi.fn(),
      logError: vi.fn(),
    },
    progressTracker: {
      start: vi.fn(),
      stop: vi.fn(),
      setPhase: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        startTime: Date.now(),
        errors: 0,
        processed: 1,
        skipped: 0,
        total: 1,
      }),
    },
    pinataService: {
      uploadBatch: vi
        .fn()
        .mockResolvedValue([{ success: true, cid: 'QmUploadedCID' }]),
    },
    ipldConverterService: {
      hasIPLDLinks: vi.fn().mockReturnValue(false),
    },
  };

  beforeEach(() => {
    tempDir = '/tmp/test';
    const mockFs = fsPromises as any;
    mockFs.realpath.mockResolvedValue(tempDir);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should sort arrays containing IPLD links by CID during canonicalization', async () => {
    // Create test data with unsorted IPLD links
    const testData = {
      links: [
        { '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' },
        { '/': 'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u' },
        { '/': 'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m' },
      ],
      metadata: 'test',
    };

    // Mock file system
    const mockFs = fsPromises as any;
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });
    mockFs.readFile.mockResolvedValue(JSON.stringify(testData));

    // Mock file scanner to return our test file
    mockServices.fileScannerService.scanDirectory.mockImplementation(
      async function* () {
        yield [
          {
            propertyCid: 'QmPropertyCID',
            dataGroupCid: 'QmTestSchema',
            filePath: path.join(tempDir, 'QmPropertyCID', 'QmTestSchema.json'),
          },
        ];
      }
    );

    // Capture the canonicalized data
    let capturedCanonicalJson: string | undefined;
    mockServices.pinataService.uploadBatch.mockImplementation(async (files) => {
      if (files && files[0]) {
        capturedCanonicalJson = files[0].canonicalJson;
      }
      return [{ success: true, cid: 'QmUploadedCID' }];
    });

    const options = {
      pinataJwt: 'test-jwt',
      inputDir: tempDir,
      outputCsv: 'test.csv',
      dryRun: false,
    };

    await handleValidateAndUpload(options, mockServices as any);

    // Verify the canonicalized JSON has sorted IPLD links
    expect(capturedCanonicalJson).toBeDefined();
    const parsed = JSON.parse(capturedCanonicalJson!);

    // Links should be sorted alphabetically by CID
    expect(parsed.links[0]['/']).toBe(
      'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u'
    );
    expect(parsed.links[1]['/']).toBe(
      'bafybeifx7yeb55armcsxwwitkymga5xf53dxiarykms3ygqic223w5sk3m'
    );
    expect(parsed.links[2]['/']).toBe(
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    );
  });

  it('should handle mixed arrays with IPLD links and regular values', async () => {
    // Create test data with mixed content
    const testData = {
      references: [
        { '/': 'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o' },
        'regular string',
        { '/': 'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB' },
        { not: 'ipld' },
      ],
    };

    // Mock file system
    const mockFs = fsPromises as any;
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });
    mockFs.readFile.mockResolvedValue(JSON.stringify(testData));

    // Mock file scanner
    mockServices.fileScannerService.scanDirectory.mockImplementation(
      async function* () {
        yield [
          {
            propertyCid: 'QmPropertyCID',
            dataGroupCid: 'QmTestSchema',
            filePath: path.join(tempDir, 'QmPropertyCID', 'QmTestSchema.json'),
          },
        ];
      }
    );

    // Capture the canonicalized data
    let capturedCanonicalJson: string | undefined;
    mockServices.pinataService.uploadBatch.mockImplementation(async (files) => {
      if (files && files[0]) {
        capturedCanonicalJson = files[0].canonicalJson;
      }
      return [{ success: true, cid: 'QmUploadedCID' }];
    });

    const options = {
      pinataJwt: 'test-jwt',
      inputDir: tempDir,
      outputCsv: 'test.csv',
      dryRun: false,
    };

    await handleValidateAndUpload(options, mockServices as any);

    // Verify the canonicalized JSON has IPLD links sorted first
    expect(capturedCanonicalJson).toBeDefined();
    const parsed = JSON.parse(capturedCanonicalJson!);

    // IPLD links should come first, sorted by CID
    expect(parsed.references[0]['/']).toBe(
      'QmPZ9gcCEpqKTo6aq61g2nXGUhM4iCL3ewB6LDXZCtioEB'
    );
    expect(parsed.references[1]['/']).toBe(
      'QmYjtig7VJQ6XsnUjqqJvj7QaMcCAwtrgNdahSiFofrE7o'
    );
    // Other items maintain relative order
    expect(parsed.references[2]).toBe('regular string');
    expect(parsed.references[3]).toEqual({ not: 'ipld' });
  });

  it('should work with IPLD conversion when file paths are converted to CIDs', async () => {
    // Create test data with file path links
    const testData = {
      links: [{ '/': './file2.json' }, { '/': './file1.json' }],
    };

    // Mock IPLD converter to simulate conversion
    mockServices.ipldConverterService.hasIPLDLinks.mockReturnValue(true);
    mockServices.ipldConverterService.convertToIPLD = vi
      .fn()
      .mockResolvedValue({
        convertedData: {
          links: [
            {
              '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
            },
            {
              '/': 'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u',
            },
          ],
        },
        hasLinks: true,
        linkedCIDs: [
          'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u',
        ],
      });

    // Mock file system
    const mockFs = fsPromises as any;
    mockFs.stat.mockResolvedValue({ isDirectory: () => true });
    mockFs.readFile.mockResolvedValue(JSON.stringify(testData));

    // Mock file scanner
    mockServices.fileScannerService.scanDirectory.mockImplementation(
      async function* () {
        yield [
          {
            propertyCid: 'QmPropertyCID',
            dataGroupCid: 'QmTestSchema',
            filePath: path.join(tempDir, 'QmPropertyCID', 'QmTestSchema.json'),
          },
        ];
      }
    );

    // Capture the canonicalized data
    let capturedCanonicalJson: string | undefined;
    mockServices.pinataService.uploadBatch.mockImplementation(async (files) => {
      if (files && files[0]) {
        capturedCanonicalJson = files[0].canonicalJson;
      }
      return [{ success: true, cid: 'QmUploadedCID' }];
    });

    const options = {
      pinataJwt: 'test-jwt',
      inputDir: tempDir,
      outputCsv: 'test.csv',
      dryRun: false,
    };

    await handleValidateAndUpload(options, mockServices as any);

    // Verify the canonicalized JSON has sorted IPLD links
    expect(capturedCanonicalJson).toBeDefined();
    const parsed = JSON.parse(capturedCanonicalJson!);

    // Links should be sorted alphabetically by CID after conversion
    expect(parsed.links[0]['/']).toBe(
      'bafybeibazaarhe5qpbgvfwqnteba5hbgzvqcajqgfgxnhpdvfnqweabk4u'
    );
    expect(parsed.links[1]['/']).toBe(
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi'
    );
  });
});
