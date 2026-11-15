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
- Deno `2.9.8`

Local tooling and CI select Deno `2.9.8` and Node `25.9.0`. Deno 2.8.2 fails
the configured HTTPS wrong-CA control after a valid connection; 2.9.8 rejects
that connection. See the [configured-source boundary](docs/reference/compatibility/KERI_V1_V2_COMPATIBILITY.md#comp-02--detached-and-full-body-http-framing).
Record the actual runtime when comparing results: the native LMDB addon's
behavior has been sensitive to runtime drift.

LMDB note:

- the dependency is `@keri-ts/lmdb-js` (kentbull/lmdb-js, branch `data-v1`):
  lmdb-js compiled for LMDB 0.9.29 (data format v1, what KERIpy reads), N-API
  only, with the upstream close fix (kriszyp/lmdb-js#388). Its platform
  packages ship the addon prebuilt, so `deno install` compiles nothing and no
  install script needs to run
- `scripts/ci/report-lmdb-runtime.ts` proves which addon loaded and that it
  writes data version 1; do not rebuild lmdb-js in place
- retire the fork package and return to upstream `lmdb` once upstream ships the
  close fix in a data-v1 release
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

# Smoke test the tufa tarball in node:alpine (tufa version + annotate), built
# with its internal dependencies from this checkout
deno task smoke:tufa:npm
```

To test a specific prebuilt tarball (internal dependencies then come from npm at
the pinned versions; add locally built dependency tarballs after it to use those):

```bash
bash scripts/smoke-test-keri-npm.sh packages/keri/npm/keri-ts-<version>.tgz
bash scripts/smoke-test-tufa-npm.sh packages/tufa/npm/keri-ts-tufa-<version>.tgz
bash scripts/smoke-test-package-npm.sh hosting packages/hosting/npm/keri-ts-hosting-<version>.tgz
```

## Deno global install notes for tufa

When installing `tufa` directly from local source with Deno, allow scripts for
native npm dependencies to avoid repeated warnings:

```bash
deno install --global \
  --config "$(pwd)/deno.json" \
  --lock "$(pwd)/deno.lock" \
  --frozen \
  --node-modules-dir=auto \
  --allow-scripts=npm:cbor-extract,npm:msgpackr-extract \
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
