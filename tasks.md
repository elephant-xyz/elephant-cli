# Elephant CLI Transformation - Granular Task Plan

## Phase 1: Rename Oracle to Elephant

### 1.1 Update Package Configuration

- [ ] Update package.json name from "@oracle-network/cli" to "@elephant/cli"
- [ ] Update package.json description to "CLI tool for Elephant Network on Polygon"
- [ ] Update package.json bin entry from "oracle-cli" to "elephant-cli"
- [ ] Update package.json keywords, replace "oracle" with "elephant"

### 1.2 Rename Binary File

- [ ] Rename bin/oracle-cli to bin/elephant-cli
- [ ] Update shebang and path references inside bin/elephant-cli

### 1.3 Update TypeScript Source Files

- [ ] Update src/index.ts - replace "oracle-cli" command name with "elephant-cli"
- [ ] Update src/index.ts - replace "Oracle Network CLI" with "Elephant Network CLI"
- [ ] Update src/commands/list-assignments.ts - replace all "oracle" references with "elephant"
- [ ] Update src/types/index.ts - rename OracleAssignment to OracleAssignment
- [ ] Update src/types/index.ts - rename OracleAssignedEvent to OracleAssignedEvent
- [ ] Update src/services/blockchain.service.ts - update event name references
- [ ] Update src/services/event-decoder.service.ts - update function names and comments
- [ ] Update src/config/abi.ts - rename ORACLE_ASSIGNED_ABI to ELEPHANT_ASSIGNED_ABI

### 1.4 Update Documentation

- [ ] Update README.md - replace all "Oracle" references with "Elephant"
- [ ] Update CLAUDE.md - replace all "Oracle" references with "Elephant"
- [ ] Update CONTRIBUTING.md - replace all "Oracle" references with "Elephant"
- [ ] Update architecture.md - replace all "Oracle" references with "Elephant"

### 1.5 Rebuild and Verify

- [ ] Run npm run build to verify TypeScript compilation
- [ ] Test the renamed CLI executable works

## Phase 2: Add Linting and Formatting

### 2.1 Install ESLint

- [ ] Install eslint and typescript-eslint packages as devDependencies
- [ ] Install @typescript-eslint/parser as devDependency
- [ ] Install @typescript-eslint/eslint-plugin as devDependency

### 2.2 Configure ESLint

- [ ] Create .eslintrc.json with TypeScript configuration
- [ ] Add extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"]
- [ ] Add parser: "@typescript-eslint/parser"
- [ ] Add parserOptions with ecmaVersion and sourceType
- [ ] Add rules for no-unused-vars, no-explicit-any, etc.

### 2.3 Install Prettier

- [ ] Install prettier as devDependency
- [ ] Install eslint-config-prettier as devDependency
- [ ] Install eslint-plugin-prettier as devDependency

### 2.4 Configure Prettier

- [ ] Create .prettierrc.json with standard settings
- [ ] Add semi: true
- [ ] Add singleQuote: true
- [ ] Add tabWidth: 2
- [ ] Add trailingComma: "es5"

### 2.5 Update ESLint for Prettier

- [ ] Add "plugin:prettier/recommended" to eslintrc extends
- [ ] Add prettier/prettier error rule

### 2.6 Add Lint Scripts

- [ ] Add "lint" script to package.json: "eslint src --ext .ts"
- [ ] Add "lint:fix" script: "eslint src --ext .ts --fix"
- [ ] Add "format" script: "prettier --write src/\*_/_.ts"
- [ ] Add "format:check" script: "prettier --check src/\*_/_.ts"

### 2.7 Fix Initial Linting Issues

- [ ] Run npm run lint and fix any errors
- [ ] Run npm run format to format all files

## Phase 3: Add Unit Tests

### 3.1 Install Jest

- [ ] Install jest as devDependency
- [ ] Install @types/jest as devDependency
- [ ] Install ts-jest as devDependency
- [ ] Install @jest/globals as devDependency

### 3.2 Configure Jest

- [ ] Create jest.config.js with TypeScript preset
- [ ] Set testEnvironment: "node"
- [ ] Set roots: ["<rootDir>/src", "<rootDir>/tests"]
- [ ] Set testMatch for .test.ts and .spec.ts files
- [ ] Set collectCoverageFrom for src/\*_/_.ts
- [ ] Set coverageDirectory: "coverage"
- [ ] Set coverageThreshold with 80% targets

### 3.3 Add Test Scripts

- [ ] Add "test" script to package.json: "jest"
- [ ] Add "test:watch" script: "jest --watch"
- [ ] Add "test:coverage" script: "jest --coverage"

### 3.4 Create Test Structure

- [ ] Create tests/unit/services/blockchain.service.test.ts
- [ ] Create tests/unit/services/event-decoder.service.test.ts
- [ ] Create tests/unit/services/ipfs.service.test.ts
- [ ] Create tests/unit/utils/logger.test.ts
- [ ] Create tests/unit/utils/validation.test.ts
- [ ] Create tests/unit/utils/progress.test.ts

### 3.5 Write Validation Utils Tests

