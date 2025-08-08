## [1.23.3](https://github.com/elephant-xyz/elephant-cli/compare/v1.23.2...v1.23.3) (2025-08-08)


### Bug Fixes

* **constants:** update fallback gas limit to 30M ([#79](https://github.com/elephant-xyz/elephant-cli/issues/79)) ([004ba66](https://github.com/elephant-xyz/elephant-cli/commit/004ba66c66e9749d3a352ad240c003ca651bc825))

## [1.23.2](https://github.com/elephant-xyz/elephant-cli/compare/v1.23.1...v1.23.2) (2025-08-07)


### Bug Fixes

* fix missing files in fetch-data command ([#78](https://github.com/elephant-xyz/elephant-cli/issues/78)) ([310e815](https://github.com/elephant-xyz/elephant-cli/commit/310e815d176f1e433355937f66b40d20ffa7a045))

## [1.23.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.23.0...v1.23.1) (2025-08-07)


### Bug Fixes

* make `fetch-data` output zip, and fix "/" data structure ([#75](https://github.com/elephant-xyz/elephant-cli/issues/75)) ([80719fa](https://github.com/elephant-xyz/elephant-cli/commit/80719fa95130e74ead20b022801b11fa45818678))

# [1.23.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.22.0...v1.23.0) (2025-08-06)


### Features

* Add `fetch-data` command ([#74](https://github.com/elephant-xyz/elephant-cli/issues/74)) ([5baed62](https://github.com/elephant-xyz/elephant-cli/commit/5baed6264507fbaa66cf05858afb1237f90c358e))

# [1.22.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.21.0...v1.22.0) (2025-08-05)


### Features

* **cli:** add CID-hex conversion commands ([#73](https://github.com/elephant-xyz/elephant-cli/issues/73)) ([994c8ed](https://github.com/elephant-xyz/elephant-cli/commit/994c8ed096830aa2ca27e9c106005ec4865f09f0))

# [1.21.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.20.1...v1.21.0) (2025-08-05)


### Features

* **cli:** add check-transaction-status command ([#72](https://github.com/elephant-xyz/elephant-cli/issues/72)) ([c1c82ae](https://github.com/elephant-xyz/elephant-cli/commit/c1c82aec63b357ee22d1f731641dc9596bc06bb7))

## [1.20.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.20.0...v1.20.1) (2025-08-05)


### Bug Fixes

* **json-validator:** allow zero as valid currency value ([#71](https://github.com/elephant-xyz/elephant-cli/issues/71)) ([fd6d01d](https://github.com/elephant-xyz/elephant-cli/commit/fd6d01d30ce716c6f910c6b333a996b70584589c))

# [1.20.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.19.0...v1.20.0) (2025-08-05)


### Features

* Allow Zip file input for multiple property objects ([#69](https://github.com/elephant-xyz/elephant-cli/issues/69)) ([e1175e9](https://github.com/elephant-xyz/elephant-cli/commit/e1175e96b7fdb3d944423e5e9cd4044b32cd728e))

# [1.19.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.18.1...v1.19.0) (2025-08-05)


### Features

* Add CSV export for submitted transaction IDs ([#70](https://github.com/elephant-xyz/elephant-cli/issues/70)) ([59fa08c](https://github.com/elephant-xyz/elephant-cli/commit/59fa08caf91f5959181c46509a4ddb073b9bb682))

## [1.18.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.18.0...v1.18.1) (2025-08-04)


### Bug Fixes

* increase transaction wait timeout ([#67](https://github.com/elephant-xyz/elephant-cli/issues/67)) ([7de0b0b](https://github.com/elephant-xyz/elephant-cli/commit/7de0b0b5f7c164c1d438a45f86781f9c56bd31b3))

# [1.18.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.17.0...v1.18.0) (2025-08-04)


### Features

* Add `validate` command and tests for file validation against schemas. ([518f73a](https://github.com/elephant-xyz/elephant-cli/commit/518f73afe46de79ba7df378f1fa88f2cc689645f))

# [1.17.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.16.5...v1.17.0) (2025-08-01)


### Features

* Implement rate limiting for Pinata uploads to prevent bursts and 429 errors ([#64](https://github.com/elephant-xyz/elephant-cli/issues/64)) ([778f829](https://github.com/elephant-xyz/elephant-cli/commit/778f8298cd68ee2d7af453eb9310cd35f19566e0))

## [1.16.5](https://github.com/elephant-xyz/elephant-cli/compare/v1.16.4...v1.16.5) (2025-07-31)


### Bug Fixes

* Fix Seed datagroup validation against the schema. ([#63](https://github.com/elephant-xyz/elephant-cli/issues/63)) ([37c3e7c](https://github.com/elephant-xyz/elephant-cli/commit/37c3e7c4b1b88cdfbc76d8f537eda60d18f63e3a))

## [1.16.4](https://github.com/elephant-xyz/elephant-cli/compare/v1.16.3...v1.16.4) (2025-07-30)


### Bug Fixes

* Fix JSON canonicalization for Seed data ([#62](https://github.com/elephant-xyz/elephant-cli/issues/62)) ([f462a91](https://github.com/elephant-xyz/elephant-cli/commit/f462a9116e25c4b158680a7ae3d41cd559603386))

## [1.16.3](https://github.com/elephant-xyz/elephant-cli/compare/v1.16.2...v1.16.3) (2025-07-29)


### Bug Fixes

* resolve county datagroup files getting folder names instead of s… ([#61](https://github.com/elephant-xyz/elephant-cli/issues/61)) ([38a7046](https://github.com/elephant-xyz/elephant-cli/commit/38a7046c9066b0ce667a1f836ad7d19f8b22ab87))

## [1.16.2](https://github.com/elephant-xyz/elephant-cli/compare/v1.16.1...v1.16.2) (2025-07-25)


### Bug Fixes

* resolve 504 error ([adb41e1](https://github.com/elephant-xyz/elephant-cli/commit/adb41e173e11c14f108f66fda85d53f93c2e2a01))

## [1.16.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.16.0...v1.16.1) (2025-07-24)


### Bug Fixes

* **file-scanner:** handle symlinks and empty dirs ([#59](https://github.com/elephant-xyz/elephant-cli/issues/59)) ([75ae44d](https://github.com/elephant-xyz/elephant-cli/commit/75ae44d9a34ba13607bd1fe56b833bbce941328e))

# [1.16.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.15.0...v1.16.0) (2025-07-23)


### Features

* include all site assets to the ipfs upload ([#58](https://github.com/elephant-xyz/elephant-cli/issues/58)) ([32efd91](https://github.com/elephant-xyz/elephant-cli/commit/32efd91cf64b5d20ceaaee04760d1ef286ba3176))

# [1.15.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.14.0...v1.15.0) (2025-07-23)


### Features

* **validate-and-upload:** add fallback fact-sheet path ([#55](https://github.com/elephant-xyz/elephant-cli/issues/55)) ([56a7d4d](https://github.com/elephant-xyz/elephant-cli/commit/56a7d4d67abc110092ab55cfcf59e5ffd59430a8))

# [1.14.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.13.1...v1.14.0) (2025-07-23)


### Features

* generate html during validate-and-upload ([#54](https://github.com/elephant-xyz/elephant-cli/issues/54)) ([e4fe805](https://github.com/elephant-xyz/elephant-cli/commit/e4fe805b7af75b3c77a79c8676c352a3eba11ae4))

## [1.13.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.13.0...v1.13.1) (2025-07-23)


### Bug Fixes

* update seed CID ([139946d](https://github.com/elephant-xyz/elephant-cli/commit/139946daa28563480ca8adb4f1715bb4c56edb6f))

# [1.13.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.12.0...v1.13.0) (2025-07-22)


### Features

* Images uploading ([#52](https://github.com/elephant-xyz/elephant-cli/issues/52)) ([059f51c](https://github.com/elephant-xyz/elephant-cli/commit/059f51c5bcb23599de99f7a977ab3f5284e9243c))

# [1.12.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.11.1...v1.12.0) (2025-07-18)


### Features

* optional eligibility check ([#51](https://github.com/elephant-xyz/elephant-cli/issues/51)) ([2fa6dc9](https://github.com/elephant-xyz/elephant-cli/commit/2fa6dc91c64239994f7e00a10534fa053a75ed62))

## [1.11.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.11.0...v1.11.1) (2025-07-18)


### Bug Fixes

* update seed CID ([#50](https://github.com/elephant-xyz/elephant-cli/issues/50)) ([788eec9](https://github.com/elephant-xyz/elephant-cli/commit/788eec9d571a87fdd6fea88d9a441e7e782ea558))

# [1.11.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.10.3...v1.11.0) (2025-07-18)


### Features

* **api:** add centralized API submission mode ([#48](https://github.com/elephant-xyz/elephant-cli/issues/48)) ([68e0bbc](https://github.com/elephant-xyz/elephant-cli/commit/68e0bbc504bf8f9ba054aa6e7532cd57ee7238e9))

## [1.10.3](https://github.com/elephant-xyz/elephant-cli/compare/v1.10.2...v1.10.3) (2025-07-18)


### Bug Fixes

* **unsigned tx:** produce tx type: 2 and estimate gas before execution ([#47](https://github.com/elephant-xyz/elephant-cli/issues/47)) ([f406273](https://github.com/elephant-xyz/elephant-cli/commit/f40627313650ed7ebb1d361173ad234b44377da9))

## [1.10.2](https://github.com/elephant-xyz/elephant-cli/compare/v1.10.1...v1.10.2) (2025-07-17)


### Bug Fixes

* **constants:** update schema CID value ([#46](https://github.com/elephant-xyz/elephant-cli/issues/46)) ([ee9235a](https://github.com/elephant-xyz/elephant-cli/commit/ee9235aaa3ffea86f317af59eef879de23fd9070))

## [1.10.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.10.0...v1.10.1) (2025-07-16)


### Bug Fixes

* **constants:** update schema CID value ([#45](https://github.com/elephant-xyz/elephant-cli/issues/45)) ([a444a2c](https://github.com/elephant-xyz/elephant-cli/commit/a444a2cdc193c0023ae024c2b6e2ce0a7804225b))

# [1.10.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.9.0...v1.10.0) (2025-07-16)


### Features

* **validate:** enforce data group schema checks ([#44](https://github.com/elephant-xyz/elephant-cli/issues/44)) ([9400425](https://github.com/elephant-xyz/elephant-cli/commit/9400425c0be106cdde4d1c394b215aa41bd38345))

# [1.9.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.8.4...v1.9.0) (2025-07-14)


### Features

* **submit:** add unsigned tx JSON dry-run export ([#42](https://github.com/elephant-xyz/elephant-cli/issues/42)) ([e7cddbd](https://github.com/elephant-xyz/elephant-cli/commit/e7cddbdf14943b8857bd80b1b6c491791674a521))

## [1.8.4](https://github.com/elephant-xyz/elephant-cli/compare/v1.8.3...v1.8.4) (2025-07-14)


### Bug Fixes

* **json-validator:** improve error messages for paths ([#41](https://github.com/elephant-xyz/elephant-cli/issues/41)) ([a612b7c](https://github.com/elephant-xyz/elephant-cli/commit/a612b7cf4ea6cc20b85efb7a6cbc35203f312a1a))

## [1.8.3](https://github.com/elephant-xyz/elephant-cli/compare/v1.8.2...v1.8.3) (2025-07-10)


### Bug Fixes

* **constants:** update schema CID value ([#39](https://github.com/elephant-xyz/elephant-cli/issues/39)) ([a148921](https://github.com/elephant-xyz/elephant-cli/commit/a1489217e6f8b8a0f7af6bf1f9e02185ba8243d7))

## [1.8.2](https://github.com/elephant-xyz/elephant-cli/compare/v1.8.1...v1.8.2) (2025-07-09)


### Bug Fixes

* **json-validator:** handle anyOf with null and CID ([#38](https://github.com/elephant-xyz/elephant-cli/issues/38)) ([6dd48d5](https://github.com/elephant-xyz/elephant-cli/commit/6dd48d544778cea88574c7c7f88a43a3c4dd481e))

## [1.8.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.8.0...v1.8.1) (2025-07-05)


### Bug Fixes

* **validate:** improve error message for missing Pinata JWT ([#37](https://github.com/elephant-xyz/elephant-cli/issues/37)) ([35c24c5](https://github.com/elephant-xyz/elephant-cli/commit/35c24c52b4193b3d9bcb7147d660ed50ec1f7f77))

# [1.8.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.7.0...v1.8.0) (2025-07-05)


### Features

* **seed-datagroup:** add support for seed datagroup directories ([#36](https://github.com/elephant-xyz/elephant-cli/issues/36)) ([26b8f40](https://github.com/elephant-xyz/elephant-cli/commit/26b8f40938350807dacbbbd1b8599f862b607ede))

# [1.7.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.6.3...v1.7.0) (2025-07-05)


### Features

* **json-validator:** enhance error messages with detailed formats ([#35](https://github.com/elephant-xyz/elephant-cli/issues/35)) ([476a6f6](https://github.com/elephant-xyz/elephant-cli/commit/476a6f615e67db5495e5836a40c9521c4a2aa858))

## [1.6.3](https://github.com/elephant-xyz/elephant-cli/compare/v1.6.2...v1.6.3) (2025-07-05)


### Bug Fixes

* **validate-and-upload:** support dry run without Pinata JWT ([#33](https://github.com/elephant-xyz/elephant-cli/issues/33)) ([a24406a](https://github.com/elephant-xyz/elephant-cli/commit/a24406adceb135b42cd6a0e0831e712ab5b5de8e))

## [1.6.2](https://github.com/elephant-xyz/elephant-cli/compare/v1.6.1...v1.6.2) (2025-07-05)


### Bug Fixes

* **ipld-converter:** recursively process nested file links ([#32](https://github.com/elephant-xyz/elephant-cli/issues/32)) ([af0fb31](https://github.com/elephant-xyz/elephant-cli/commit/af0fb3147c9a4d99b48e665ed054bdc5f113fc42))

## [1.6.1](https://github.com/elephant-xyz/elephant-cli/compare/v1.6.0...v1.6.1) (2025-07-05)


### Bug Fixes

* fixed error messages and data resolution ([#31](https://github.com/elephant-xyz/elephant-cli/issues/31)) ([8118a6f](https://github.com/elephant-xyz/elephant-cli/commit/8118a6f27ba70303b5c920dc2212273c7b04312f))

# [1.6.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.5.0...v1.6.0) (2025-07-02)


### Features

* **json-validator:** add currency and custom format validators ([#30](https://github.com/elephant-xyz/elephant-cli/issues/30)) ([47f6617](https://github.com/elephant-xyz/elephant-cli/commit/47f66173178bc7fbbb4d813da0c86a2e5146b63f))

# [1.5.0](https://github.com/elephant-xyz/elephant-cli/compare/v1.4.0...v1.5.0) (2025-07-02)


### Features

* add new formats, sort ipld links in the arrays ([#29](https://github.com/elephant-xyz/elephant-cli/issues/29)) ([733c3d0](https://github.com/elephant-xyz/elephant-cli/commit/733c3d031f557af6db7043158a236e8eb9565323))

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
