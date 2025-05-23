# Contributing to Elephant Network CLI

Thank you for your interest in contributing to the Elephant Network CLI! This guide will help you get the project up and running locally and make your first contribution.

## 🚀 Getting Started

### Prerequisites

- Node.js 16.0 or higher
- npm or yarn
- Git
- A code editor (VS Code recommended)

### Local Development Setup

1. **Fork and Clone the Repository**

```bash
# Fork the repository on GitHub first, then:
git clone https://github.com/YOUR-USERNAME/elephant-network-cli.git
cd elephant-network-cli
```

2. **Install Dependencies**

```bash
npm install
```

3. **Build the Project**

```bash
npm run build
```

4. **Test the CLI Locally**

```bash
# Run directly with node
node dist/index.js --help

# Or test the binary
./bin/elephant-cli --help
```

## 🏗️ Project Structure

```
elephant-network-cli/
├── src/
│   ├── commands/          # CLI command implementations
│   ├── services/          # Business logic (blockchain, IPFS, etc.)
│   ├── config/           # Configuration and constants
│   ├── types/            # TypeScript type definitions
│   ├── utils/            # Utility functions
│   └── index.ts          # CLI entry point
├── bin/                  # Executable scripts
├── dist/                 # Compiled JavaScript (git ignored)
├── tests/                # Test files
└── downloads/            # Default download directory (git ignored)
```

## 💻 Development Workflow

### Making Changes

1. **Create a new branch**

```bash
git checkout -b feature/your-feature-name
```

2. **Make your changes**

The most common areas for contributions:

- **Adding new commands**: Create a new file in `src/commands/`
- **Improving services**: Modify files in `src/services/`
- **Adding utilities**: Add to `src/utils/`
- **Updating types**: Edit `src/types/index.ts`

3. **Build and test your changes**

```bash
# Build the project
npm run build

# Test with a real elephant address (has an event at block 71875870)
node dist/index.js list-assignments \
  --elephant 0x0e44bfab0f7e1943cF47942221929F898E181505 \
  --from-block 71875850
```

4. **Watch mode for development**

```bash
# Auto-rebuild on file changes
npm run dev
```

## 🧪 Testing Your Changes

### Manual Testing Checklist

- [ ] Test with valid elephant address
- [ ] Test with invalid inputs (bad addresses, URLs)
- [ ] Test error scenarios (no internet, bad RPC)
- [ ] Test file downloads work correctly
- [ ] Verify console output looks correct

### Test Data

- **Elephant address with assignments**: `0x0e44bfab0f7e1943cF47942221929F898E181505`
- **Block with event**: `71875870`
- **Expected CID**: `QmWUnTmuodSYEuHVPgxtrARGra2VpzsusAp4FqT9FWobuU`

## 📝 Code Style Guidelines

### TypeScript Best Practices

- Use strict typing - avoid `any` types
- Add JSDoc comments for public methods
- Keep functions small and focused
- Use meaningful variable names

### Example Code Style

```typescript
/**
 * Downloads a file from IPFS
 * @param cid - The IPFS content identifier
 * @param outputPath - Where to save the file
 * @returns Download result with success status
 */
async downloadFile(cid: string, outputPath: string): Promise<DownloadResult> {
  // Implementation
}
```

### Formatting

- 2 space indentation
- No semicolons (TypeScript compiler adds them)
- Single quotes for strings
- Max line length: 100 characters

## 🎯 Areas for Contribution

### Good First Issues

1. **Add progress bar for blockchain scanning**
   - Currently uses a spinner
   - Could show actual progress percentage

2. **Add CSV export option**
   - Export assignments list to CSV file
   - Include all metadata (CID, block, transaction)

3. **Improve error messages**
   - Make them more user-friendly
   - Add suggested fixes

4. **Add unit tests**
   - Test services in isolation
   - Mock blockchain and IPFS calls

5. **Add filtering options**
   - Filter by date range
   - Filter by CID pattern

### Advanced Contributions

1. **Multi-chain support**
   - Add support for other EVM chains
   - Make chain configurable

2. **Batch operations**
   - Process multiple elephant addresses
   - Parallel blockchain queries

3. **Resume capability**
   - Save progress for large queries
   - Resume interrupted downloads

## 🐛 Debugging Tips

### Common Issues During Development

1. **TypeScript errors**
```bash
# Check for type errors
npm run build

# See detailed errors
npx tsc --noEmit
```

2. **Runtime errors**
```bash
# Enable debug output
DEBUG=* node dist/index.js list-assignments --oracle 0x...
```

3. **IPFS gateway issues**
```bash
# Test with different gateways
--gateway https://ipfs.io/ipfs/
--gateway https://cloudflare-ipfs.com/ipfs/
```

## 📤 Submitting Your Contribution

1. **Commit your changes**

```bash
git add .
git commit -m "feat: add progress bar for blockchain scanning"
```

Follow conventional commits:
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `refactor:` for code changes that don't add features or fix bugs

2. **Push to your fork**

```bash
git push origin feature/your-feature-name
```

3. **Create a Pull Request**

- Go to the original repository on GitHub
- Click "New Pull Request"
- Select your fork and branch
- Fill out the PR template
- Submit!

## 🤝 Getting Help

- **Discord**: Join our Discord server (link in README)
- **Issues**: Check existing issues or create a new one
- **Discussions**: Use GitHub Discussions for questions

## 📋 PR Checklist

Before submitting a PR, ensure:

- [ ] Code builds without errors (`npm run build`)
- [ ] Manual testing completed
- [ ] Code follows project style
- [ ] Comments added for complex logic
- [ ] README updated if adding new features
- [ ] No sensitive data (keys, passwords) included

## 🎉 Thank You!

Every contribution matters, whether it's:
- Fixing a typo
- Improving documentation
- Adding new features
- Reporting bugs
- Suggesting improvements

We appreciate your time and effort in making this project better!