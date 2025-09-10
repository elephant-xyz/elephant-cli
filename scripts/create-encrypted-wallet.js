#!/usr/bin/env node

/**
 * Utility script to encrypt an existing private key into a JSON keystore wallet
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
    
    const onData = (char) => {
      const key = char.toString();
      
      if (key === '\n' || key === '\r' || key === '\u0004') {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        stdout.write('\n');
        // Don't pause stdin here - let readline handle it
        resolve(password);
      } else if (key === '\u0003') {
        // Handle Ctrl+C
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        process.exit();
      } else if (key === '\u007F' || key === '\b') {
        // Handle backspace
        if (password.length > 0) {
          password = password.slice(0, -1);
          stdout.write('\b \b');
        }
      } else {
        password += key;
      }
    };
    
    stdin.on('data', onData);
  });
}

async function main() {
  console.log('🔐 Encrypted Wallet Creator for Elephant CLI\n');
  console.log('This tool will encrypt your existing private key into a secure JSON keystore file.\n');
  
  try {
    // Get existing private key
    const privateKey = await question('Enter your private key (with or without 0x prefix): ');
    
    let wallet;
    try {
      wallet = new Wallet(privateKey.trim());
      console.log(`\n✅ Wallet loaded!`);
      console.log(`Address: ${wallet.address}`);
    } catch (error) {
      console.error('❌ Invalid private key:', error.message);
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
    
    // In ethers v6, the signature is: encrypt(password, progressCallback?)
    // The options are part of the underlying encryptKeystoreJson function
    let lastReportedPercent = 0;
    const progressCallback = (progress) => {
      // Progress goes from 0 to 1
      const percent = Math.round(progress * 100);
      // Only report at 25%, 50%, 75%, and 100%, and only once per milestone
      if (percent >= 25 && lastReportedPercent < 25) {
        console.log(`  25% complete...`);
        lastReportedPercent = 25;
      } else if (percent >= 50 && lastReportedPercent < 50) {
        console.log(`  50% complete...`);
        lastReportedPercent = 50;
      } else if (percent >= 75 && lastReportedPercent < 75) {
        console.log(`  75% complete...`);
        lastReportedPercent = 75;
      } else if (percent >= 100 && lastReportedPercent < 100) {
        console.log(`  100% complete...`);
        lastReportedPercent = 100;
      }
    };
    
    const encryptedJson = await wallet.encrypt(password, progressCallback);
    
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