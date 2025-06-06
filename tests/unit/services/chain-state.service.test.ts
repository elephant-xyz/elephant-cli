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

    it('should return CID from cache when available', async () => {
      const mockHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      // Simulate cache populated with data
      const cacheKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef-0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      chainStateService['consensusDataCache'].set(cacheKey, mockHash);
      mockIsValidCID.mockReturnValue(true);

      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );

      expect(result).toBe('QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU');
      expect(mockIsValidCID).toHaveBeenCalledWith(
        'QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU'
      );
    });

    it('should return null when no cache entry exists', async () => {
      // Ensure cache is empty
      chainStateService['consensusDataCache'].clear();

      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );

      expect(result).toBeNull();
    });

    it('should return null when cached hash is empty or zero', async () => {
      const cacheKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef-0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      chainStateService['consensusDataCache'].set(cacheKey, ZeroHash);

      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );

      expect(result).toBeNull();
    });

    it('should return null and log warning when derived CID is invalid', async () => {
      const mockHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const cacheKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef-0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      chainStateService['consensusDataCache'].set(cacheKey, mockHash);
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
  });


  describe('hasUserSubmittedData', () => {
    const userAddress = '0x1234567890123456789012345678901234567890';
    const propertyCid = 'propQm123';
    const dataGroupCid = 'groupQm456';
    const dataCid = 'dataQm789';
    const normalizedUserAddress = getAddress(userAddress);

    it('should return true if user has submitted data (from cache)', async () => {
      const submissionKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef-0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef-0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const userSubmissions = new Set([submissionKey]);
      chainStateService['userSubmissionsCache'].set(normalizedUserAddress, userSubmissions);

      const result = await chainStateService.hasUserSubmittedData(
        userAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(true);
    });

    it('should return false if user has not submitted data (from cache)', async () => {
      const userSubmissions = new Set<string>(); // Empty set - no submissions
      chainStateService['userSubmissionsCache'].set(normalizedUserAddress, userSubmissions);

      const result = await chainStateService.hasUserSubmittedData(
        userAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(false);
    });

    it('should query events when no cache exists and return false for no submissions', async () => {
      // Ensure no cache exists
      chainStateService['userSubmissionsCache'].clear();
      
      // Mock getUserSubmissions to return empty set
      vi.spyOn(chainStateService, 'getUserSubmissions').mockResolvedValue(new Set<string>());

      const result = await chainStateService.hasUserSubmittedData(
        userAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(false);
      expect(chainStateService.getUserSubmissions).toHaveBeenCalledWith(normalizedUserAddress);
    });

    it('should return false and log error on getUserSubmissions failure', async () => {
      chainStateService['userSubmissionsCache'].clear();
      
      const error = new Error('Event query failed');
      vi.spyOn(chainStateService, 'getUserSubmissions').mockRejectedValue(error);

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
      const submissionKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef-0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef-0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
      const userSubmissions = new Set([submissionKey]);
      chainStateService['userSubmissionsCache'].set(normalizedUserAddress, userSubmissions);

      const result = await chainStateService.hasUserSubmittedData(
        lowercaseAddress,
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(result).toBe(true);
    });
  });
});
