import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from '@jest/globals';

// --- Define mock functions and instances FIRST ---
const mockEthersAbiCoderInstance = { decode: jest.fn() };
const mockEthersGetAddress = jest.fn((address: string) => address);
const mockEthersDataSlice = jest.fn(
  (data: string, offset: number) => '0x' + data.slice(2 + offset * 2)
);

const mockIsValidAddress =
  jest.fn<(address: string | undefined | null) => boolean>();
const mockIsValidUrl = jest.fn<(url: string | undefined | null) => boolean>();
const mockIsValidBlock =
  jest.fn<(block: string | undefined | null) => boolean>();
const mockIsValidCID = jest.fn<(cid: string | undefined | null) => boolean>();

jest.mock('ethers', () => ({
  __esModule: true,
  AbiCoder: { defaultAbiCoder: jest.fn(() => mockEthersAbiCoderInstance) },
  getAddress: mockEthersGetAddress,
  dataSlice: mockEthersDataSlice,
  JsonRpcProvider: jest.fn().mockImplementation(() => ({
    getBlockNumber: jest
      .fn<() => Promise<number>>()
      .mockResolvedValue(71875900),
  })),
  Contract: jest.fn().mockImplementation((address, abi, provider) => ({
    filters: {
      ElephantAssigned: jest
        .fn<(...args: any[]) => object>()
        .mockReturnValue({}),
    },
    queryFilter: jest
      .fn<(...args: any[]) => Promise<any[]>>()
      .mockResolvedValue([]),
    getAddress: jest
      .fn<() => Promise<string>>()
      .mockResolvedValue(address as string),
    resolveName: jest
      .fn<() => Promise<string | null>>()
      .mockResolvedValue(null),
    runner: provider,
    interface: {
      getEvent: jest
        .fn<() => { topicHash: string }>()
        .mockReturnValue({ topicHash: 'mockTopicHash' }),
    },
  })),
  EventLog: class MockEventLog {},
  Interface: jest.fn().mockImplementation(() => ({
    getEvent: jest.fn(() => ({ name: 'ElephantAssigned', inputs: [] })),
  })),
}));

jest.mock('../../src/utils/validation', () => ({
  __esModule: true,
  isValidAddress: mockIsValidAddress,
  isValidUrl: mockIsValidUrl,
  isValidBlock: mockIsValidBlock,
  isValidCID: mockIsValidCID,
}));

jest.mock('../../src/services/blockchain.service');
jest.mock('../../src/services/ipfs.service');
jest.mock('../../src/utils/logger');
jest.mock('../../src/utils/progress');

import { listAssignments } from '../../src/commands/list-assignments';
import { BlockchainService } from '../../src/services/blockchain.service';
import { IPFSService } from '../../src/services/ipfs.service';
import { logger } from '../../src/utils/logger';
import * as progress from '../../src/utils/progress';
import {
  CommandOptions,
  ElephantAssignment,
  DownloadResult,
} from '../../src/types';

const MockedBlockchainService = BlockchainService as jest.MockedClass<
  typeof BlockchainService
>;
const MockedIPFSService = IPFSService as jest.MockedClass<typeof IPFSService>;
const mockedLogger = logger as jest.Mocked<typeof logger>;
const mockedProgress = progress as jest.Mocked<typeof progress>;

describe('listAssignments integration', () => {
  let mockBlockchainServiceInstance: jest.MockedObject<BlockchainService>;
  let mockIPFSServiceInstance: jest.MockedObject<IPFSService>;
  let mockSpinner: jest.Mocked<ReturnType<typeof progress.createSpinner>>;
  let processExitSpy: jest.SpiedFunction<typeof process.exit>;

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
    jest.clearAllMocks();

    mockIsValidAddress.mockReturnValue(true);
    mockIsValidUrl.mockReturnValue(true);
    mockIsValidBlock.mockReturnValue(true);

    // Modify processExitSpy to not throw, just record calls
    processExitSpy = jest
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as any);

    mockSpinner = {
      start: jest.fn().mockReturnThis(),
      succeed: jest.fn().mockReturnThis(),
      fail: jest.fn().mockReturnThis(),
      warn: jest.fn().mockReturnThis(),
      stop: jest.fn().mockReturnThis(),
      text: '',
      isSpinning: false,
    } as unknown as jest.Mocked<ReturnType<typeof progress.createSpinner>>;
    mockedProgress.createSpinner.mockReturnValue(mockSpinner);

    mockBlockchainServiceInstance = {
      getCurrentBlock: jest
        .fn<() => Promise<number>>()
        .mockResolvedValue(71875900),
      getElephantAssignedEvents: jest
        .fn<() => Promise<ElephantAssignment[]>>()
        .mockResolvedValue(mockAssignmentsArray),
    } as unknown as jest.MockedObject<BlockchainService>;

    mockIPFSServiceInstance = {
      downloadBatch: jest
        .fn<() => Promise<DownloadResult[]>>()
        .mockResolvedValue(
          mockAssignmentsArray.map((a) => ({
            cid: a.cid,
            success: true,
            path: `${defaultOptions.downloadDir}/${a.cid}`,
          }))
        ),
    } as unknown as jest.MockedObject<IPFSService>;

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
