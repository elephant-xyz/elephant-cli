import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { hexToCidHandler } from '../../../src/commands/hex-to-cid.js';

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

describe('hex-to-cid command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should convert hex to CID and display result', async () => {
    const hexHash =
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const options = { quiet: false };

    await hexToCidHandler(hexHash, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('CID:'),
      'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should output only CID in quiet mode', async () => {
    const hexHash =
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const options = { quiet: true };

    await hexToCidHandler(hexHash, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
    );
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should validate hex when validate option is true', async () => {
    const hexHash =
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const options = { validate: true, quiet: false };

    await hexToCidHandler(hexHash, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('✓ Valid hex format')
    );
    expect(mockConsoleLog).toHaveBeenCalledWith(
      expect.stringContaining('CID:'),
      'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
    );
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should not show validation message in quiet mode', async () => {
    const hexHash =
      '0xb94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const options = { validate: true, quiet: true };

    await hexToCidHandler(hexHash, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
    );
    expect(mockConsoleLog).toHaveBeenCalledTimes(1);
    expect(mockExit).not.toHaveBeenCalled();
  });

  it('should exit with error for invalid hex when validation is enabled', async () => {
    const invalidHex = '0x1234';
    const options = { validate: true };

    await expect(hexToCidHandler(invalidHex, options)).rejects.toThrow(
      'Process exited with code 1'
    );

    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        '✗ Invalid hex format: Invalid hex string format or incorrect length (expected 32 bytes)'
      )
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should exit with error for invalid hex without validation flag', async () => {
    const invalidHex = '0x1234';
    const options = {};

    await expect(hexToCidHandler(invalidHex, options)).rejects.toThrow(
      'Process exited with code 1'
    );

    // Now both cases show the same consistent error message
    expect(mockConsoleError).toHaveBeenCalledWith(
      expect.stringContaining(
        '✗ Invalid hex format: Invalid hex string format or incorrect length (expected 32 bytes)'
      )
    );
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should handle hex without 0x prefix', async () => {
    const hexHash =
      'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9';
    const options = { quiet: true };

    await hexToCidHandler(hexHash, options);

    expect(mockConsoleLog).toHaveBeenCalledWith(
      'bafkreifzjut3te2nhyekklss27nh3k72ysco7y32koao5eei66wof36n5e'
    );
    expect(mockExit).not.toHaveBeenCalled();
  });
});
