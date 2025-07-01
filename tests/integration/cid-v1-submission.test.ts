import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { CID } from 'multiformats/cid';
import { sha256 } from 'multiformats/hashes/sha2';
import {
  extractHashFromCID,
  deriveCIDFromHash,
} from '../../src/utils/validation.js';
import { CidCalculatorService } from '../../src/services/cid-calculator.service.js';

describe('CID v1 submission flow', () => {
  let cidCalculatorService: CidCalculatorService;

  beforeEach(() => {
    cidCalculatorService = new CidCalculatorService();
  });

  it('should correctly handle CID v1 throughout the submission flow', async () => {
    // Sample data
    const testData = { test: 'data', value: 123 };
    const jsonString = JSON.stringify(testData);
    const buffer = Buffer.from(jsonString, 'utf-8');

    // Calculate CID v1
    const cidV1 = await cidCalculatorService.calculateCidV1(buffer);

    // Verify it's a valid CID v1
    const parsedCid = CID.parse(cidV1);
    expect(parsedCid.version).toBe(1);
    expect(parsedCid.multihash.code).toBe(sha256.code); // Should use SHA-256

    // Extract hash from CID v1
    const extractedHash = extractHashFromCID(cidV1);
    expect(extractedHash).toMatch(/^0x[a-f0-9]{64}$/); // Should be a valid hex hash with 0x prefix

    // Verify the extracted hash is correct
    const hashBytes = parsedCid.multihash.digest;
    const expectedHash =
      '0x' +
      Array.from(hashBytes)
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('');
    expect(extractedHash).toBe(expectedHash);

    // Test round-trip conversion
    const derivedCid = deriveCIDFromHash(extractedHash);
    const derivedParsedCid = CID.parse(derivedCid);
    expect(derivedParsedCid.version).toBe(1); // Should create CID v1
    expect(derivedParsedCid.multihash.digest).toEqual(
      parsedCid.multihash.digest
    );
  });

  it('should extract the same hash from CID v0 and v1 with the same content', async () => {
    // Create a CID v0
    const testData = Buffer.from('test data');
    const cidV0 = await cidCalculatorService.calculateCidV0(testData);
    const cidV1 = await cidCalculatorService.calculateCidV1(testData);

    // Parse both CIDs
    const parsedV0 = CID.parse(cidV0);
    const parsedV1 = CID.parse(cidV1);

    // Both should have the same underlying hash since they represent the same content
    expect(parsedV0.multihash.digest).toEqual(parsedV1.multihash.digest);

    // Extract hashes using our utility function
    const hashV0 = extractHashFromCID(cidV0);
    const hashV1 = extractHashFromCID(cidV1);

    // Both should extract to the same hash
    expect(hashV0).toBe(hashV1);
  });

  it('should handle CID v1 in data submission format', () => {
    // Simulate the DataItem structure used in smart contract submission
    const dataItem = {
      propertyCid:
        'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      dataGroupCID:
        'bafybeihdwdcefgh4dqkjv67uzcmw7ojee6xedzdetojuzjevtenxquvyku',
      dataCID: 'bafybeigvgzoolc3drupxhlevdp2ugqcrbcsqfmcek2zxiw5wctk3xjpjwy',
    };

    // Extract hashes for contract submission
    const propertyHash = extractHashFromCID(dataItem.propertyCid);
    const dataGroupHash = extractHashFromCID(dataItem.dataGroupCID);
    const dataHash = extractHashFromCID(dataItem.dataCID);

    // All should be valid hex hashes
    expect(propertyHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(dataGroupHash).toMatch(/^0x[a-f0-9]{64}$/);
    expect(dataHash).toMatch(/^0x[a-f0-9]{64}$/);
  });
});
