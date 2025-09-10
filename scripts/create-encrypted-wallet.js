#!/usr/bin/env node

/**
 * Utility script to create an encrypted JSON keystore wallet
 * Usage: node create-encrypted-wallet.js
 */

import { Wallet } from 'ethers';
import { writeFileSync } from 'fs';
import { createInterface } from 'readline';
import { promisify } from 'util';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
});

const question = promisify(rl.question).bind(rl);

// Hide password input
function askPassword(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    const stdout = process.stdout;

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let password = '';
    
    stdin.on('data', (char) => {
      const key = char.toString();
      
      if (key === '\n' || key === '\r' || key === '\u0004') {
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\n');
        resolve(password);
      } else if (key === '\u0003') {
        // Handle Ctrl+C
        process.exit();
      } else if (key === '\u007F' || key === '\b') {
        // Handle backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += key;
        stdout.write('*');
      }
    });
  });
}

async function main() {
  console.log('🔐 Encrypted Wallet Creator for Elephant CLI\n');
  
  try {
    // Ask for input method
    const method = await question(
      'Choose an option:\n' +
      '1. Create a new random wallet\n' +
      '2. Encrypt an existing private key\n' +
      'Enter choice (1 or 2): '
    );
    
    let wallet;
    
    if (method === '1') {
      // Create new random wallet
      wallet = Wallet.createRandom();
      console.log('\n✅ New wallet created!');
      console.log(`Address: ${wallet.address}`);
      console.log(`\n⚠️  IMPORTANT: Save this private key securely!`);
      console.log(`Private Key: ${wallet.privateKey}\n`);
    } else if (method === '2') {
      // Use existing private key
      const privateKey = await question('\nEnter your private key (with or without 0x prefix): ');
      
      try {
        wallet = new Wallet(privateKey.trim());
        console.log(`\n✅ Wallet loaded!`);
        console.log(`Address: ${wallet.address}`);
      } catch (error) {
        console.error('❌ Invalid private key:', error.message);
        process.exit(1);
      }
    } else {
      console.error('❌ Invalid choice. Please enter 1 or 2.');
      process.exit(1);
    }
    
    // Ask for encryption password
    console.log('\nNow let\'s encrypt your wallet with a password.');
    console.log('⚠️  Choose a strong password and remember it - you\'ll need it to use the wallet!\n');
    
    const password = await askPassword('Enter encryption password: ');
    const confirmPassword = await askPassword('Confirm encryption password: ');
    
    if (password !== confirmPassword) {
      console.error('\n❌ Passwords do not match!');
      process.exit(1);
    }
    
    if (password.length < 8) {
      console.error('\n❌ Password must be at least 8 characters long!');
      process.exit(1);
    }
    
    // Ask for output filename
    const filename = await question('\nEnter output filename (default: keystore.json): ');
    const outputFile = filename.trim() || 'keystore.json';
    
    // Encrypt the wallet
    console.log('\n🔄 Encrypting wallet... (this may take a few seconds)');
    
    const encryptedJson = await wallet.encrypt(password, {
      scrypt: {
        N: 131072,
        r: 8,
        p: 1
      }
    });
    
    // Save to file
    writeFileSync(outputFile, encryptedJson);
    
    console.log(`\n✅ Encrypted wallet saved to: ${outputFile}`);
    console.log('\n📝 Usage with Elephant CLI:');
    console.log(`   elephant-cli submit-to-contract results.csv \\`);
    console.log(`     --keystore-json ./${outputFile} \\`);
    console.log(`     --keystore-password "YourPassword"`);
    console.log('\nOr set the password as an environment variable:');
    console.log(`   export ELEPHANT_KEYSTORE_PASSWORD="YourPassword"`);
    console.log(`   elephant-cli submit-to-contract results.csv --keystore-json ./${outputFile}`);
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    rl.close();
  }
}

main().catch(console.error);