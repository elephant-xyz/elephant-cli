Write a granular step-by-step plan to:

1. Rename everythin from oracle CLI to Elephant CLI
1. Cover this CLI tool with unit tests
1. Apply indastry standart from linter and formatter point of view
1. Build a CI pipeline for the github actions, that will follow industry best practices: Lint, Formatt, Unit tests
1. Create a github action pipeline, that will do the release to the npm when merged to main and will automatically bump version
1. Make sure, that it is as easy to run the CLI as to do `npx elephant <command>`

Each task should:

- Be incredibly small + testable
- Have a clear start + end
- Focus on one concern
  I’ll be passing this off to an engineering LLM that will be told to complete one task at a time, allowing me to test in between.

Save the plan to the tasks.md
