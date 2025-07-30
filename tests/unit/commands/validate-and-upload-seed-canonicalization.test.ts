import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  MockInstance,
} from 'vitest';
import { promises as fsPromises } from 'fs';
import * as fs from 'fs';
import path from 'path';
import { logger } from '../../../src/utils/logger.js';
import {
  handleValidateAndUpload,
  ValidateAndUploadCommandOptions,
  ValidateAndUploadServiceOverrides,
} from '../../../src/commands/validate-and-upload.js';
import { FileScannerService } from '../../../src/services/file-scanner.service.js';
import { SchemaCacheService } from '../../../src/services/schema-cache.service.js';
import { JsonValidatorService } from '../../../src/services/json-validator.service.js';
import { IPLDCanonicalizerService } from '../../../src/services/ipld-canonicalizer.service.js';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { PinataService } from '../../../src/services/pinata.service.js';
import { CsvReporterService } from '../../../src/services/csv-reporter.service.js';
import { SimpleProgress } from '../../../src/utils/simple-progress.js';
import { IPFSService } from '../../../src/services/ipfs.service.js';
import { IPLDConverterService } from '../../../src/services/ipld-converter.service.js';
import {
  FileEntry,
  ProcessedFile,
  UploadResult,
} from '../../../src/types/submit.types.js';
import { SEED_DATAGROUP_SCHEMA_CID } from '../../../src/config/constants.js';

// Mock fs module
vi.mock('fs', () => ({
  ...vi.importActual('fs'),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => false),
  promises: {
    stat: vi.fn(),
    readFile: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    rm: vi.fn(),
  },
}));

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn(() => '100'), // Mock ulimit -n to return 100
}));

// Mock os
vi.mock('os', () => ({
  cpus: vi.fn(() => [{}, {}]), // Mock 2 CPUs
}));

// Mock process.exit
const mockExit = vi.fn();
vi.stubGlobal('process', { ...process, exit: mockExit });

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => {});

