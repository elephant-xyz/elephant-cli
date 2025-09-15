import { readFileSync } from 'fs';
import {
  Wallet,
  isKeystoreJson,
  decryptKeystoreJson,
  decryptKeystoreJsonSync,
} from 'ethers';
import { logger } from '../utils/logger.js';

export interface EncryptedWalletOptions {
  keystoreJsonPath: string;
  password: string;
}

export class EncryptedWalletService {
  private static readAndValidateKeystoreFile(keystoreJsonPath: string): string {
    logger.technical(`Loading encrypted wallet from: ${keystoreJsonPath}`);

    let jsonContent: string;
    try {
      jsonContent = readFileSync(keystoreJsonPath, 'utf-8');
    } catch (error) {
      const errorMsg = `Failed to read keystore JSON file: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    if (!isKeystoreJson(jsonContent)) {
      const errorMsg = 'Invalid keystore JSON format';
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }

    return jsonContent;
  }

  static async loadWalletFromEncryptedJson(
    options: EncryptedWalletOptions
  ): Promise<Wallet> {
    const jsonContent = this.readAndValidateKeystoreFile(
      options.keystoreJsonPath
    );

    try {
      const account = await decryptKeystoreJson(jsonContent, options.password);
      logger.success('Successfully decrypted wallet from keystore JSON');
      return new Wallet(account.privateKey);
    } catch (error) {
      const errorMsg = `Failed to decrypt keystore JSON: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  static loadWalletFromEncryptedJsonSync(
    options: EncryptedWalletOptions
  ): Wallet {
    const jsonContent = this.readAndValidateKeystoreFile(
      options.keystoreJsonPath
    );

    try {
      const account = decryptKeystoreJsonSync(jsonContent, options.password);
      logger.success('Successfully decrypted wallet from keystore JSON');
      return new Wallet(account.privateKey);
    } catch (error) {
      const errorMsg = `Failed to decrypt keystore JSON: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  static validateKeystoreJson(jsonContent: string): boolean {
    return isKeystoreJson(jsonContent);
  }
}
