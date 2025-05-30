import { describe, it, expect, vi, beforeEach } from 'vitest';
// Import necessary items from 'ethers' directly.
// Due to vi.mock, these will be the mocked versions.
import {
  Contract,
  JsonRpcProvider,
  ZeroHash,
  toUtf8Bytes,
  toUtf8String,
  getAddress,
  ethers,
} from 'ethers';

// --- Mock dependencies FIRST ---

// Use vi.hoisted for mockIsValidCID
const { mockIsValidCID } = vi.hoisted(() => {
  return { mockIsValidCID: vi.fn() };
});
vi.mock('../../../src/utils/validation', () => ({
  isValidCID: mockIsValidCID,
  extractHashFromCID: vi
    .fn()
    .mockReturnValue(
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    ),
  deriveCIDFromHash: vi
    .fn()
    .mockReturnValue('QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'),
}));

// Mock ethers
const mockEthersContractInstance = {
  getCurrentFieldDataHash: vi.fn(),
  getParticipantsForConsensusDataHash: vi.fn(),
  hasUserSubmittedDataHash: vi.fn(),
};
const mockJsonRpcProviderInstance = {
  getBlockNumber: vi.fn().mockResolvedValue(12345),
};

vi.mock('ethers', async (importOriginal) => {
  const originalEthers = await importOriginal<typeof import('ethers')>();
  return {
    // Spread originalEthers first to ensure all exports are available
    ...originalEthers,
    // Then override specific parts with mocks
    JsonRpcProvider: vi
      .fn()
      .mockImplementation(() => mockJsonRpcProviderInstance),
    Contract: vi.fn().mockImplementation(() => mockEthersContractInstance),
    // Keep original utilities if they are not meant to be mocked or are used by SUT
    // If toUtf8Bytes, toUtf8String, getAddress, ZeroHash are used by the SUT and don't need mocking,
    // they will be taken from originalEthers. If they need to be spies, they should be vi.fn() here.
    // For this test, it seems they are used as utilities, so keeping them from original is fine.
  };
});

// --- Import SUT (ChainStateService) AFTER mocks ---
import { ChainStateService } from '../../../src/services/chain-state.service';
import { ABI } from '../../../src/types';
import { SUBMIT_CONTRACT_ABI_FRAGMENTS } from '../../../src/config/constants';

