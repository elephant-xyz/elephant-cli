import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EncryptedWalletService } from '../../../src/services/encrypted-wallet.service.js';
import * as ethersModule from 'ethers';
import * as fs from 'fs';

vi.mock('fs');
vi.mock('ethers', () => ({
  Wallet: vi.fn(),
  isKeystoreJson: vi.fn(),
  decryptKeystoreJson: vi.fn(),
  decryptKeystoreJsonSync: vi.fn(),
}));

describe('EncryptedWalletService', () => {
  const mockPrivateKey =
    '0xac0974bec39a17e36ba4a6b4d1977b37e8427ff0efc7717320f0a85129670207';
  const mockPassword = 'test-password-123!@#';
  const mockKeystoreJsonPath = '/path/to/keystore.json';
  const mockKeystoreJson = JSON.stringify({
    version: 3,
    id: '3d8e8fcc-5b62-4a3f-bb5b-f2e4b1234567',
    address: 'f39fd6e51aad88f6f4ce6ab8827279cfffb92266',
    crypto: {
      ciphertext:
        'encrypted-private-key-data-here-encrypted-private-key-data-here',
      cipherparams: { iv: '0123456789abcdef0123456789abcdef' },
      cipher: 'aes-128-ctr',
      kdf: 'scrypt',
      kdfparams: {
        dklen: 32,
        salt: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
        n: 131072,
        r: 8,
        p: 1,
      },
      mac: 'mac-hash-here-mac-hash-here-mac-hash-here-mac-hash-here-mac-hash',
    },
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.readFileSync).mockReturnValue(mockKeystoreJson);
    vi.mocked(ethersModule.isKeystoreJson).mockReturnValue(true);
  });

  describe('loadWalletFromEncryptedJson', () => {
    it('should successfully load and decrypt wallet from keystore', async () => {
      const mockAccount = {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        privateKey: mockPrivateKey,
      };
      vi.mocked(ethersModule.decryptKeystoreJson).mockResolvedValue(
        mockAccount
      );
      vi.mocked(ethersModule.Wallet).mockImplementation(
        (privateKey) =>
          ({
            privateKey,
            address: mockAccount.address,
          }) as any
      );

      const result = await EncryptedWalletService.loadWalletFromEncryptedJson({
        keystoreJsonPath: mockKeystoreJsonPath,
        password: mockPassword,
      });

      expect(fs.readFileSync).toHaveBeenCalledWith(
        mockKeystoreJsonPath,
        'utf-8'
      );
      expect(ethersModule.isKeystoreJson).toHaveBeenCalledWith(
        mockKeystoreJson
      );
      expect(ethersModule.decryptKeystoreJson).toHaveBeenCalledWith(
        mockKeystoreJson,
        mockPassword
      );
      expect(result.privateKey).toBe(mockPrivateKey);
    });

    it('should throw error when file cannot be read', async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      await expect(
        EncryptedWalletService.loadWalletFromEncryptedJson({
          keystoreJsonPath: mockKeystoreJsonPath,
          password: mockPassword,
        })
      ).rejects.toThrow('Failed to read keystore JSON file: File not found');
    });

    it('should throw error when keystore JSON is invalid', async () => {
      vi.mocked(ethersModule.isKeystoreJson).mockReturnValue(false);

      await expect(
        EncryptedWalletService.loadWalletFromEncryptedJson({
          keystoreJsonPath: mockKeystoreJsonPath,
          password: mockPassword,
        })
      ).rejects.toThrow('Invalid keystore JSON format');
    });

    it('should throw error when decryption fails', async () => {
      vi.mocked(ethersModule.decryptKeystoreJson).mockRejectedValue(
        new Error('Invalid password')
      );

      await expect(
        EncryptedWalletService.loadWalletFromEncryptedJson({
          keystoreJsonPath: mockKeystoreJsonPath,
          password: mockPassword,
        })
      ).rejects.toThrow('Failed to decrypt keystore JSON: Invalid password');
    });
  });

  describe('loadWalletFromEncryptedJsonSync', () => {
    it('should successfully load and decrypt wallet from keystore synchronously', () => {
      const mockAccount = {
        address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
        privateKey: mockPrivateKey,
      };
      vi.mocked(ethersModule.decryptKeystoreJsonSync).mockReturnValue(
        mockAccount
      );
      vi.mocked(ethersModule.Wallet).mockImplementation(
        (privateKey) =>
          ({
            privateKey,
            address: mockAccount.address,
          }) as any
      );

      const result = EncryptedWalletService.loadWalletFromEncryptedJsonSync({
        keystoreJsonPath: mockKeystoreJsonPath,
        password: mockPassword,
      });

      expect(fs.readFileSync).toHaveBeenCalledWith(
        mockKeystoreJsonPath,
        'utf-8'
      );
      expect(ethersModule.isKeystoreJson).toHaveBeenCalledWith(
        mockKeystoreJson
      );
      expect(ethersModule.decryptKeystoreJsonSync).toHaveBeenCalledWith(
        mockKeystoreJson,
        mockPassword
      );
      expect(result.privateKey).toBe(mockPrivateKey);
    });

    it('should throw error when file cannot be read', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error('File not found');
      });

      expect(() =>
        EncryptedWalletService.loadWalletFromEncryptedJsonSync({
          keystoreJsonPath: mockKeystoreJsonPath,
          password: mockPassword,
        })
      ).toThrow('Failed to read keystore JSON file: File not found');
    });

    it('should throw error when keystore JSON is invalid', () => {
      vi.mocked(ethersModule.isKeystoreJson).mockReturnValue(false);

      expect(() =>
        EncryptedWalletService.loadWalletFromEncryptedJsonSync({
          keystoreJsonPath: mockKeystoreJsonPath,
          password: mockPassword,
        })
      ).toThrow('Invalid keystore JSON format');
    });

    it('should throw error when decryption fails', () => {
      vi.mocked(ethersModule.decryptKeystoreJsonSync).mockImplementation(() => {
        throw new Error('Invalid password');
      });

      expect(() =>
        EncryptedWalletService.loadWalletFromEncryptedJsonSync({
          keystoreJsonPath: mockKeystoreJsonPath,
          password: mockPassword,
        })
      ).toThrow('Failed to decrypt keystore JSON: Invalid password');
    });

    it('should handle errors that are not Error instances', () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw 'String error';
      });

      expect(() =>
        EncryptedWalletService.loadWalletFromEncryptedJsonSync({
          keystoreJsonPath: mockKeystoreJsonPath,
          password: mockPassword,
        })
      ).toThrow('Failed to read keystore JSON file: String error');
    });

    it('should handle non-Error decryption failures', () => {
      vi.mocked(ethersModule.decryptKeystoreJsonSync).mockImplementation(() => {
        throw 'Decryption error';
      });

      expect(() =>
        EncryptedWalletService.loadWalletFromEncryptedJsonSync({
          keystoreJsonPath: mockKeystoreJsonPath,
          password: mockPassword,
        })
      ).toThrow('Failed to decrypt keystore JSON: Decryption error');
    });
  });

  describe('validateKeystoreJson', () => {
    it('should return true for valid keystore JSON', () => {
      vi.mocked(ethersModule.isKeystoreJson).mockReturnValue(true);

      const result =
        EncryptedWalletService.validateKeystoreJson(mockKeystoreJson);

      expect(result).toBe(true);
      expect(ethersModule.isKeystoreJson).toHaveBeenCalledWith(
        mockKeystoreJson
      );
    });

    it('should return false for invalid keystore JSON', () => {
      const invalidJson = JSON.stringify({ invalid: 'format' });
      vi.mocked(ethersModule.isKeystoreJson).mockReturnValue(false);

      const result = EncryptedWalletService.validateKeystoreJson(invalidJson);

      expect(result).toBe(false);
      expect(ethersModule.isKeystoreJson).toHaveBeenCalledWith(invalidJson);
    });

    it('should return false for malformed JSON', () => {
      const malformedJson = 'not a json';
      vi.mocked(ethersModule.isKeystoreJson).mockReturnValue(false);

      const result = EncryptedWalletService.validateKeystoreJson(malformedJson);

      expect(result).toBe(false);
    });
  });
});
