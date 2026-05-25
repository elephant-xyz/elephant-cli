# Transform v2 uses handler packages

Transform v2 uses a distinct handler ZIP with a root `handler.js` entrypoint instead of overloading the v1 five-script `--scripts-zip` bundle. We chose this because Browser Flow v2 now produces a capture manifest with named captures, and a single handler context with constrained helpers is a clearer contract for consuming those captures than preserving the old fixed script sequence. The v1 scripts bundle remains unchanged so existing generated transforms keep working while v2 establishes a separate package shape.

## Considered Options

- Reuse `--scripts-zip` and infer v1 versus v2 from `--transform-version`.
- Add `--transform-zip` as a distinct v2 package flag.
- Accept `--scripts-zip` as a temporary v2 alias.

We chose a distinct `--transform-zip` with explicit `--transform-version 2` so callers cannot accidentally mix the v1 five-script runner with the v2 handler runtime.
