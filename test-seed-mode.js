// Simple test to verify fact sheet relationships are not created in seed mode
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

console.log('Testing seed mode fact sheet relationship generation...');

// Create a temporary test directory
const testDir = '/tmp/elephant-seed-test';
if (fs.existsSync(testDir)) {
  fs.rmSync(testDir, { recursive: true });
}
fs.mkdirSync(testDir, { recursive: true });

// Create a simple seed.csv file
const seedCsv = `parcel_id,address,method,url,multiValueQueryString,county,source_identifier
12345,"Test Address",GET,https://example.com,{},Test County,12345`;

// Create input directory structure
const inputDir = path.join(testDir, 'input');
fs.mkdirSync(inputDir, { recursive: true });
fs.writeFileSync(path.join(inputDir, 'seed.csv'), seedCsv);

// Create a simple input zip
const zip = new AdmZip();
zip.addFile('input/seed.csv', Buffer.from(seedCsv, 'utf8'));
zip.writeZip(path.join(testDir, 'input.zip'));

console.log('Created test input zip');

try {
  // Run the transform command in seed mode (no scripts zip)
  console.log('Running transform command in seed mode...');
  const result = execSync(`./bin/elephant-cli transform --input-zip ${path.join(testDir, 'input.zip')} --output-zip ${path.join(testDir, 'output.zip')}`, {
    cwd: process.cwd(),
    encoding: 'utf8'
  });
  
  console.log('Transform completed successfully');
  
  // Check if the output zip was created
  if (fs.existsSync(path.join(testDir, 'output.zip'))) {
    console.log('✅ Output zip created');
    
    // Extract and check contents
    const outputZip = new AdmZip(path.join(testDir, 'output.zip'));
    const entries = outputZip.getEntries();
    
    console.log('Files in output zip:');
    entries.forEach(entry => {
      console.log(`  - ${entry.entryName}`);
    });
    
    // Check if fact sheet relationship files were created
    const factSheetFiles = entries.filter(entry => 
      entry.entryName.includes('relationship_') && 
      entry.entryName.includes('fact_sheet')
    );
    
    if (factSheetFiles.length === 0) {
      console.log('✅ No fact sheet relationship files created (as expected for seed mode)');
    } else {
      console.log('❌ Fact sheet relationship files were created (unexpected for seed mode):');
      factSheetFiles.forEach(file => console.log(`  - ${file.entryName}`));
    }
    
  } else {
    console.log('❌ Output zip was not created');
  }
  
} catch (error) {
  console.error('❌ Transform command failed:', error.message);
  console.error('Output:', error.stdout);
  console.error('Error:', error.stderr);
}

// Check zip contents before cleanup
console.log('Checking zip contents:');
try {
  const checkZip = new AdmZip(path.join(testDir, 'input.zip'));
  const entries = checkZip.getEntries();
  console.log('Files in input zip:');
  entries.forEach(entry => {
    console.log(`  - ${entry.entryName}`);
  });
} catch (error) {
  console.log('Error checking zip:', error.message);
}

// Cleanup
fs.rmSync(testDir, { recursive: true });
console.log('Test completed and cleaned up');