describe('ValidateAndUpload - Seed Datagroup Canonicalization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should apply canonicalization to seed datagroup files', async () => {
    const testInputDir = '/test/input';
    const seedDirName = 'my-seed-property';
    const seedDirPath = path.join(testInputDir, seedDirName);

    // Mock file system
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
    } as any);

    // Track what data was passed to calculateCidAutoFormat
    const calculatedCidCalls: any[] = [];

    // Mock services
    const mockFileScannerService = {
      validateStructure: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
      }),
      countTotalFiles: vi.fn().mockResolvedValue(1),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            propertyCid: `SEED_PENDING:${seedDirName}`,
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: path.join(
              seedDirPath,
              `${SEED_DATAGROUP_SCHEMA_CID}.json`
            ),
          } as FileEntry,
        ];
      }),
      getAllDataGroupCids: vi
        .fn()
        .mockResolvedValue(new Set([SEED_DATAGROUP_SCHEMA_CID])),
    } as any;

    const mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: { type: 'array' },
        },
      }),
    } as any;

    const mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessages: vi.fn().mockReturnValue([]),
    } as any;

    // Mock canonicalizer to test proper ordering
    const mockCanonicalizerService = {
      canonicalize: vi.fn().mockImplementation((data: any) => {
        // Simulate canonicalization by sorting object keys
        return JSON.stringify(data, Object.keys(data).sort());
      }),
    } as any;

    const mockCidCalculatorService = {
      calculateCidAutoFormat: vi.fn().mockImplementation(async (data: any) => {
        // Capture the data passed to calculate CID
        calculatedCidCalls.push(data);
        // Return a deterministic CID based on the canonicalized data
        const dataStr = JSON.stringify(data);
        return `bafybeig${dataStr.length}canonicalized`;
      }),
    } as any;

    const mockCsvReporterService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockPinataService = {
      uploadBatch: vi
        .fn()
        .mockImplementation(async (files: ProcessedFile[]) => {
          return files.map(
            (file) =>
              ({
                success: true,
                cid: file.calculatedCid,
                propertyCid: file.propertyCid,
                dataGroupCid: file.dataGroupCid,
              }) as UploadResult
          );
        }),
    } as any;

    const mockProgressTracker = {
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
    } as any;

    const mockIpldConverterService = {
      hasIPLDLinks: vi.fn().mockReturnValue(false),
      convertToIPLD: vi.fn(),
    } as any;

    // Mock reading the seed file - provide unordered JSON
    vi.mocked(fsPromises.readFile).mockResolvedValue(
      JSON.stringify({
        relationships: ['rel1', 'rel2'],
        label: 'My Seed Data',
      })
    );

    const options: ValidateAndUploadCommandOptions = {
      inputDir: testInputDir,
      outputCsv: '/test/output.csv',
      dryRun: false,
      pinataJwt: 'test-jwt',
    };

    const serviceOverrides: ValidateAndUploadServiceOverrides = {
      fileScannerService: mockFileScannerService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      csvReporterService: mockCsvReporterService,
      pinataService: mockPinataService,
      progressTracker: mockProgressTracker,
      ipldConverterService: mockIpldConverterService,
    };

    await handleValidateAndUpload(options, serviceOverrides);

    // Verify canonicalization was called
    expect(mockCanonicalizerService.canonicalize).toHaveBeenCalledWith({
      relationships: ['rel1', 'rel2'],
      label: 'My Seed Data',
    });

    // Verify CID was calculated from canonicalized data
    expect(mockCidCalculatorService.calculateCidAutoFormat).toHaveBeenCalled();

    // The data passed to calculateCidAutoFormat should be the parsed canonicalized JSON
    // which should have keys in sorted order
    expect(calculatedCidCalls).toHaveLength(1);
    const cidCalculationData = calculatedCidCalls[0];
    const keys = Object.keys(cidCalculationData);
    expect(keys).toEqual(['label', 'relationships']); // Should be sorted

    // Verify upload was called with correct data
    expect(mockPinataService.uploadBatch).toHaveBeenCalled();
    const uploadCall = mockPinataService.uploadBatch.mock.calls[0][0];
    expect(uploadCall).toHaveLength(1);
    expect(uploadCall[0].canonicalJson).toBe(
      JSON.stringify(
        {
          relationships: ['rel1', 'rel2'],
          label: 'My Seed Data',
        },
        ['label', 'relationships']
      ) // Keys sorted by canonicalizer
    );
  });

  it('should apply canonicalization to both seed and non-seed files', async () => {
    const testInputDir = '/test/input';
    const seedDirName = 'my-seed-property';
    const seedDirPath = path.join(testInputDir, seedDirName);

    // Mock file system
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
    } as any);

    // Track CID calculations
    const calculatedCidCalls: any[] = [];

    // Mock services
    const mockFileScannerService = {
      validateStructure: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
      }),
      countTotalFiles: vi.fn().mockResolvedValue(2),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            propertyCid: `SEED_PENDING:${seedDirName}`,
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: path.join(
              seedDirPath,
              `${SEED_DATAGROUP_SCHEMA_CID}.json`
            ),
          } as FileEntry,
          {
            propertyCid: `SEED_PENDING:${seedDirName}`,
            dataGroupCid:
              'bafybeiotheridataklmnopqrstuvwxyz234567abcdefghijklmn',
            filePath: path.join(seedDirPath, 'other-data.json'),
          } as FileEntry,
        ];
      }),
      getAllDataGroupCids: vi
        .fn()
        .mockResolvedValue(
          new Set([
            SEED_DATAGROUP_SCHEMA_CID,
            'bafybeiotheridataklmnopqrstuvwxyz234567abcdefghijklmn',
          ])
        ),
    } as any;

    const mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: { type: 'array' },
        },
      }),
    } as any;

    const mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessages: vi.fn().mockReturnValue([]),
    } as any;

    const mockCanonicalizerService = {
      canonicalize: vi.fn().mockImplementation((data: any) => {
        return JSON.stringify(data, Object.keys(data).sort());
      }),
    } as any;

    const mockCidCalculatorService = {
      calculateCidAutoFormat: vi.fn().mockImplementation(async (data: any) => {
        calculatedCidCalls.push(data);
        const dataStr = JSON.stringify(data);
        return `bafybeig${dataStr.length}canonicalized`;
      }),
    } as any;

    const mockCsvReporterService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockPinataService = {
      uploadBatch: vi
        .fn()
        .mockImplementation(async (files: ProcessedFile[]) => {
          return files.map(
            (file) =>
              ({
                success: true,
                cid: file.calculatedCid,
                propertyCid: file.propertyCid,
                dataGroupCid: file.dataGroupCid,
              }) as UploadResult
          );
        }),
    } as any;

    const mockProgressTracker = {
      start: vi.fn(),
      stop: vi.fn(),
      setPhase: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        startTime: Date.now(),
        errors: 0,
        processed: 2,
        skipped: 0,
        total: 2,
      }),
    } as any;

    const mockIpldConverterService = {
      hasIPLDLinks: vi.fn().mockReturnValue(false),
      convertToIPLD: vi.fn(),
    } as any;

    // Mock reading files
    let readFileCallCount = 0;
    vi.mocked(fsPromises.readFile).mockImplementation(async (filePath) => {
      readFileCallCount++;
      if (filePath.toString().includes(SEED_DATAGROUP_SCHEMA_CID)) {
        return JSON.stringify({
          relationships: ['rel1'],
          label: 'Seed Data',
        });
      } else {
        return JSON.stringify({
          relationships: ['other-rel'],
          label: 'Other Data',
        });
      }
    });

    const options: ValidateAndUploadCommandOptions = {
      inputDir: testInputDir,
      outputCsv: '/test/output.csv',
      dryRun: true, // Use dry-run to simplify test
    };

    const serviceOverrides: ValidateAndUploadServiceOverrides = {
      fileScannerService: mockFileScannerService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: mockCanonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      csvReporterService: mockCsvReporterService,
      pinataService: mockPinataService,
      progressTracker: mockProgressTracker,
      ipldConverterService: mockIpldConverterService,
    };

    await handleValidateAndUpload(options, serviceOverrides);

    // Verify canonicalization was called for both files
    expect(mockCanonicalizerService.canonicalize).toHaveBeenCalledTimes(2);

    // Verify CID was calculated from canonicalized data for both files
    expect(
      mockCidCalculatorService.calculateCidAutoFormat
    ).toHaveBeenCalledTimes(2);
    expect(calculatedCidCalls).toHaveLength(2);

    // Both should have sorted keys
    calculatedCidCalls.forEach((data) => {
      const keys = Object.keys(data);
      expect(keys).toEqual(['label', 'relationships']);
    });
  });

  it('should calculate consistent CIDs for canonicalized seed data', async () => {
    const testInputDir = '/test/input';
    const seedDirName = 'my-seed-property';
    const seedDirPath = path.join(testInputDir, seedDirName);

    // Mock file system
    vi.mocked(fsPromises.stat).mockResolvedValue({
      isDirectory: () => true,
    } as any);

    // Track CID calculations
    const calculatedCids: string[] = [];

    // Mock services
    const mockFileScannerService = {
      validateStructure: vi.fn().mockResolvedValue({
        isValid: true,
        errors: [],
      }),
      countTotalFiles: vi.fn().mockResolvedValue(2),
      scanDirectory: vi.fn().mockImplementation(async function* () {
        yield [
          {
            propertyCid: `SEED_PENDING:${seedDirName}`,
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: path.join(seedDirPath, 'seed1.json'),
          } as FileEntry,
          {
            propertyCid: `SEED_PENDING:${seedDirName}`,
            dataGroupCid: SEED_DATAGROUP_SCHEMA_CID,
            filePath: path.join(seedDirPath, 'seed2.json'),
          } as FileEntry,
        ];
      }),
      getAllDataGroupCids: vi
        .fn()
        .mockResolvedValue(new Set([SEED_DATAGROUP_SCHEMA_CID])),
    } as any;

    const mockSchemaCacheService = {
      getSchema: vi.fn().mockResolvedValue({
        type: 'object',
        properties: {
          label: { type: 'string' },
          relationships: { type: 'array' },
        },
      }),
    } as any;

    const mockJsonValidatorService = {
      validate: vi.fn().mockResolvedValue({ valid: true }),
      getErrorMessages: vi.fn().mockReturnValue([]),
    } as any;

    // Use IPLD canonicalizer for accurate test
    const canonicalizerService = new IPLDCanonicalizerService();

    const mockCidCalculatorService = {
      calculateCidAutoFormat: vi.fn().mockImplementation(async (data: any) => {
        // Generate a deterministic CID based on canonicalized content
        const canonicalStr = canonicalizerService.canonicalize(data);
        const cid = `bafybeig${Buffer.from(canonicalStr).toString('base64').substring(0, 20)}`;
        calculatedCids.push(cid);
        return cid;
      }),
    } as any;

    const mockCsvReporterService = {
      initialize: vi.fn().mockResolvedValue(undefined),
      logError: vi.fn(),
      finalize: vi.fn().mockResolvedValue(undefined),
    } as any;

    const mockProgressTracker = {
      start: vi.fn(),
      stop: vi.fn(),
      setPhase: vi.fn(),
      increment: vi.fn(),
      getMetrics: vi.fn().mockReturnValue({
        startTime: Date.now(),
        errors: 0,
        processed: 2,
        skipped: 0,
        total: 2,
      }),
    } as any;

    const mockIpldConverterService = {
      hasIPLDLinks: vi.fn().mockReturnValue(false),
      convertToIPLD: vi.fn(),
    } as any;

    // Mock reading files - return same content but with different key order
    let readFileCallCount = 0;
    vi.mocked(fsPromises.readFile).mockImplementation(async () => {
      readFileCallCount++;
      if (readFileCallCount === 1) {
        // First file: keys in one order
        return JSON.stringify({
          relationships: ['rel1', 'rel2'],
          label: 'Same Data',
        });
      } else {
        // Second file: same data, different key order
        return JSON.stringify({
          label: 'Same Data',
          relationships: ['rel1', 'rel2'],
        });
      }
    });

    const options: ValidateAndUploadCommandOptions = {
      inputDir: testInputDir,
      outputCsv: '/test/output.csv',
      dryRun: true,
    };

    const serviceOverrides: ValidateAndUploadServiceOverrides = {
      fileScannerService: mockFileScannerService,
      schemaCacheService: mockSchemaCacheService,
      jsonValidatorService: mockJsonValidatorService,
      jsonCanonicalizerService: canonicalizerService,
      cidCalculatorService: mockCidCalculatorService,
      csvReporterService: mockCsvReporterService,
      progressTracker: mockProgressTracker,
      ipldConverterService: mockIpldConverterService,
    };

    await handleValidateAndUpload(options, serviceOverrides);

    // Both files should have the same CID after canonicalization
    expect(calculatedCids).toHaveLength(2);
    expect(calculatedCids[0]).toBe(calculatedCids[1]);
  });
});
