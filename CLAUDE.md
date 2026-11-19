## IMPORTANT

Read `AGENTS.md` first: layout, commands, and the contracts that must not break.

- Use context7 MCP to get latest documentation, code snippets and best practices.
- Try to keep things in one function unless composable or reusable
- DO NOT use `else` unless necessary; return early
- AVOID `let mut` where a binding can be immutable
- DO NOT `unwrap` or `expect` on anything that depends on input
- AVOID `unsafe`; when it is needed, say in a comment why it is sound
- PREFER single word variable names where possible
- One module per command in `src/`; shared code lives in its own module
- Use `cargo fmt` for code styling; do not hand-edit formatting. `cargo clippy --all-targets -- -D warnings` runs independently.
- Write the failing test first; tests run the built binary on real files (`tests/*.rs`)

### Documentation

- Target end-user workflows first; organize sections in execution order.
- Always provide a table of contents for long guides.
- For each command, cover purpose, required inputs, outputs, options, and an example invocation.
- Prefer precise language, consistent terminology, and GitHub-friendly markdown anchors.
