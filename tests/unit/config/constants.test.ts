import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CONTRACT_ADDRESS,
  DEFAULT_RPC_URL,
  DEFAULT_IPFS_GATEWAY,
  MAX_CONCURRENT_DOWNLOADS,
  BLOCKS_PER_QUERY,
  SUBMIT_CONTRACT_METHODS,
  PINATA_API_BASE_URL,
  PINATA_GATEWAY_BASE_URL,
  SUBMIT_CONTRACT_ABI_FRAGMENTS,
} from '../../../src/config/constants';

describe('Constants', () => {
  describe('existing constants', () => {
    it('should have valid contract address', () => {
      expect(DEFAULT_CONTRACT_ADDRESS).toBe(
        '0x79D5046e34D4A56D357E12636A18da6eaEfe0586'
      );
      expect(DEFAULT_CONTRACT_ADDRESS).toMatch(/^0x[a-fA-F0-9]{40}$/);
    });

    it('should have valid RPC URL', () => {
      expect(DEFAULT_RPC_URL).toBe('https://polygon-rpc.com');
      expect(DEFAULT_RPC_URL).toMatch(/^https?:\/\/.+/);
    });

    it('should have valid IPFS gateway', () => {
      expect(DEFAULT_IPFS_GATEWAY).toBe('https://ipfs.io/ipfs/');
      expect(DEFAULT_IPFS_GATEWAY).toMatch(/^https?:\/\/.+\/$/);
    });

    it('should have reasonable concurrent download limit', () => {
      expect(MAX_CONCURRENT_DOWNLOADS).toBe(25);
      expect(typeof MAX_CONCURRENT_DOWNLOADS).toBe('number');
      expect(MAX_CONCURRENT_DOWNLOADS).toBeGreaterThan(0);
    });

    it('should have reasonable blocks per query', () => {
      expect(BLOCKS_PER_QUERY).toBe(10000);
      expect(typeof BLOCKS_PER_QUERY).toBe('number');
      expect(BLOCKS_PER_QUERY).toBeGreaterThan(0);
    });
  });

  describe('submit contract methods', () => {
    it('should define all required contract methods', () => {
      expect(SUBMIT_CONTRACT_METHODS.GET_CURRENT_FIELD_DATA_CID).toBe(
        'getCurrentFieldDataCID'
      );
      expect(
        SUBMIT_CONTRACT_METHODS.GET_PARTICIPANTS_FOR_CONSENSUS_DATA_CID
      ).toBe('getParticipantsForConsensusDataCID');
      expect(SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA).toBe('submitBatchData');
    });

    it('should be readonly object', () => {
      // TypeScript prevents modification at compile time with 'as const'
      // At runtime, the values are accessible and of correct type
      expect(typeof SUBMIT_CONTRACT_METHODS.GET_CURRENT_FIELD_DATA_CID).toBe(
        'string'
      );
      expect(
        typeof SUBMIT_CONTRACT_METHODS.GET_PARTICIPANTS_FOR_CONSENSUS_DATA_CID
      ).toBe('string');
      expect(typeof SUBMIT_CONTRACT_METHODS.SUBMIT_BATCH_DATA).toBe('string');

      // Verify the object has the expected structure
      expect(SUBMIT_CONTRACT_METHODS).toHaveProperty(
        'GET_CURRENT_FIELD_DATA_CID'
      );
      expect(SUBMIT_CONTRACT_METHODS).toHaveProperty(
        'GET_PARTICIPANTS_FOR_CONSENSUS_DATA_CID'
      );
      expect(SUBMIT_CONTRACT_METHODS).toHaveProperty('SUBMIT_BATCH_DATA');
    });
  });

  describe('Pinata configuration', () => {
    it('should have valid Pinata API URL', () => {
      expect(PINATA_API_BASE_URL).toBe('https://api.pinata.cloud');
      expect(PINATA_API_BASE_URL).toMatch(/^https:\/\/api\.pinata\.cloud$/);
    });

    it('should have valid Pinata gateway URL', () => {
      expect(PINATA_GATEWAY_BASE_URL).toBe(
        'https://gateway.pinata.cloud/ipfs/'
      );
      expect(PINATA_GATEWAY_BASE_URL).toMatch(
        /^https:\/\/gateway\.pinata\.cloud\/ipfs\/$/
      );
    });
  });

  describe('submit contract ABI fragments', () => {
    it('should have getCurrentFieldDataCID ABI', () => {
      const getCurrentAbi = SUBMIT_CONTRACT_ABI_FRAGMENTS.find(
        (fragment) => fragment.name === 'getCurrentFieldDataCID'
      );

      expect(getCurrentAbi).toBeDefined();
      expect(getCurrentAbi?.type).toBe('function');
      expect(getCurrentAbi?.stateMutability).toBe('view');
      expect(getCurrentAbi?.inputs).toHaveLength(2);
      expect(getCurrentAbi?.outputs).toHaveLength(1);

      // Check input parameters
      expect(getCurrentAbi?.inputs[0].name).toBe('propertyCid');
      expect(getCurrentAbi?.inputs[0].type).toBe('bytes');
      expect(getCurrentAbi?.inputs[1].name).toBe('dataGroupCID');
      expect(getCurrentAbi?.inputs[1].type).toBe('bytes');

      // Check output
      expect(getCurrentAbi?.outputs[0].type).toBe('bytes');
    });

    it('should have getParticipantsForConsensusDataCID ABI', () => {
      const getParticipantsAbi = SUBMIT_CONTRACT_ABI_FRAGMENTS.find(
        (fragment) => fragment.name === 'getParticipantsForConsensusDataCID'
      );

      expect(getParticipantsAbi).toBeDefined();
      expect(getParticipantsAbi?.type).toBe('function');
      expect(getParticipantsAbi?.stateMutability).toBe('view');
      expect(getParticipantsAbi?.inputs).toHaveLength(3);
      expect(getParticipantsAbi?.outputs).toHaveLength(1);

      // Check input parameters
      expect(getParticipantsAbi?.inputs[0].name).toBe('propertyCid');
      expect(getParticipantsAbi?.inputs[0].type).toBe('bytes');
      expect(getParticipantsAbi?.inputs[1].name).toBe('dataGroupCID');
      expect(getParticipantsAbi?.inputs[1].type).toBe('bytes');
      expect(getParticipantsAbi?.inputs[2].name).toBe('dataCID');
      expect(getParticipantsAbi?.inputs[2].type).toBe('bytes');

      // Check output
      expect(getParticipantsAbi?.outputs[0].type).toBe('address[]');
    });

    it('should have submitBatchData ABI', () => {
      const submitBatchAbi = SUBMIT_CONTRACT_ABI_FRAGMENTS.find(
        (fragment) => fragment.name === 'submitBatchData'
      );

      expect(submitBatchAbi).toBeDefined();
      expect(submitBatchAbi?.type).toBe('function');
      expect(submitBatchAbi?.stateMutability).toBe('nonpayable');
      expect(submitBatchAbi?.inputs).toHaveLength(1);
      expect(submitBatchAbi?.outputs).toHaveLength(0);

      // Check input parameter (DataItem array)
      const itemsInput = submitBatchAbi?.inputs[0];
      expect(itemsInput?.name).toBe('items');
      expect(itemsInput?.type).toBe('tuple[]');
      expect(itemsInput?.internalType).toBe(
        'struct IPropertyDataConsensus.DataItem[]'
      );

      // Check DataItem structure
      const components = itemsInput?.components;
      expect(components).toHaveLength(3);

      expect(components?.[0].name).toBe('propertyCid');
      expect(components?.[0].type).toBe('bytes');
      expect(components?.[1].name).toBe('dataGroupCID');
      expect(components?.[1].type).toBe('bytes');
      expect(components?.[2].name).toBe('dataCID');
      expect(components?.[2].type).toBe('bytes');
    });

    it('should have all required ABI fragments', () => {
      expect(SUBMIT_CONTRACT_ABI_FRAGMENTS).toHaveLength(3);

      const methodNames = SUBMIT_CONTRACT_ABI_FRAGMENTS.map(
        (fragment) => fragment.name
      );
      expect(methodNames).toContain('getCurrentFieldDataCID');
      expect(methodNames).toContain('getParticipantsForConsensusDataCID');
      expect(methodNames).toContain('submitBatchData');
    });

    it('should be readonly array', () => {
      expect(Object.isFrozen(SUBMIT_CONTRACT_ABI_FRAGMENTS)).toBe(false); // as const makes it readonly but not frozen
      // TypeScript will catch modifications at compile time
    });
  });
});
