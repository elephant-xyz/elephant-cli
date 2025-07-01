# [1.4.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.3.1...v1.4.0) (2025-07-01)


### Features

* add support for custom json schema (schemalink) ([#28](https://github.com/elephant-xyz/elephant-cli/issues/28)) ([6b81845](https://github.com/elephant-xyz/elephant-cli/commit/6b81845861440a49d5b27cc3eba7a4256ad87687))

## [1.3.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.3.0...v1.3.1) (2025-06-22)


### Bug Fixes

* remove assignement check from the submit commands ([#23](https://github.com/elephant-xyz/elephant-cli/issues/23)) ([e7e8c6a](https://github.com/elephant-xyz/elephant-cli/commit/e7e8c6a80baa1beb27b914c7337d87882abafc81))

# [1.3.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.2.4...v1.3.0) (2025-06-06)


### Features

* split submit-files into 2 comands: validate-and-upload and submit-to-contract ([#15](https://github.com/elephant-xyz/elephant-cli/issues/15)) ([31b2ae3](https://github.com/elephant-xyz/elephant-cli/commit/31b2ae37c765996953df5a7386cc325a1f32a21e))

## [1.2.4](https://github.com/elephant-xyz/elephant-cli/compare/v1.2.3...v1.2.4) (2025-06-05)


### Bug Fixes

* list assignments not from 0 block when submitting ([#19](https://github.com/elephant-xyz/elephant-cli/issues/19)) ([e303463](https://github.com/elephant-xyz/elephant-cli/commit/e303463d56db2ee6ad368e4fa253a9031d995b93))

## [1.2.3](https://github.com/elephant-xyz/elephant-cli/compare/v1.2.2...v1.2.3) (2025-06-05)


### Bug Fixes

* add ethers as runtime dep ([#17](https://github.com/elephant-xyz/elephant-cli/issues/17)) ([92ad052](https://github.com/elephant-xyz/elephant-cli/commit/92ad052cc6e375ee92964378f6bfa39bf2a743ec))

## [1.2.2](https://github.com/elephant-xyz/elephant-cli/compare/v1.2.1...v1.2.2) (2025-06-04)


### Bug Fixes

* **blockchain:** paginate OracleAssigned event queries ([#14](https://github.com/elephant-xyz/elephant-cli/issues/14)) ([0de3546](https://github.com/elephant-xyz/elephant-cli/commit/0de354699545c70e475bfc328bb827b963a0a23e))

## [1.2.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.2.0...v1.2.1) (2025-05-30)


### Bug Fixes

* fixed progress bar and output logging ([#12](https://github.com/elephant-xyz/elephant-cli/issues/12)) ([0236f9a](https://github.com/elephant-xyz/elephant-cli/commit/0236f9afcbe6f7f58c01bce3b9b4c2e23d8969a7))

# [1.2.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.1.0...v1.2.0) (2025-05-29)


### Features

* submit files command ([#8](https://github.com/elephant-xyz/elephant-cli/issues/8)) ([bb4cd44](https://github.com/elephant-xyz/elephant-cli/commit/bb4cd447ac09f13348f9c455724bf8705a0f8bfb))

# [1.1.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.0.0...v1.1.0) (2025-05-27)


### Features

* trigger release ([80a86ea](https://github.com/elephant-xyz/elephant-cli/commit/80a86ea8086474277d5cc3d09184e2d4a5afc4f3))

# 1.0.0 (2025-05-27)


### Bug Fixes

* **blockchain:** rename ElephantAssigned to OracleAssigned event ([17b9267](https://github.com/elephant-xyz/elephant-cli/commit/17b9267d0e88faf365d6009bb5732f6334840968))


### Features

* **cli:** add CLI tool with assignment listing and downloads ([876eb32](https://github.com/elephant-xyz/elephant-cli/commit/876eb329bc9cabd4753c28c389baa97a779407d7))
* **cli:** add oracle network CLI with list-assignments command ([2052752](https://github.com/elephant-xyz/elephant-cli/commit/20527529766d68f2577b31895de1b8064e611581))
* **list-assignments:** fetch and download oracle assignments ([7c8dda2](https://github.com/elephant-xyz/elephant-cli/commit/7c8dda228bacd9ca845c41efb58809164f74a37d))

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-01-23

### Added

- Initial release of Elephant Network CLI
- Command to list and download elephant assignments from blockchain
- Support for custom RPC URLs and IPFS gateways
- Concurrent download support with progress indicators
- Comprehensive error handling and validation
- TypeScript implementation with full type safety
- ESLint and Prettier configuration
- Jest unit tests with coverage reporting
- GitHub Actions CI/CD pipeline
- Automated NPM releases with semantic versioning
- NPX support for running without installation

### Features

- Query Polygon blockchain for OracleAssigned events
- Decode IPFS CIDs from event data
- Download files from IPFS with retry logic
- Progress indicators and colored console output
- Support for custom download directories
- Block range filtering capabilities

### Technical

- Built with TypeScript 5.0+
- Uses ethers.js v6 for blockchain interaction
- Axios for HTTP requests with timeout handling
- Commander.js for CLI argument parsing
- Chalk for colored terminal output
- Ora for spinner animations
