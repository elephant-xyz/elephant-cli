import { describe, it, expect } from 'vitest';
import {
  DataItem,
  GetCurrentFieldDataCIDCall,
  GetParticipantsCall,
  BatchSubmissionResult,
} from '../../../src/types/contract.types';

describe('Contract Types', () => {
  describe('DataItem', () => {
    it('should have required smart contract struct properties', () => {
      const dataItem: DataItem = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCID: 'QmDataGroupCid456',
        dataCID: 'QmDataCid789',
      };

      expect(dataItem.propertyCid).toBe('QmPropertyCid123');
      expect(dataItem.dataGroupCID).toBe('QmDataGroupCid456');
      expect(dataItem.dataCID).toBe('QmDataCid789');
    });

    it('should be compatible with smart contract struct', () => {
      const dataItem: DataItem = {
        propertyCid: 'QmProperty',
        dataGroupCID: 'QmDataGroup',
        dataCID: 'QmData',
      };

      // Verify all required fields are present for smart contract interaction
      expect(typeof dataItem.propertyCid).toBe('string');
      expect(typeof dataItem.dataGroupCID).toBe('string');
      expect(typeof dataItem.dataCID).toBe('string');
    });
  });

  describe('GetCurrentFieldDataCIDCall', () => {
    it('should contain parameters for getCurrentFieldDataCID method', () => {
      const call: GetCurrentFieldDataCIDCall = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCID: 'QmDataGroupCid456',
      };

      expect(call.propertyCid).toBe('QmPropertyCid123');
      expect(call.dataGroupCID).toBe('QmDataGroupCid456');
    });
  });

  describe('GetParticipantsCall', () => {
    it('should contain parameters for getParticipantsForConsensusDataCID method', () => {
      const call: GetParticipantsCall = {
        propertyCid: 'QmPropertyCid123',
        dataGroupCID: 'QmDataGroupCid456',
        dataCID: 'QmDataCid789',
      };

      expect(call.propertyCid).toBe('QmPropertyCid123');
      expect(call.dataGroupCID).toBe('QmDataGroupCid456');
      expect(call.dataCID).toBe('QmDataCid789');
    });
  });

  describe('BatchSubmissionResult', () => {
    it('should contain transaction result details', () => {
      const result: BatchSubmissionResult = {
        transactionHash: '0x1234567890abcdef',
        blockNumber: 12345,
        gasUsed: '21000',
        itemsSubmitted: 200,
      };

      expect(result.transactionHash).toBe('0x1234567890abcdef');
      expect(result.blockNumber).toBe(12345);
      expect(result.gasUsed).toBe('21000');
      expect(result.itemsSubmitted).toBe(200);
    });

    it('should handle large item counts', () => {
      const result: BatchSubmissionResult = {
        transactionHash: '0xabcdef1234567890',
        blockNumber: 99999,
        gasUsed: '5000000',
        itemsSubmitted: 200,
      };

      expect(result.itemsSubmitted).toBe(200);
      expect(typeof result.gasUsed).toBe('string'); // Gas amounts can be very large
    });
  });
});
