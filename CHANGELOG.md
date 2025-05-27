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
