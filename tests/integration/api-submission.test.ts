import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleSubmitToContract } from '../../src/commands/submit-to-contract.js';
import { writeFileSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('API Submission Integration', () => {
  let testDir: string;
  let csvPath: string;
  let mockApiService: any;
  let mockStatusService: any;
  let mockStatusReporter: any;

  beforeEach(() => {
    // Create test directory
    testDir = join(tmpdir(), `elephant-cli-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });

    // Create test CSV
    csvPath = join(testDir, 'test-data.csv');
    const csvContent = `propertyCid,dataGroupCid,dataCid,filePath,uploadedAt
QmProperty1,QmDataGroup1,QmData1,/path/to/file1.json,2024-01-01T00:00:00Z
QmProperty2,QmDataGroup2,QmData2,/path/to/file2.json,2024-01-01T00:00:01Z`;
    writeFileSync(csvPath, csvContent);

    // Create mock services
    mockApiService = {
      submitTransaction: vi.fn().mockResolvedValue({
        transaction_hash: '0xmocktxhash',
      }),
    };

    mockStatusService = {
      waitForTransaction: vi.fn().mockResolvedValue({
        hash: '0xmocktxhash',
        status: 'success',
        blockNumber: 12345,
        gasUsed: '21000',
      }),
    };

    mockStatusReporter = {
      initialize: vi.fn(),
      logTransaction: vi.fn(),
      finalize: vi.fn(),
    };
  });

  afterEach(() => {
    // Clean up test directory
    rmSync(testDir, { recursive: true, force: true });
  });

  it('should submit data via API when API parameters are provided', async () => {
    const options = {
      rpcUrl: 'https://rpc.test.com',
      contractAddress: '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
      privateKey: '', // No private key in API mode
      csvFile: csvPath,
      gasPrice: 30,
      dryRun: false,
      domain: 'oracles.staircaseapi.com',
      apiKey: 'invalid-key',
      oracleKeyId: '550e8400-e29b-41d4-a716-446655440000',
      fromAddress: '0x1234567890123456789012345678901234567890',
    };

    // Mock the UnsignedTransactionJsonService
    const mockUnsignedTxService = {
      generateUnsignedTransactions: vi.fn().mockResolvedValue([
        {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
          data: '0xmockdata',
          value: '0x0',
          gas: '0x5208',
          nonce: '0x0',
          type: '0x0',
          gasPrice: '0x6fc23ac00',
        },
      ]),
    };

    await handleSubmitToContract(options, {
      apiSubmissionService: mockApiService,
      transactionStatusService: mockStatusService,
      transactionStatusReporter: mockStatusReporter,
      chainStateService: {
        prepopulateConsensusCache: vi.fn(),
        getUserSubmissions: vi.fn().mockResolvedValue(new Set()),
        getCurrentDataCid: vi.fn().mockResolvedValue(null),
        hasUserSubmittedData: vi.fn().mockResolvedValue(false),
      } as any,
      transactionBatcherService: {
        groupItemsIntoBatches: vi.fn().mockImplementation((items) => [items]),
      } as any,
      unsignedTransactionJsonService: mockUnsignedTxService as any,
    });

    // Verify API submission was called
    expect(mockApiService.submitTransaction).toHaveBeenCalled();

    // Verify status was logged
    expect(mockStatusReporter.logTransaction).toHaveBeenCalled();
  });

  it('should handle API submission errors gracefully', async () => {
    mockApiService.submitTransaction.mockRejectedValueOnce(
      new Error('API Error: Invalid API key')
    );

    const options = {
      rpcUrl: 'https://rpc.test.com',
      contractAddress: '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
      privateKey: '',
      csvFile: csvPath,
      gasPrice: 30,
      dryRun: false,
      domain: 'oracles.staircaseapi.com',
      apiKey: 'invalid-key',
      oracleKeyId: '550e8400-e29b-41d4-a716-446655440000',
      fromAddress: '0x1234567890123456789012345678901234567890',
    };

    // Mock the UnsignedTransactionJsonService
    const mockUnsignedTxService = {
      generateUnsignedTransactions: vi.fn().mockResolvedValue([
        {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
          data: '0xmockdata',
          value: '0x0',
          gas: '0x5208',
          nonce: '0x0',
          type: '0x0',
          gasPrice: '0x6fc23ac00',
        },
      ]),
    };

    await handleSubmitToContract(options, {
      apiSubmissionService: mockApiService,
      transactionStatusService: mockStatusService,
      transactionStatusReporter: mockStatusReporter,
      chainStateService: {
        prepopulateConsensusCache: vi.fn(),
        getUserSubmissions: vi.fn().mockResolvedValue(new Set()),
        getCurrentDataCid: vi.fn().mockResolvedValue(null),
        hasUserSubmittedData: vi.fn().mockResolvedValue(false),
      } as any,
      transactionBatcherService: {
        groupItemsIntoBatches: vi.fn().mockImplementation((items) => [items]),
      } as any,
      unsignedTransactionJsonService: mockUnsignedTxService as any,
    });

    // Should still log the error to the status reporter
    expect(mockStatusReporter.logTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        error: expect.stringContaining('API Error'),
      })
    );
  });

  it('should work without private key when using API mode', async () => {
    const options = {
      rpcUrl: 'https://rpc.test.com',
      contractAddress: '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
      privateKey: '', // No private key
      csvFile: csvPath,
      gasPrice: 'auto' as const,
      dryRun: false,
      domain: 'oracles.staircaseapi.com',
      apiKey: 'test-api-key',
      oracleKeyId: '550e8400-e29b-41d4-a716-446655440000',
      fromAddress: '0x1234567890123456789012345678901234567890',
    };

    // Mock the UnsignedTransactionJsonService
    const mockUnsignedTxService = {
      generateUnsignedTransactions: vi.fn().mockResolvedValue([
        {
          from: '0x1234567890123456789012345678901234567890',
          to: '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
          data: '0xmockdata',
          value: '0x0',
          gas: '0x5208',
          nonce: '0x0',
          type: '0x2',
          maxFeePerGas: '0x6fc23ac00',
          maxPriorityFeePerGas: '0x3b9aca00',
        },
      ]),
    };

    await handleSubmitToContract(options, {
      apiSubmissionService: mockApiService,
      transactionStatusService: mockStatusService,
      transactionStatusReporter: mockStatusReporter,
      chainStateService: {
        prepopulateConsensusCache: vi.fn(),
        getUserSubmissions: vi.fn().mockResolvedValue(new Set()),
        getCurrentDataCid: vi.fn().mockResolvedValue(null),
        hasUserSubmittedData: vi.fn().mockResolvedValue(false),
      } as any,
      transactionBatcherService: {
        groupItemsIntoBatches: vi.fn().mockImplementation((items) => [items]),
      } as any,
      unsignedTransactionJsonService: mockUnsignedTxService as any,
    });

    // Should still work
    expect(mockApiService.submitTransaction).toHaveBeenCalled();
  });
});
