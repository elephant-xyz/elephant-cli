import { describe, it, expect, beforeEach } from 'vitest';
import { CidCalculatorService } from '../../../src/services/cid-calculator.service.js';
import { CID } from 'multiformats/cid';

describe('CID DAG-JSON codec support', () => {
  let cidCalculatorService: CidCalculatorService;

  beforeEach(() => {
    cidCalculatorService = new CidCalculatorService();
  });

  it('should use DAG-JSON codec for data with IPLD links', async () => {
    const dataWithLinks = {
      title: 'Document with links',
      metadata: {
        '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
      },
    };

    const cid =
      await cidCalculatorService.calculateCidAutoFormat(dataWithLinks);
    const parsedCid = CID.parse(cid);

    // Should be CID v1
    expect(parsedCid.version).toBe(1);

    // Should use DAG-JSON codec (0x0129)
    expect(parsedCid.code).toBe(0x0129);

    // Should use base32 encoding (can start with different prefixes)
    expect(cid.length).toBeGreaterThan(40); // Base32 CIDs are longer than base58
  });

  it('should use DAG-PB codec for regular data without links', async () => {
    const regularData = {
      title: 'Regular document',
      content: 'Some content without IPLD links',
    };

    const cid = await cidCalculatorService.calculateCidAutoFormat(regularData);
    const parsedCid = CID.parse(cid);

    // Should be CID v1
    expect(parsedCid.version).toBe(1);

    // Should use DAG-PB codec (0x70) for UnixFS
    expect(parsedCid.code).toBe(0x70);

    // Should use base32 encoding (can start with different prefixes)
    expect(cid.length).toBeGreaterThan(40); // Base32 CIDs are longer than base58
  });

  it('should calculate different CIDs for same content with different codecs', async () => {
    const testData = { test: 'data' };

    // Calculate with UnixFS format
    const buffer = Buffer.from(JSON.stringify(testData));
    const unixfsCid = await cidCalculatorService.calculateCidV1(buffer);

    // Calculate with DAG-JSON format
    const dagJsonCid =
      await cidCalculatorService.calculateCidV1ForDagJson(testData);

    // They should be different due to different encoding
    expect(unixfsCid).not.toBe(dagJsonCid);

    // But both should be valid CID v1
    const parsedUnixfs = CID.parse(unixfsCid);
    const parsedDagJson = CID.parse(dagJsonCid);

    expect(parsedUnixfs.version).toBe(1);
    expect(parsedDagJson.version).toBe(1);

    // Different codecs
    expect(parsedUnixfs.code).toBe(0x70); // DAG-PB
    expect(parsedDagJson.code).toBe(0x0129); // DAG-JSON
  });

  it('should detect nested IPLD links', async () => {
    const nestedData = {
      level1: {
        level2: {
          link: {
            '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
          },
        },
      },
    };

    expect(cidCalculatorService.hasIPLDLinks(nestedData)).toBe(true);

    const cid = await cidCalculatorService.calculateCidAutoFormat(nestedData);
    const parsedCid = CID.parse(cid);

    // Should use DAG-JSON codec for data with nested links
    expect(parsedCid.code).toBe(0x0129);
  });

  it('should handle arrays with IPLD links', async () => {
    const arrayData = {
      items: [
        { name: 'Item 1' },
        { '/': 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' },
        { name: 'Item 3' },
      ],
    };

    expect(cidCalculatorService.hasIPLDLinks(arrayData)).toBe(true);

    const cid = await cidCalculatorService.calculateCidAutoFormat(arrayData);
    const parsedCid = CID.parse(cid);

    // Should use DAG-JSON codec
    expect(parsedCid.code).toBe(0x0129);
  });
});
