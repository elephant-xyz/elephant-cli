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
- Query Polygon blockchain for ElephantAssigned events
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