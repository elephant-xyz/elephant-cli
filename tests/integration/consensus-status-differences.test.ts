import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { consensusStatusCommand } from '../../src/commands/consensus-status.js';
import { ConsensusStatusOptions } from '../../src/types/index.js';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { BlockchainService } from '../../src/services/blockchain.service.js';
import { IpfsDataComparatorService } from '../../src/services/ipfs-data-comparator.service.js';

// Mock the services
vi.mock('../../src/services/blockchain.service.js');
vi.mock('../../src/services/ipfs-data-comparator.service.js');
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    error: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('Consensus Status Command with Difference Analysis', () => {
  let tempDir: string;
  let outputCsv: string;
  let mockBlockchainService: any;
  let mockComparatorService: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create temporary directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'consensus-test-'));
    outputCsv = path.join(tempDir, 'consensus.csv');

    // Setup mock blockchain service
    mockBlockchainService = {
      getCurrentBlock: vi.fn().mockResolvedValue(1000000),
      getDataSubmittedEventsStream: vi.fn(),
    };

    // Setup mock comparator service
    mockComparatorService = {
      compareMultipleCids: vi.fn(),
      clearCache: vi.fn(),
    };

    // Mock the constructors
    (BlockchainService as any).mockImplementation(() => mockBlockchainService);
    (IpfsDataComparatorService as any).mockImplementation(
      () => mockComparatorService
    );
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  it('should analyze differences for partial consensus cases', async () => {
    // Mock blockchain events - partial consensus with multiple unique hashes
    // 2 oracles agree on hash1, 1 oracle has hash2 = partial consensus with differences
    const mockEvents = [
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle1',
        dataHash: '0xhash1',
        blockNumber: 100,
        transactionHash: '0xtx1',
      },
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle2',
        dataHash: '0xhash1', // Same as oracle1
        blockNumber: 101,
        transactionHash: '0xtx2',
      },
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle3',
        dataHash: '0xhash2', // Different hash
        blockNumber: 102,
        transactionHash: '0xtx3',
      },
    ];

    // Setup event stream
    async function* mockEventStream() {
      yield mockEvents;
    }
    mockBlockchainService.getDataSubmittedEventsStream.mockReturnValue(
      mockEventStream()
    );

    // Mock comparison result for 2 different CIDs (hash1 and hash2)
    mockComparatorService.compareMultipleCids.mockResolvedValue({
      propertyHash: '0xprop1',
      dataGroupHash: '0xgroup1',
      cids: ['bafkreihash1', 'bafkreihash2'], // CIDs for the 2 unique hashes
      pairwiseComparisons: [
        {
          cid1: 'bafkreihash1',
          cid2: 'bafkreihash2',
          differences: [
            {
              path: 'relationships.property_seed.value',
              type: 'UPDATE',
              oldValue: 'old',
              newValue: 'new',
              description: 'Changed from "old" to "new"',
            },
          ],
          differenceCount: 1,
          hasDifferences: true,
        },
      ],
      summary:
        'Compared 2 submissions: Most common differences: - relationships.property_seed.value (UPDATE): appears in 1 comparison(s)',
      totalDifferences: 1,
    });

    const options: ConsensusStatusOptions = {
      fromBlock: 100,
      toBlock: 200,
      rpcUrl: 'https://test-rpc.com',
      outputCsv,
      analyzeDifferences: true,
      gatewayUrl: 'https://test-gateway.ipfs.io',
    };

    await consensusStatusCommand(options);

    // Verify comparator was called
    expect(mockComparatorService.compareMultipleCids).toHaveBeenCalled();
    expect(mockComparatorService.clearCache).toHaveBeenCalled();

    // Verify CSV was created
    const csvExists = await fs
      .access(outputCsv)
      .then(() => true)
      .catch(() => false);
    expect(csvExists).toBe(true);

    // Read and verify CSV content
    const csvContent = await fs.readFile(outputCsv, 'utf-8');
    const lines = csvContent.trim().split('\n');

    // Check headers include difference columns
    expect(lines[0]).toContain('totalDifferences');
    expect(lines[0]).toContain('differenceSummary');

    // Check data row contains difference information
    if (lines.length > 1) {
      expect(lines[1]).toContain('1'); // totalDifferences
      expect(lines[1]).toContain('Compared 2 submissions');
    }
  });

  it('should skip difference analysis when flag is false', async () => {
    // Mock blockchain events
    const mockEvents = [
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle1',
        dataHash: '0xhash1',
        blockNumber: 100,
        transactionHash: '0xtx1',
      },
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle2',
        dataHash: '0xhash2',
        blockNumber: 101,
        transactionHash: '0xtx2',
      },
    ];

    async function* mockEventStream() {
      yield mockEvents;
    }
    mockBlockchainService.getDataSubmittedEventsStream.mockReturnValue(
      mockEventStream()
    );

    const options: ConsensusStatusOptions = {
      fromBlock: 100,
      toBlock: 200,
      rpcUrl: 'https://test-rpc.com',
      outputCsv,
      analyzeDifferences: false, // Disabled
    };

    await consensusStatusCommand(options);

    // Verify comparator was NOT called
    expect(mockComparatorService.compareMultipleCids).not.toHaveBeenCalled();

    // Verify CSV was still created
    const csvExists = await fs
      .access(outputCsv)
      .then(() => true)
      .catch(() => false);
    expect(csvExists).toBe(true);
  });

  it('should handle multiple partial consensus cases', async () => {
    // Mock blockchain events with multiple partial consensus scenarios
    const mockEvents = [
      // First partial consensus group (2 agree on hash1, 1 has hash2)
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle1',
        dataHash: '0xhash1',
        blockNumber: 100,
        transactionHash: '0xtx1',
      },
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle2',
        dataHash: '0xhash1', // Same as oracle1
        blockNumber: 101,
        transactionHash: '0xtx2',
      },
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle3',
        dataHash: '0xhash2', // Different
        blockNumber: 102,
        transactionHash: '0xtx3',
      },
      // Second partial consensus group (2 agree on hash3, 1 has hash4)
      {
        propertyHash: '0xprop2',
        dataGroupHash: '0xgroup2',
        submitter: '0xoracle1',
        dataHash: '0xhash3',
        blockNumber: 103,
        transactionHash: '0xtx4',
      },
      {
        propertyHash: '0xprop2',
        dataGroupHash: '0xgroup2',
        submitter: '0xoracle2',
        dataHash: '0xhash3', // Same as oracle1
        blockNumber: 104,
        transactionHash: '0xtx5',
      },
      {
        propertyHash: '0xprop2',
        dataGroupHash: '0xgroup2',
        submitter: '0xoracle3',
        dataHash: '0xhash4', // Different
        blockNumber: 105,
        transactionHash: '0xtx6',
      },
    ];

    async function* mockEventStream() {
      yield mockEvents;
    }
    mockBlockchainService.getDataSubmittedEventsStream.mockReturnValue(
      mockEventStream()
    );

    // Mock comparison results for both cases
    mockComparatorService.compareMultipleCids
      .mockResolvedValueOnce({
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        cids: ['bafkreihash1', 'bafkreihash2'],
        pairwiseComparisons: [
          {
            cid1: 'bafkreihash1',
            cid2: 'bafkreihash2',
            differences: [
              {
                path: 'value1',
                type: 'UPDATE',
                oldValue: 'a',
                newValue: 'b',
                description: 'Changed from "a" to "b"',
              },
            ],
            differenceCount: 1,
            hasDifferences: true,
          },
        ],
        summary: 'Compared 2 submissions: 1 difference',
        totalDifferences: 1,
      })
      .mockResolvedValueOnce({
        propertyHash: '0xprop2',
        dataGroupHash: '0xgroup2',
        cids: ['bafkreihash3', 'bafkreihash4'],
        pairwiseComparisons: [
          {
            cid1: 'bafkreihash3',
            cid2: 'bafkreihash4',
            differences: [
              {
                path: 'value2',
                type: 'ADD',
                newValue: 'new',
                description: 'Added: "new"',
              },
              {
                path: 'value3',
                type: 'REMOVE',
                oldValue: 'old',
                description: 'Removed: "old"',
              },
            ],
            differenceCount: 2,
            hasDifferences: true,
          },
        ],
        summary: 'Compared 2 submissions: 2 differences',
        totalDifferences: 2,
      });

    const options: ConsensusStatusOptions = {
      fromBlock: 100,
      toBlock: 200,
      rpcUrl: 'https://test-rpc.com',
      outputCsv,
      analyzeDifferences: true,
      gatewayUrl: 'https://test-gateway.ipfs.io',
    };

    await consensusStatusCommand(options);

    // Verify comparator was called twice
    expect(mockComparatorService.compareMultipleCids).toHaveBeenCalledTimes(2);

    // Verify CSV contains both analyses
    const csvContent = await fs.readFile(outputCsv, 'utf-8');
    const lines = csvContent.trim().split('\n');

    // Should have header + 2 data rows
    expect(lines.length).toBeGreaterThanOrEqual(3);
  });

  it('should handle comparison errors gracefully', async () => {
    // Mock blockchain events
    const mockEvents = [
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle1',
        dataHash: '0xhash1',
        blockNumber: 100,
        transactionHash: '0xtx1',
      },
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle2',
        dataHash: '0xhash2',
        blockNumber: 101,
        transactionHash: '0xtx2',
      },
    ];

    async function* mockEventStream() {
      yield mockEvents;
    }
    mockBlockchainService.getDataSubmittedEventsStream.mockReturnValue(
      mockEventStream()
    );

    // Mock comparison to throw error
    mockComparatorService.compareMultipleCids.mockRejectedValue(
      new Error('Failed to fetch IPFS data')
    );

    const options: ConsensusStatusOptions = {
      fromBlock: 100,
      toBlock: 200,
      rpcUrl: 'https://test-rpc.com',
      outputCsv,
      analyzeDifferences: true,
      gatewayUrl: 'https://test-gateway.ipfs.io',
    };

    // Should not throw, but handle error gracefully
    await consensusStatusCommand(options);

    // CSV should still be created
    const csvExists = await fs
      .access(outputCsv)
      .then(() => true)
      .catch(() => false);
    expect(csvExists).toBe(true);

    // But without difference data
    const csvContent = await fs.readFile(outputCsv, 'utf-8');
    const lines = csvContent.trim().split('\n');

    if (lines.length > 1) {
      // Difference columns should have placeholder values
      expect(lines[1]).toContain('-,-'); // totalDifferences and differenceSummary should be empty
    }
  });

  it('should handle full consensus (no differences needed)', async () => {
    // Mock blockchain events with full consensus
    const mockEvents = [
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle1',
        dataHash: '0xhash1',
        blockNumber: 100,
        transactionHash: '0xtx1',
      },
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle2',
        dataHash: '0xhash1', // Same hash
        blockNumber: 101,
        transactionHash: '0xtx2',
      },
      {
        propertyHash: '0xprop1',
        dataGroupHash: '0xgroup1',
        submitter: '0xoracle3',
        dataHash: '0xhash1', // Same hash
        blockNumber: 102,
        transactionHash: '0xtx3',
      },
    ];

    async function* mockEventStream() {
      yield mockEvents;
    }
    mockBlockchainService.getDataSubmittedEventsStream.mockReturnValue(
      mockEventStream()
    );

    const options: ConsensusStatusOptions = {
      fromBlock: 100,
      toBlock: 200,
      rpcUrl: 'https://test-rpc.com',
      outputCsv,
      analyzeDifferences: true,
      gatewayUrl: 'https://test-gateway.ipfs.io',
    };

    await consensusStatusCommand(options);

    // Comparator should NOT be called for full consensus
    expect(mockComparatorService.compareMultipleCids).not.toHaveBeenCalled();

    // Verify CSV shows full consensus
    const csvContent = await fs.readFile(outputCsv, 'utf-8');
    expect(csvContent).toContain('true'); // consensusReached = true
  });
});
