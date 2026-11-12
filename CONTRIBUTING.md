# Contributing to Elephant CLI

## Table of Contents

- [Set Up](#set-up)
- [Make a Change](#make-a-change)
- [Tests](#tests)
- [Style](#style)
- [Submit](#submit)
- [Release](#release)

## Set Up

You need Rust 1.85 or newer (<https://rustup.rs>). Node 20 or newer is needed only for the npm launcher and library.

```bash
git clone https://github.com/elephant-xyz/elephant-cli.git
cd elephant-cli
cargo build
./target/debug/elephant-cli --help
```

The browser tests of `prepare` need the obscura headless browser. Download a `no-render` build from <https://github.com/h4ckf0r0day/obscura/releases> and point `OBSCURA_BIN` at the `obscura` binary. Without it those tests are skipped.

## Make a Change

1. Read `AGENTS.md`: it lists the layout, the rules every command follows, and the contracts with Atlas, the kit agents and the library that must not break.
2. Write a test that fails for the behaviour you want (see [Tests](#tests)).
3. Make it pass with the smallest change.
4. Update `README.md` and the `--help` text in `src/main.rs` when an option or an output changes.

Try to fit new behaviour into one of the six commands before proposing a seventh.

## Tests

```bash
cargo test                                              # everything except the browser tests
OBSCURA_BIN=/path/to/obscura cargo test                 # with the browser tests
cargo test --test hash                                  # one file
ELEPHANT_CLI_BINARY=target/debug/elephant-cli node --test tests/sdk.test.mjs
node --test tests/install.test.mjs                      # the npm installer; needs neither cargo nor the network
```

- Tests run the built binary on real files and assert on its exit code, stdout, stderr and the files it writes. They do not call internal functions.
- Expected values come from somewhere other than this crate: the outputs under `tests/fixtures/*/expected` were written by elephant-cli 1.58.1, and CIDs in tests are literals.
- Tests do not use the network. `tests/fixtures/lexicon` is a schema cache, and `tests/support/http.rs` serves local HTTP.

### Checking against 1.x

`scripts/parity` holds checks that are too slow or need too much for the test suite: fuzzers for `validate` and `hash`, and comparisons with elephant-cli 1.x for hashing, validation findings, exported tables and county scripts. Run the ones that concern your change; `scripts/parity/README.md` lists them.

## Style

```bash
cargo fmt
cargo clippy --all-targets -- -D warnings
```

Both must be clean; CI checks them. The rest of the style rules are in `AGENTS.md`.

## Submit

- Branch from `main`, and open a pull request against `main`.
- Commit messages are [conventional commits](https://www.conventionalcommits.org) with a lowercase subject: `feat(validate): accept gateway exports`.
- Say in the pull request what you ran and what it printed.

## Release

A release is a tag.

1. Set the same version in `Cargo.toml` and `package.json`, run `cargo build` to update `Cargo.lock`, add the entry to `CHANGELOG.md`, and merge.
2. `git tag v<version> && git push origin v<version>`.

Every commit on `main` is also built by the `Build` workflow and published as the pre-release `build-<commit>`; that is what a git install of the npm package downloads. The newest 50 are kept.

The `Release` workflow builds the binaries for Linux and macOS (x86_64 and arm64) and Windows, attaches them to a GitHub release with their SHA-256 sums, writes `npm/release.json` so the npm package downloads the right binary, and publishes `@elephant-xyz/cli`. A version with a hyphen, such as `2.0.0-alpha.1`, is published under the npm tag `next` and marked as a pre-release.
