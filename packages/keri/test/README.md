# keri-ts tests

This directory contains `keri-ts` package tests.

## Run tests

From `packages/keri`:

```bash
# Full package test suite
deno task test

# Quality-focused subset used by CI
deno task test:quality

# Fast DB, core, and app lanes
deno task test:quality:db-fast
deno task test:quality:core-fast-a
deno task test:quality:core-fast-b
deno task test:quality:core-fast
deno task test:quality:core-fast-parallel
deno task test:quality:app-fast

# Optional app-fast debug lanes
deno task test:quality:app-fast-parallel
deno task test:quality:app-fast-isolated

# Backward-compatible alias
deno task test:quality:app-light

# Stateful CLI/app lanes
deno task test:quality:app-stateful-a
deno task test:quality:app-stateful-b

# Interop lanes
deno task test:quality:interop-parity
deno task test:quality:interop-witness
deno task test:quality:interop-gates-b
deno task test:quality:interop-gates-c

# Server integration test
deno task test:integration:server
```

From repo root:

```bash
deno task test
deno task test:quality
deno task test:integration:server
```

## Notes

- Most developers adopting `keri-ts` will primarily use `tufa version` and
  `tufa annotate` as initial verification commands.
- CI groups tests by isolation boundary, not just by folder:
  - `db-fast`, `core-fast-a`, `core-fast-b`, and the parallel-safe portion of
    `app-fast` run with `deno test --parallel`.
  - Stateful CLI/app tests that mutate `console`, `HOME`, or persisted local
    stores run one file at a time.
  - Interop tests are split into their own lanes because they are the slowest
    tests and require pinned KERIpy plus LMDB v1 compatibility in CI.
  - `interop-witness` is the dedicated witness receipting parity lane. It uses
    explicit randomized KERIpy witness processes instead of the fixed-port
    `kli witness demo` topology.
- Parallel lanes auto-detect available CPUs and cap themselves conservatively
  by default. Override with `KERI_TEST_JOBS` or `DENO_JOBS` when you need a
  different worker count locally or in CI. `test:quality:core-fast-parallel`
  splits that worker budget across the two core slices and runs them together.
- Maintainer-focused testing and release flows are documented in
  `MAINTAINER-README.md`.