- [ ] Test isValidAddress with valid addresses
- [ ] Test isValidAddress with invalid addresses
- [ ] Test isValidUrl with valid URLs
- [ ] Test isValidUrl with invalid URLs
- [ ] Test isValidBlockNumber with valid numbers
- [ ] Test isValidBlockNumber with invalid inputs

### 3.6 Write Logger Utils Tests

- [ ] Test logSuccess output
- [ ] Test logError output
- [ ] Test logInfo output
- [ ] Test logWarning output

### 3.7 Write Event Decoder Service Tests

- [ ] Test decodeCidFromEventData with normal CID
- [ ] Test decodeCidFromEventData with dot-prefixed CID
- [ ] Test decodeCidFromEventData with invalid data
- [ ] Test error handling scenarios

### 3.8 Write Blockchain Service Tests

- [ ] Mock ethers provider
- [ ] Test getOracleAssignedEvents with valid inputs
- [ ] Test getOracleAssignedEvents with no events
- [ ] Test getOracleAssignedEvents with RPC errors
- [ ] Test block range validation

### 3.9 Write IPFS Service Tests

- [ ] Mock axios for HTTP requests
- [ ] Test downloadFromIPFS success case
- [ ] Test downloadFromIPFS with gateway failures
- [ ] Test downloadFromIPFS with timeout
- [ ] Test concurrent download queue
- [ ] Test file writing functionality

### 3.10 Write Integration Tests

- [ ] Create tests/integration/list-assignments.test.ts
- [ ] Test full command execution with mocked services
- [ ] Test error handling end-to-end

## Phase 4: GitHub Actions CI Pipeline

### 4.1 Create CI Workflow

- [ ] Create .github/workflows/ci.yml
- [ ] Set name: "CI"
- [ ] Add trigger on push to all branches
- [ ] Add trigger on pull_request

### 4.2 Add Lint Job

- [ ] Create lint job running on ubuntu-latest
- [ ] Add checkout step
- [ ] Add Node.js setup (version 18)
- [ ] Add npm ci step
- [ ] Add npm run lint step
- [ ] Add npm run format:check step

### 4.3 Add Test Job

- [ ] Create test job running on ubuntu-latest
- [ ] Add checkout step
- [ ] Add Node.js setup (version 18)
- [ ] Add npm ci step
- [ ] Add npm run test:coverage step
- [ ] Add coverage upload to Codecov (optional)

### 4.4 Add Build Job

- [ ] Create build job running on ubuntu-latest
- [ ] Add checkout step
- [ ] Add Node.js setup (version 18)
- [ ] Add npm ci step
- [ ] Add npm run build step
- [ ] Add artifact upload for dist folder

### 4.5 Add Matrix Testing

- [ ] Update test job to use matrix strategy
- [ ] Test on Node.js versions: [20, 22, 24]
- [ ] Test on OS: [ubuntu-latest, macos-latest, windows-latest]

## Phase 5: NPM Release Pipeline

### 5.1 Create Release Workflow

- [ ] Create .github/workflows/release.yml
- [ ] Set trigger on push to main branch only
- [ ] Add workflow_dispatch for manual triggers

### 5.2 Add Version Bump

- [ ] Install semantic-release packages
- [ ] Create .releaserc.json configuration
- [ ] Configure conventional commits
- [ ] Set up automatic version bumping

### 5.3 Configure NPM Publishing

- [ ] Add NPM_TOKEN secret to GitHub repository
- [ ] Add npm authentication step in workflow
- [ ] Add semantic-release step
- [ ] Configure package publishing

### 5.4 Add Release Notes

- [ ] Configure changelog generation
- [ ] Set up GitHub release creation
- [ ] Add release assets (built files)

### 5.5 Add Pre-release Checks

- [ ] Add step to run linting before release
- [ ] Add step to run tests before release
- [ ] Add step to verify build before release

## Phase 6: NPX Support

### 6.1 Update Package.json for NPX

- [ ] Ensure "bin" field is correctly set
- [ ] Add "preferGlobal": false
- [ ] Verify "files" includes all necessary files

### 6.2 Test NPX Locally

- [ ] Run npm link to test locally
- [ ] Test npx elephant-cli command
- [ ] Verify all commands work via npx

### 6.3 Add NPX Documentation

- [ ] Update README.md with npx usage examples
- [ ] Add installation instructions for both npm install and npx
- [ ] Add troubleshooting section for common npx issues

### 6.4 Optimize for NPX

- [ ] Minimize package size
- [ ] Ensure fast startup time
- [ ] Remove unnecessary dependencies

## Phase 7: Final Verification

### 7.1 Complete Testing

- [ ] Run full test suite
- [ ] Verify 80%+ code coverage
- [ ] Run linting and formatting checks

### 7.2 Documentation Review

- [ ] Ensure all documentation reflects "Elephant CLI"
- [ ] Update examples with new command names
- [ ] Verify all links and references

### 7.3 Manual Testing

- [ ] Test npx elephant-cli list-assignments
- [ ] Test with various command options
- [ ] Test error scenarios
- [ ] Test on different operating systems

### 7.4 Pre-release Checklist

- [ ] Version bump to 1.0.0
- [ ] All CI checks passing
- [ ] Documentation complete
- [ ] CHANGELOG.md created
- [ ] NPM account ready for publishing
