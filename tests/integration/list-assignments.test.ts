import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';

// --- Define mock functions and instances FIRST ---
const mockEthersAbiCoderInstance = { decode: vi.fn() };
const mockEthersGetAddress = vi.fn((address: string) => address);
const mockEthersDataSlice = vi.fn(
  (data: string, offset: number) => '0x' + data.slice(2 + offset * 2)
);

const mockIsValidAddress =
  vi.fn<(address: string | undefined | null) => boolean>();
const mockIsValidUrl = vi.fn<(url: string | undefined | null) => boolean>();
const mockIsValidBlock =
  vi.fn<(block: string | undefined | null) => boolean>();
const mockIsValidCID = vi.fn<(cid: string | undefined | null) => boolean>();

vi.mock('ethers', () => ({
  __esModule: true,
  AbiCoder: { defaultAbiCoder: vi.fn(() => mockEthersAbiCoderInstance) },
  getAddress: mockEthersGetAddress,
  dataSlice: mockEthersDataSlice,
  JsonRpcProvider: vi.fn().mockImplementation(() => ({
    getBlockNumber: vi
      .fn<() => Promise<number>>()
      .mockResolvedValue(71875900),
  })),
  Contract: vi.fn().mockImplementation((address, abi, provider) => ({
    filters: {
      ElephantAssigned: vi
        .fn<(...args: any[]) => object>()
        .mockReturnValue({}),
    },
    queryFilter: vi
      .fn<(...args: any[]) => Promise<any[]>>()
      .mockResolvedValue([]),
    getAddress: vi
      .fn<() => Promise<string>>()
      .mockResolvedValue(address as string),
    resolveName: vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValue(null),
    runner: provider,
    interface: {
      getEvent: vi
        .fn<() => { topicHash: string }>()
        .mockReturnValue({ topicHash: 'mockTopicHash' }),
    },
  })),
  EventLog: class MockEventLog {},
  Interface: vi.fn().mockImplementation(() => ({
    getEvent: vi.fn(() => ({ name: 'ElephantAssigned', inputs: [] })),
  })),
}));

vi.mock('../../src/utils/validation.ts', () => ({
  __esModule: true,
  isValidAddress: mockIsValidAddress,
  isValidUrl: mockIsValidUrl,
  isValidBlock: mockIsValidBlock,
  isValidCID: mockIsValidCID,
}));

vi.mock('../../src/services/blockchain.service.ts');
vi.mock('../../src/services/ipfs.service.ts');
vi.mock('../../src/utils/logger.ts');
vi.mock('../../src/utils/progress.ts');

import { listAssignments } from '../../src/commands/list-assignments.ts';
import { BlockchainService } from '../../src/services/blockchain.service.ts';
import { IPFSService } from '../../src/services/ipfs.service.ts';
import { logger } from '../../src/utils/logger.ts';
import * as progress from '../../src/utils/progress.ts';
import {
  CommandOptions,
  ElephantAssignment,
  DownloadResult,
} from '../../src/types/index.ts';

const MockedBlockchainService = BlockchainService as any;
const MockedIPFSService = IPFSService as any;
const mockedLogger = logger as any;
const mockedProgress = progress as any;

