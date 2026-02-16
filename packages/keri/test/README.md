# keri-ts tests

This directory contains `keri-ts` package tests.

## Run tests

From `packages/keri`:

```bash
# Full package test suite
deno task test

# Quality-focused subset used by CI
deno task test:quality

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
- Maintainer-focused testing and release flows are documented in
  `MAINTAINER-README.md`.
