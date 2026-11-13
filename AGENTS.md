# Agent Notes

## What this is

- One Rust crate that builds one binary, `elephant-cli`. There is no npm package: the binary is distributed through GitHub releases and `cargo install`.
- Six commands, in workflow order: `prepare`, `transform`, `validate`, `hash`, `export-tables`, `upload`. `README.md` documents them in that order; keep it that way.
- `CONTEXT.md` defines the domain terms. Use them in code, tests and docs.

## Commands

- Build: `cargo build` (`--release` for measurements).
- Test: `cargo test`. The browser tests of `prepare` are skipped unless `OBSCURA_BIN` names an obscura binary.
- Lint: `cargo clippy --all-targets -- -D warnings`.
- Format: `cargo fmt`; never hand-format. CI runs `cargo fmt --check`.
- One test: `cargo test --test hash batch` (file `tests/hash.rs`, name filter `batch`).

## Layout

- `src/main.rs`: the clap definitions, the exit codes and what each command prints. Every command module returns a `Done { json, text, passed }`.
- One module per command: `prepare.rs` (with `flow.rs`, `browser.rs`), `transform.rs`, `validate.rs` (with `county.rs` for CARs), `hash.rs`, `tables.rs`, `upload.rs`.
- Shared code: `lexicon.rs` and `schemas.rs` (manifest, schema cache, validation), `property.rs` (a property directory or ZIP), `car.rs`, `cids.rs`, `canonical.rs`, `unixfs.rs`, `report.rs`, `js/` (the QuickJS runtime and its Node shim `js/node.js`).
- `assets/`: JavaScript embedded in the binary (`cheerio.js`, `doT.js`). `scripts/bundle-cheerio.sh` rebuilds the cheerio bundle.
- `.github/workflows`: `ci.yml` (pull requests), `build.yml` (binaries of every commit on `main`, as pre-release `build-<commit>`), `release.yml` (a tag: GitHub release), `binaries.yml` (the build matrix both use).

## Contracts that must not break

- **Installing `main` needs no Rust.** `build.yml` publishes `elephant-cli-<target>.tar.gz` for every commit on `main` as the pre-release `build-<commit>`; keep the archive names and the single `elephant-cli` file inside them.
- **Atlas CI** runs `elephant-cli validate <file.car> --output-csv <csv>` and treats exit `0` as a valid archive. It feeds CARs written by `hash --output-car` and CARs exported by a gateway.
- **The kit's oracle agent** runs the sequence under "Publish a County" in the README and reads these stdout lines: `CAR written: <file> (<n> blocks, root <cid>)`, `Tables written: <dir> (<n> tables, <n> parts, root <cid>)`, `Atlas page written: <path> group <key>`, `Properties processed: <n>, succeeded: <n>, failed: <n>`.
- **`hash` output is byte-identical to elephant-cli 1.x.** CIDs are published; a change to canonical JSON, link sorting, codec choice or CAR layout changes them.

## CLI rules

- stdout is the result: a text report, or exactly one JSON document with `--json`. Everything else goes to stderr.
- Exit `0` success, `1` the input failed its checks, `2` the command could not run.
- No prompts, no colour, no emoji, no progress bars, no network call that the command does not need.
- Do not add a command before trying to fit the work into one of the six.

## Tests

- Tests sit at the public seam: they run the built binary on real files (`tests/*.rs`, helpers in `tests/support`) and assert on exit code, stdout, stderr and the files written.
- Expected outputs under `tests/fixtures/*/expected` came from elephant-cli 1.58.1 on the same inputs. Do not regenerate them from this crate's own output.
- Write the failing test first. After it passes, break the code on purpose once to see the test fail for the right reason.
- `tests/transform_engine.rs` holds the embedded JavaScript engine to Node's answers: each case in `tests/fixtures/transform/engine` is a script, and `golden.sh` there writes what Node reports for it. Add a case there when a county script needs something the engine lacks.
- `scripts/parity` compares this crate with elephant-cli 1.x on generated input and fuzzes `validate` and `hash`. Run the relevant script after changing the validator, hashing, the table export or the JavaScript engine.
- Tests never use the network: `tests/fixtures/lexicon` is the schema cache, and `tests/support/http.rs` is a local HTTP server.

## Style

- Keep logic in one function unless a piece is reused or stands on its own.
- Prefer early returns to `else`. Prefer immutable bindings to `let mut`.
- No `unwrap` or `expect` on anything that depends on input; return the error with the path or CID it concerns.
- No `unsafe` without a comment saying why it is sound.
- Prefer single-word names where they stay clear.
- A new dependency needs a reason a few lines of code cannot meet, and a maintainer that will still be there next year.
- Commit messages are conventional commits with lowercase subjects: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.

## Documentation

- Target end-user workflows first; order sections by execution.
- Long guides get a table of contents.
- For each command: purpose, required inputs, outputs, options and an example invocation.
- When an option or output changes, update the README and the `--help` text in `src/main.rs` together.