describe('listAssignments integration', () => {
  let mockBlockchainServiceInstance: any;
  let mockIPFSServiceInstance: any;
  let mockSpinner: any;
  let processExitSpy: any;

  const defaultOptions: CommandOptions = {
    elephant: '0x0e44bfab0f7e1943cF47942221929F898E181505',
    contract: '0x79D5046e34D4A56D357E12636A18da6eaEfe0586',
    rpc: 'https://rpc.therpc.io/polygon',
    gateway: 'https://gateway.pinata.cloud/ipfs/',
    fromBlock: '71875850',
    downloadDir: './downloads',
  };

  const mockAssignmentsArray: ElephantAssignment[] = [
    {
      cid: 'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU',
      elephant: defaultOptions.elephant!,
      blockNumber: 71875870,
      transactionHash: '0xhash1',
    },
    {
      cid: 'QmSecondCID',
      elephant: defaultOptions.elephant!,
      blockNumber: 71875871,
      transactionHash: '0xhash2',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    mockIsValidAddress.mockReturnValue(true);
    mockIsValidUrl.mockReturnValue(true);
    mockIsValidBlock.mockReturnValue(true);

    // Modify processExitSpy to not throw, just record calls
    processExitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);

    mockSpinner = {
      start: vi.fn().mockReturnThis(),
      succeed: vi.fn().mockReturnThis(),
      fail: vi.fn().mockReturnThis(),
      warn: vi.fn().mockReturnThis(),
      stop: vi.fn().mockReturnThis(),
      text: '',
      isSpinning: false,
    } as unknown as any;
    mockedProgress.createSpinner.mockReturnValue(mockSpinner);

    mockBlockchainServiceInstance = {
      getCurrentBlock: vi
        .fn<() => Promise<number>>()
        .mockResolvedValue(71875900),
      getElephantAssignedEvents: vi
        .fn<() => Promise<ElephantAssignment[]>>()
        .mockResolvedValue(mockAssignmentsArray),
    } as unknown as any;

    mockIPFSServiceInstance = {
      downloadBatch: vi
        .fn<() => Promise<DownloadResult[]>>()
        .mockResolvedValue(
          mockAssignmentsArray.map((a) => ({
            cid: a.cid,
            success: true,
            path: `${defaultOptions.downloadDir}/${a.cid}`,
          }))
        ),
    } as unknown as any;

    MockedBlockchainService.mockImplementation(
      () => mockBlockchainServiceInstance
    );
    MockedIPFSService.mockImplementation(() => mockIPFSServiceInstance);
  });

  afterEach(() => {
    processExitSpy.mockRestore();
  });

  it('should complete full flow successfully', async () => {
    await listAssignments(defaultOptions);

    expect(mockIsValidAddress).toHaveBeenCalledWith(defaultOptions.elephant);
    expect(mockIsValidAddress).toHaveBeenCalledWith(defaultOptions.contract);
    expect(mockIsValidUrl).toHaveBeenCalledWith(defaultOptions.rpc);
    expect(mockIsValidUrl).toHaveBeenCalledWith(defaultOptions.gateway);
    expect(mockIsValidBlock).toHaveBeenCalledWith(defaultOptions.fromBlock);

    expect(MockedBlockchainService).toHaveBeenCalledWith(
      defaultOptions.rpc,
      defaultOptions.contract,
      expect.any(Array)
    );
    expect(MockedIPFSService).toHaveBeenCalledWith(
      defaultOptions.gateway,
      defaultOptions.maxConcurrentDownloads
    );

    expect(mockBlockchainServiceInstance.getCurrentBlock).toHaveBeenCalledTimes(
      1
    );
    expect(
      mockBlockchainServiceInstance.getElephantAssignedEvents
    ).toHaveBeenCalledWith(defaultOptions.elephant, 71875850, 71875900);
    expect(mockIPFSServiceInstance.downloadBatch).toHaveBeenCalledWith(
      mockAssignmentsArray,
      defaultOptions.downloadDir,
      expect.any(Function)
    );
    expect(mockedLogger.info).toHaveBeenCalledWith('Starting downloads...');
    expect(mockSpinner.succeed).toHaveBeenCalledWith(
      'Downloads complete! 2 succeeded, 0 failed.'
    );

    expect(mockedLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Summary:')
    );
    expect(mockedLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Total assignments found: 2')
    );
    expect(mockedLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Files downloaded: 2')
    );
  });

  it('should exit on invalid elephant address', async () => {
    const invalidOptions = {
      ...defaultOptions,
      elephant: 'invalid-address',
    };
    
    // Set the validation to return false for the invalid address
    mockIsValidAddress.mockImplementation((addr) => addr !== 'invalid-address');

    await listAssignments(invalidOptions);
    
    expect(mockedLogger.error).toHaveBeenCalledWith(
      'Invalid elephant address: invalid-address'
    );
    expect(processExitSpy).toHaveBeenCalledWith(1);
  });

  it('should handle no assignments found', async () => {
    mockBlockchainServiceInstance.getElephantAssignedEvents.mockResolvedValue(
      []
    );
    await listAssignments(defaultOptions);
    expect(mockedLogger.info).toHaveBeenCalledWith(
      'No assignments found for this elephant address in the specified block range.'
    );
    expect(mockIPFSServiceInstance.downloadBatch).not.toHaveBeenCalled();
    expect(processExitSpy).not.toHaveBeenCalled();
  });

  it('should display summary statistics (using mockedLogger.log)', async () => {
    await listAssignments(defaultOptions);
    expect(mockedLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Summary:')
    );
    expect(mockedLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Total assignments found: 2')
    );
    expect(mockedLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Files downloaded: 2')
    );
    expect(mockedLogger.log).toHaveBeenCalledWith(
      expect.stringContaining('Blocks scanned: 51')
    );
  });

  it('should use spinner.warn if downloads fail', async () => {
    mockIPFSServiceInstance.downloadBatch.mockResolvedValue([
      { cid: mockAssignmentsArray[0].cid, success: true, path: 'path1' },
      {
        cid: mockAssignmentsArray[1].cid,
        success: false,
        error: new Error('Failed'),
      },
    ]);
    await listAssignments(defaultOptions);
    expect(mockSpinner.warn).toHaveBeenCalledWith(
      'Downloads complete! 1 succeeded, 1 failed.'
    );
    expect(mockedLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to download CID QmSecondCID: Failed')
    );
    expect(processExitSpy).not.toHaveBeenCalled(); // Crucially, process.exit should not be called here
  });
});