## IMPORTANT

- Use context7 MCP to get latest documentation, code snippets and best practices.
- Try to keep things in one function unless composable or reusable
- DO NOT do unnecessary destructuring of variables
- DO NOT use `else` statements unless necessary
- DO NOT use `try`/`catch` if it can be avoided
- AVOID `try`/`catch` where possible
- AVOID `else` statements
- AVOID using `any` type
- NEVER use `as any`
- AVOID `let` statements
- PREFER single word variable names where possible
- When working with a CLI commands, create separate module in `src/commands` directory
- When shared code is needed, create it outside of `src/commands` directory

### Documentation

- Target end-user workflows first; organize sections in execution order.
- Always provide a table of contents for long guides.
- For each command, cover purpose, required inputs, outputs, options, and an example invocation.
- Prefer precise language, consistent terminology, and GitHub-friendly markdown anchors.
