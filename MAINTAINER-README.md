# MAINTAINER README

Maintainer-oriented workflows for releasing and operating the `keri-ts`
monorepo.

## Scope

Use this guide for:

- release/versioning operations
- CI and npm publish flows
- local maintainer setup details (including Deno install behavior)

Developer adoption and day-to-day package usage are documented in `README.md`,
`packages/keri/README.md`, and `packages/cesr/README.md`.

## Pinned maintainer toolchain

Use the checked-in `.tool-versions` file for local maintainer work:

- Node `25.9.0`
- Deno `2.7.11`

CI currently pins Deno `2.8.2` and Node `25.9.0`; the local Deno pin differs.
Record the actual runtime when comparing results. This matters because the repo
depends on a
native `lmdb-js` addon rebuilt with `LMDB_DATA_V1=true`, and addon behavior has
been sensitive to runtime drift.

Local macOS note:

- `packages/keri/scripts/setup_lmdb_v1.sh` rebuilds every discovered local
  `lmdb` package tree that Node or Deno may actually load, including Deno's
  `.deno/.../node_modules/lmdb` copy when present
- this is an addon-provenance safeguard, not a global-install requirement: Deno
  may resolve `npm:lmdb` from its shadow package tree under
  `node_modules/.deno/...`, and that tree can otherwise keep using an optional
  prebuilt native addon even after top-level `node_modules/lmdb` has been
  rebuilt successfully
- the script intentionally resolves `npm:lmdb` through Deno itself so the
  runtime-selected package directory is materialized and rebuilt, not just the
  package directory we assume should be used
- Run `deno task setup:compat-lmdb` explicitly before compat-dependent tests;
  the test runner never mutates native dependency builds.
- the dependency is upstream `lmdb@3.5.3`; do not restore the retired fork or
  cleanup-hook patch
- if the macOS data-v1 lock path still fails with `ENOSPC`, treat it as a host
  OS/resource-exhaustion problem to document separately, not as justification
  for weakening LMDB locking semantics in `keri-ts`

## Test selection

`deno task test:quality` runs exactly the required PR unit/runtime and parity
coverage. `deno task test` adds all functional interop, including DID Webs;
`deno task test:qualification` also runs both manual endurance scenarios.
See [test ownership and verified external runtimes](packages/keri/test/README.md)
for exact files, topology, provenance, concurrency limits and retained timings.

## Release and versioning

[Release operations](docs/versioning/release-versioning.md) owns versioning,
shared tag workflows, publish order and exact artifact verification. Use it for
release commands; a successful build or Changesets PR does not prove publication.

## Build and smoke-test npm artifacts

Build and smoke scripts are orchestration only. Executable JavaScript and
TypeScript used by release/build flows belongs in source files such as
`scripts/npm/*.ts`, `scripts/npm/*.mjs`, `scripts/ci/*.ts`, or package-local
script modules. Do not add multiline `node` heredocs, `deno eval`, or generated
module bodies as shell strings; `deno task inline-code:check` enforces this.

```bash
# Build keri-ts library npm package
deno task build:npm

# Build all npm packages
deno task npm:build:all

# Smoke test the keri-ts tarball entrypoints in node:alpine
deno task smoke:keri:npm

# Smoke test the tufa tarball in node:alpine (tufa version + annotate)
deno task smoke:tufa:npm
```

To test a specific prebuilt tarball:

```bash
bash scripts/smoke-test-keri-npm.sh packages/keri/npm/keri-ts-<version>.tgz
bash scripts/smoke-test-tufa-npm.sh packages/tufa/npm/keri-ts-tufa-<version>.tgz
```

## Deno global install notes for tufa

Before rebuilding LMDB locally with `deno task setup`, make sure your active
`node` and `deno` binaries match the pinned versions above.

When installing `tufa` directly from local source with Deno, allow scripts for
native npm dependencies to avoid repeated warnings:

```bash
deno install --global \
  --config "$(pwd)/deno.json" \
  --lock "$(pwd)/deno.lock" \
  --frozen \
  --node-modules-dir=auto \
  --allow-scripts=npm:cbor-extract,npm:lmdb,npm:msgpackr-extract \
  --allow-all \
  --unstable-ffi \
  --name tufa \
  "$(pwd)/mod.ts"
```

Resolver rule that matters here:

- Deno uses the config passed on the command line for the whole module graph.
- It does not inherit `packages/cesr/deno.json` just because a loaded file lives
  under `packages/cesr/`.
- Because `packages/keri` currently has development-time source bridges into
  local `packages/cesr/src` and `packages/cesr/mod.ts`, root and
  `packages/keri/deno.json` must also map CESR-owned npm imports used by that
  local source graph (for example `@msgpack/msgpack`, `cbor-x/decode`, and
  `cbor-x/encode`).
- Use the repo lockfile for local global installs. This protects `tufa` install
  flows from broken upstream optional dependency releases (for example
  `cbor-extract`/`@cbor-extract/*` resolution drift).

## Dependency mapping policy

`cesr-ts` import-map entries are intentionally managed manually.

- Root map: `deno.json`
- Package map: `packages/keri/deno.json`
- CESR-local map: `packages/cesr/deno.json`

This keeps maintainers free to choose published or local-compatible ranges based
on release timing.
