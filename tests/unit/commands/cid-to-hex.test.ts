import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cidToHexHandler } from '../../../src/commands/cid-to-hex.js';

// Mock console methods
const mockConsoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
const mockConsoleError = vi
  .spyOn(console, 'error')
  .mockImplementation(() => {});

// Mock process.exit
const mockExit = vi
  .spyOn(process, 'exit')
  .mockImplementation((code?: number) => {
    throw new Error(`Process exited with code ${code}`);
  });

describe('cid-to-hex command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should convert CID to hex and display result', async () => {
    const cid = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';
    const options = { quiet: false };

    await cidToHexHandler(cid, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Hex:'),
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should output only hex in quiet mode', async () => {
    const cid = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';
    const options = { quiet: true };

    await cidToHexHandler(cid, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should validate CID when validate option is true', async () => {
    const cid = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';
    const options = { validate: true, quiet: false };

    await cidToHexHandler(cid, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('✓ Valid CID format')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('Hex:'),
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should not show validation message in quiet mode', async () => {
    const cid = 'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e';
    const options = { validate: true, quiet: true };

    await cidToHexHandler(cid, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'
    );
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should exit with error for CID v0 when validation is enabled', async () => {
    const cidV0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
    const options = { validate: true };

    await expect(cidToHexHandler(cidV0, options)).rejects.toThrow(
      'Process exited with code 1'
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        '✗ Invalid CID format: Expected CID v1, got CID v0'
      )
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with error for wrong codec when validation is enabled', async () => {
    const cidDagPb =
      'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    const options = { validate: true };

    await expect(cidToHexHandler(cidDagPb, options)).rejects.toThrow(
      'Process exited with code 1'
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        '✗ Invalid CID format: Expected raw codec (0x55), got codec 0x70'
      )
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with error for invalid CID without validation flag', async () => {
    const invalidCid = 'invalid-cid';
    const options = {};

    await expect(cidToHexHandler(invalidCid, options)).rejects.toThrow(
      'Process exited with code 1'
    );

    // Now shows consistent error message
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining('✗ Invalid CID format:')
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with error for empty string', async () => {
    const emptyCid = '';
    const options = {};

    await expect(cidToHexHandler(emptyCid, options)).rejects.toThrow(
      'Process exited with code 1'
    );

    // Now shows consistent error message
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        '✗ Invalid CID format: CID must be a non-empty string'
      )
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });
});