describe('ChainStateService', () => {
  const mockRpcUrl = 'http://localhost:8545';
  const mockOracleContractAddress = '0xOracleContractAddress';
  const mockSubmitContractAddress = '0xSubmitContractAddress';
  const mockBaseAbi: ABI = [
    { type: 'event', name: 'OracleAssigned', inputs: [] },
  ];

  let chainStateService: ChainStateService;

  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure the mock functions on the instance are reset
    mockEthersContractInstance.getCurrentFieldDataHash.mockReset();
    mockEthersContractInstance.getParticipantsForConsensusDataHash.mockReset();
    mockEthersContractInstance.hasUserSubmittedDataHash.mockReset();
    // Also reset the Contract constructor spy itself if it's re-used across tests for constructor calls
    (Contract as ReturnType<typeof vi.fn>).mockClear();
    (JsonRpcProvider as ReturnType<typeof vi.fn>).mockClear();

    mockIsValidCID.mockReturnValue(true);

    chainStateService = new ChainStateService(
      mockRpcUrl,
      mockOracleContractAddress,
      mockSubmitContractAddress,
      mockBaseAbi
    );
  });

  describe('constructor', () => {
    it('should initialize BlockchainService superclass', () => {
      expect(chainStateService).toBeInstanceOf(ChainStateService);
      // Check if JsonRpcProvider was called for the super class
      expect(JsonRpcProvider).toHaveBeenCalledWith(mockRpcUrl);
    });

    it('should create a new Contract instance for submitContract', () => {
      // JsonRpcProvider is called once for super, once for this.submitContract
      expect(JsonRpcProvider).toHaveBeenCalledTimes(2);
      expect(JsonRpcProvider).toHaveBeenLastCalledWith(mockRpcUrl);

      // Assert against the imported (and mocked) Contract constructor
      expect(Contract).toHaveBeenCalledWith(
        mockSubmitContractAddress,
        SUBMIT_CONTRACT_ABI_FRAGMENTS,
        mockJsonRpcProviderInstance // The instance returned by the mocked JsonRpcProvider
      );
    });
  });

  describe('getCurrentDataCid', () => {
    const propertyCid = 'propQm123';
    const dataGroupCid = 'groupQm456';
    const expectedDataCid = 'dataQm789';
    const expectedDataCidWithDot = `.${expectedDataCid}`;

    it('should fetch and return a valid data CID', async () => {
      const mockHash =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      mockEthersContractInstance.getCurrentFieldDataHash.mockResolvedValue(
        mockHash
      );

      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );

      expect(
        mockEthersContractInstance.getCurrentFieldDataHash
      ).toHaveBeenCalledWith(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      );
      expect(result).toBe('QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU');
      expect(mockIsValidCID).toHaveBeenCalledWith(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
    });

    it('should return null if contract returns ZeroHash', async () => {
      mockEthersContractInstance.getCurrentFieldDataHash.mockResolvedValue(
        ZeroHash
      );
      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );
      expect(result).toBeNull();
    });

    it('should return null if contract returns "0x"', async () => {
      mockEthersContractInstance.getCurrentFieldDataHash.mockResolvedValue(
        '0x'
      );
      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );
      expect(result).toBeNull();
    });

    it('should return null and log warning if CID is invalid', async () => {
      const invalidHash =
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      mockEthersContractInstance.getCurrentFieldDataHash.mockResolvedValue(
        invalidHash
      );
      mockIsValidCID.mockReturnValue(false);

      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );

      expect(result).toBeNull();
      expect(mockIsValidCID).toHaveBeenCalledWith(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
    });

    it('should return null and log error on contract call failure', async () => {
      const error = new Error('Contract call failed');
      mockEthersContractInstance.getCurrentFieldDataHash.mockRejectedValue(
        error
      );

      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );

      expect(result).toBeNull();
    });
  });

  describe('getSubmittedParticipants', () => {
    const propertyCid = 'propQm123';
    const dataGroupCid = 'groupQm456';
    const dataCid = 'dataQm789';
    const mockAddresses = [
      '0x1234567890123456789012345678901234567890',
      '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    ];
    // Use the imported getAddress from ethers
    const normalizedAddresses = mockAddresses.map((addr) => getAddress(addr));

    it('should fetch and return participant addresses', async () => {
      mockEthersContractInstance.getParticipantsForConsensusDataHash.mockResolvedValue(
        mockAddresses
      );

      const result = await chainStateService.getSubmittedParticipants(
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(
        mockEthersContractInstance.getParticipantsForConsensusDataHash
      ).toHaveBeenCalledWith(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      );
      expect(result).toEqual(normalizedAddresses);
    });

    it('should return an empty array and log error on contract call failure', async () => {
      const error = new Error('Contract call failed');
      mockEthersContractInstance.getParticipantsForConsensusDataHash.mockRejectedValue(
        error
      );

      const result = await chainStateService.getSubmittedParticipants(
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toEqual([]);
    });
  });

  describe('batchGetCurrentDataCids', () => {
    const queries = [
      { propertyCid: 'prop1', dataGroupCid: 'group1' },
      { propertyCid: 'prop2', dataGroupCid: 'group2' },
      { propertyCid: 'prop3', dataGroupCid: 'group3' },
    ];
    const expectedCid1 = 'dataQm111';
    const expectedCid2 = 'dataQm222';

    it('should fetch CIDs for all queries concurrently', async () => {
      const mockHash1 =
        '0x1111111111111111111111111111111111111111111111111111111111111111';
      const mockHash2 =
        '0x2222222222222222222222222222222222222222222222222222222222222222';

      mockEthersContractInstance.getCurrentFieldDataHash
        .mockResolvedValueOnce(mockHash1)
        .mockResolvedValueOnce(mockHash2)
        .mockResolvedValueOnce(ZeroHash);

      const results = await chainStateService.batchGetCurrentDataCids(queries);

      expect(
        mockEthersContractInstance.getCurrentFieldDataHash
      ).toHaveBeenCalledTimes(3);
      expect(results.size).toBe(3);
      expect(results.get('prop1/group1')).toBe(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(results.get('prop2/group2')).toBe(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(results.get('prop3/group3')).toBeNull();
    });

    it('should handle errors in individual getCurrentDataCid calls gracefully', async () => {
      const mockHash1 =
        '0x1111111111111111111111111111111111111111111111111111111111111111';
      const mockHash2 =
        '0x2222222222222222222222222222222222222222222222222222222222222222';

      mockEthersContractInstance.getCurrentFieldDataHash
        .mockResolvedValueOnce(mockHash1)
        .mockRejectedValueOnce(new Error('Network error for prop2/group2'))
        .mockResolvedValueOnce(mockHash2);

      const results = await chainStateService.batchGetCurrentDataCids(queries);

      expect(results.size).toBe(3);
      expect(results.get('prop1/group1')).toBe(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
      expect(results.get('prop2/group2')).toBeNull();
      expect(results.get('prop3/group3')).toBe(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
    });
  });

  describe('hasUserSubmittedData', () => {
    const userAddress = '0x1234567890123456789012345678901234567890';
    const propertyCid = 'propQm123';
    const dataGroupCid = 'groupQm456';
    const dataCid = 'dataQm789';
    const normalizedUserAddress = getAddress(userAddress);

    it('should return true if user has submitted data', async () => {
      mockEthersContractInstance.hasUserSubmittedDataHash.mockResolvedValue(
        true
      );

      const result = await chainStateService.hasUserSubmittedData(
        userAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(true);
      expect(
        mockEthersContractInstance.hasUserSubmittedDataHash
      ).toHaveBeenCalledWith(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        normalizedUserAddress
      );
    });

    it('should return false if user has not submitted data', async () => {
      mockEthersContractInstance.hasUserSubmittedDataHash.mockResolvedValue(
        false
      );

      const result = await chainStateService.hasUserSubmittedData(
        userAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(false);
      expect(
        mockEthersContractInstance.hasUserSubmittedDataHash
      ).toHaveBeenCalledWith(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        normalizedUserAddress
      );
    });

    it('should return false when contract returns false', async () => {
      mockEthersContractInstance.hasUserSubmittedDataHash.mockResolvedValue(
        false
      );

      const result = await chainStateService.hasUserSubmittedData(
        userAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(false);
    });

    it('should return false and log error on contract call failure', async () => {
      const error = new Error('Contract call failed');
      mockEthersContractInstance.hasUserSubmittedDataHash.mockRejectedValue(
        error
      );

      const result = await chainStateService.hasUserSubmittedData(
        userAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(false);
    });

    it('should handle address normalization correctly', async () => {
      const lowercaseAddress = userAddress.toLowerCase();
      mockEthersContractInstance.hasUserSubmittedDataHash.mockResolvedValue(
        true
      );

      const result = await chainStateService.hasUserSubmittedData(
        lowercaseAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(true);
      expect(
        mockEthersContractInstance.hasUserSubmittedDataHash
      ).toHaveBeenCalledWith(
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
        normalizedUserAddress // Should be normalized even if input was lowercase
      );
    });
  });
});
