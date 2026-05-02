# Agent Notes

## Runtime And Package

- This is a single-package ESM TypeScript CLI, not a workspace; use `npm ci` with `package-lock.json`.
- CI runs on Node 24, with tests also covering Node 22; README says Node 20+ for users, but CI is the source of truth for development verification.
- The published CLI binary is `bin/elephant-cli`, which imports `dist/index.js`; run `npm run build` before testing CLI behavior through the binary.
- `src/index.ts` registers Commander commands and loads `.env` from the current working directory via `dotenv.config({ path: '.env' })`.

## Commands

- Install deps: `npm ci`.
- Build: `npm run build` (`tsc` plus copying `src/commands/generate-transform/prompts/*.md` into `dist/`).
- Watch build: `npm run dev`.
- Run all tests: `npm test` (creates `./tmp`, sets `TMPDIR=./tmp`, and runs Vitest with `--dangerouslyIgnoreUnhandledErrors`).
- Run one test file: `npm run test -- tests/unit/commands/transform.test.ts`.
- Run coverage with thresholds: `npm run test:coverage`.
- Lint source only: `npm run lint`; ESLint ignores `tests`, `dist`, `node_modules`, `coverage`, and `*.js`.
- Format source and tests: `npm run format`; check with `npm run format:check`.
- Release CI quality order is `lint -> format:check -> build -> test:coverage`.

## Architecture

- Add new CLI commands as separate modules under `src/commands/`, then register them in `src/index.ts`.
- Do not add new CLI commands by default; first try to fit work into an existing command, service, or library API, and only add a command if the user explicitly insists after the tradeoff is explained.
- Shared programmatic APIs live outside command modules; `src/lib/index.ts` exports library wrappers from `src/lib/commands.ts` and `src/lib/prepare.ts`.
- Core service logic belongs in `src/services/`; cross-cutting helpers belong in `src/utils/` or `src/lib/` depending on whether they are CLI-library APIs.
- Command source imports use emitted `.js` specifiers in TypeScript because `tsconfig.json` uses `module: "nodenext"`.
- The standard county workflow is `prepare -> generate-transform -> transform -> hash -> upload -> submit-to-contract`; keep README command docs in that execution order.

## Current CLI Commands

- Registered in `src/index.ts`: `validate`, `validate-and-upload`, `submit-to-contract`, `check-transaction-status`, `check-gas-price`, `hex-to-cid`, `cid-to-hex`, `hash`, `upload`, `fetch-data`, `transform`, `generate-transform`, `prepare`, and `create-keystore`.
- Before proposing a new command, check whether the behavior belongs in `prepare`, `generate-transform`, `transform`, `hash`, `upload`, `validate`, or `submit-to-contract`; these are the main workflow extension points.
- If the user asks for a capability that sounds like a new command, recommend the smallest change to an existing command first and ask for confirmation before adding a new command surface.

## Tests And Gotchas

- Vitest only includes `tests/**/*.test.ts` and `tests/**/*.spec.ts`; helper files without those suffixes are not test entrypoints.
- `tests/setup.ts` mocks console methods and suppresses unhandled rejections/exceptions, so assertions on logging need explicit mock checks.
- Browser/HTML flows depend on Puppeteer/Chromium packages; README lists Linux system libraries needed for local browser execution.
- Browser-flow errors should include relevant state names in their messages, but do not use generic wrappers like `State "<name>" failed: ...`; write specific, actionable messages instead.
- `generate-transform` requires `OPENAI_API_KEY`; `upload` requires `PINATA_JWT`; contract submission and chain checks require an RPC URL.
- Avoid committing generated/runtime artifacts such as `dist/`, `coverage/`, `tmp/`, logs, CSV outputs, ZIP bundles, and `.env`.

## Style And Docs

- Use context7 MCP for current documentation, code snippets, and best practices when external library behavior is uncertain.
- Keep logic in one function unless it is genuinely composable or reusable.
- Avoid unnecessary destructuring, `else`, `try/catch`, `let`, and `any`; never use `as any`.
- Prefer single-word variable names where they remain clear.
- Use `npm run format` for styling instead of hand-formatting; Prettier is 2 spaces, semicolons, single quotes, trailing commas `es5`, print width 80.
- For long guides, include a table of contents; for each command document purpose, required inputs, outputs, options, and an example invocation.
- Documentation should target end-user workflows first, use precise language, consistent terminology, and GitHub-friendly anchors.
- Commit messages are conventional commits with lowercase subjects; allowed types are `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, and `revert`.
