import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZeroHash } from 'ethers'; // Import directly if not re-exported by mocked 'ethers'

// --- Mock dependencies FIRST ---

// Use vi.hoisted for mockIsValidCID
const { mockIsValidCID } = vi.hoisted(() => {
  return { mockIsValidCID: vi.fn() };
});
vi.mock('../../../src/utils/validation', () => ({
  isValidCID: mockIsValidCID,
}));

// Mock ethers
const mockEthersContractInstance = {
  getCurrentFieldDataCID: vi.fn(),
  getParticipantsForConsensusDataCID: vi.fn(),
};
const mockJsonRpcProviderInstance = {
  getBlockNumber: vi.fn().mockResolvedValue(12345),
};

vi.mock('ethers', async (importOriginal) => {
  const originalEthers = await importOriginal<typeof import('ethers')>();
  return {
    ...originalEthers,
    JsonRpcProvider: vi
      .fn()
      .mockImplementation(() => mockJsonRpcProviderInstance),
    Contract: vi.fn().mockImplementation(() => mockEthersContractInstance),
    toUtf8Bytes: originalEthers.toUtf8Bytes,
    toUtf8String: originalEthers.toUtf8String,
    getAddress: originalEthers.getAddress,
    ZeroHash: originalEthers.ZeroHash,
  };
});

// --- Import SUT (ChainStateService) AFTER mocks ---
import { ChainStateService } from '../../../src/services/chain-state.service';
import { ABI } from '../../../src/types';
import { SUBMIT_CONTRACT_ABI_FRAGMENTS } from '../../../src/config/constants'; // Removed SUBMIT_CONTRACT_METHODS as it's not directly used in this test file's logic after SUT import

// Import actual ethers utils needed for tests, after mock setup
import { toUtf8Bytes } from 'ethers'; // toUtf8String is also used but implicitly via originalEthers spread

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
    mockEthersContractInstance.getCurrentFieldDataCID.mockReset();
    mockEthersContractInstance.getParticipantsForConsensusDataCID.mockReset();
    mockIsValidCID.mockReturnValue(true); // Use the hoisted mock

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
    });

    it('should create a new Contract instance for submitContract', () => {
      const ethers = require('ethers');
      expect(ethers.Contract).toHaveBeenCalledWith(
        mockSubmitContractAddress,
        SUBMIT_CONTRACT_ABI_FRAGMENTS,
        expect.any(ethers.JsonRpcProvider)
      );
    });
  });

  describe('getCurrentDataCid', () => {
    const propertyCid = 'propQm123';
    const dataGroupCid = 'groupQm456';
    const expectedDataCid = 'dataQm789';
    const expectedDataCidWithDot = `.${expectedDataCid}`;

    it('should fetch and return a valid data CID', async () => {
      mockEthersContractInstance.getCurrentFieldDataCID.mockResolvedValue(
        toUtf8Bytes(expectedDataCidWithDot)
      );

      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );

      expect(
        mockEthersContractInstance.getCurrentFieldDataCID
      ).toHaveBeenCalledWith(
        toUtf8Bytes(`.${propertyCid}`),
        toUtf8Bytes(`.${dataGroupCid}`)
      );
      expect(result).toBe(expectedDataCid);
      expect(mockIsValidCID).toHaveBeenCalledWith(expectedDataCid); // Check with the hoisted mock
    });

    it('should return null if contract returns ZeroHash', async () => {
      mockEthersContractInstance.getCurrentFieldDataCID.mockResolvedValue(
        ZeroHash
      );
      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );
      expect(result).toBeNull();
    });

    it('should return null if contract returns "0x"', async () => {
      mockEthersContractInstance.getCurrentFieldDataCID.mockResolvedValue('0x');
      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );
      expect(result).toBeNull();
    });

    it('should return null and log warning if CID is invalid', async () => {
      mockEthersContractInstance.getCurrentFieldDataCID.mockResolvedValue(
        toUtf8Bytes('.invalidCidFormat')
      );
      mockIsValidCID.mockReturnValue(false); // Use the hoisted mock

      const result = await chainStateService.getCurrentDataCid(
        propertyCid,
        dataGroupCid
      );

      expect(result).toBeNull();
      expect(mockIsValidCID).toHaveBeenCalledWith('invalidCidFormat'); // Check with the hoisted mock
    });

    it('should return null and log error on contract call failure', async () => {
      const error = new Error('Contract call failed');
      mockEthersContractInstance.getCurrentFieldDataCID.mockRejectedValue(
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
    const normalizedAddresses = mockAddresses.map((addr) =>
      require('ethers').getAddress(addr)
    );

    it('should fetch and return participant addresses', async () => {
      mockEthersContractInstance.getParticipantsForConsensusDataCID.mockResolvedValue(
        mockAddresses
      );

      const result = await chainStateService.getSubmittedParticipants(
        propertyCid,
        dataGroupCid,
        dataCid
      );

      expect(
        mockEthersContractInstance.getParticipantsForConsensusDataCID
      ).toHaveBeenCalledWith(
        toUtf8Bytes(`.${propertyCid}`),
        toUtf8Bytes(`.${dataGroupCid}`),
        toUtf8Bytes(`.${dataCid}`)
      );
      expect(result).toEqual(normalizedAddresses);
    });

    it('should return an empty array and log error on contract call failure', async () => {
      const error = new Error('Contract call failed');
      mockEthersContractInstance.getParticipantsForConsensusDataCID.mockRejectedValue(
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
      mockEthersContractInstance.getCurrentFieldDataCID
        .mockResolvedValueOnce(toUtf8Bytes(`.${expectedCid1}`))
        .mockResolvedValueOnce(toUtf8Bytes(`.${expectedCid2}`))
        .mockResolvedValueOnce(ZeroHash);

      const results = await chainStateService.batchGetCurrentDataCids(queries);

      expect(
        mockEthersContractInstance.getCurrentFieldDataCID
      ).toHaveBeenCalledTimes(3);
      expect(results.size).toBe(3);
      expect(results.get('prop1/group1')).toBe(expectedCid1);
      expect(results.get('prop2/group2')).toBe(expectedCid2);
      expect(results.get('prop3/group3')).toBeNull();
    });

    it('should handle errors in individual getCurrentDataCid calls gracefully', async () => {
      mockEthersContractInstance.getCurrentFieldDataCID
        .mockResolvedValueOnce(toUtf8Bytes(`.${expectedCid1}`))
        .mockRejectedValueOnce(new Error('Network error for prop2/group2'))
        .mockResolvedValueOnce(toUtf8Bytes(`.${expectedCid2}`));

      const results = await chainStateService.batchGetCurrentDataCids(queries);

      expect(results.size).toBe(3);
      expect(results.get('prop1/group1')).toBe(expectedCid1);
      expect(results.get('prop2/group2')).toBeNull();
      expect(results.get('prop3/group3')).toBe(expectedCid2);
    });
  });
});
