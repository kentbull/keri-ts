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

These exact versions match CI. This matters here because the repo depends on a
native `lmdb-js` addon rebuilt with `LMDB_DATA_V1=true`, and addon behavior has
been sensitive to runtime drift.

Local macOS note:

- `packages/keri/scripts/setup_lmdb_v1.sh` also applies the repo's Deno cleanup
  hook workaround before rebuilding `lmdb-js`
- `deno task test` triggers that rebuild automatically through the KERI test
  group runner on macOS
- the cleanup-hook patch is the upstream candidate
- if the macOS data-v1 lock path still fails with `ENOSPC`, treat it as a host
  OS/resource-exhaustion problem to document separately, not as justification
  for weakening LMDB locking semantics in `keri-ts`

## Release and versioning

Primary reference:

- `docs/versioning/release-versioning.md`

Quick commands:

```bash
# Add release intent
deno task release:changeset

# Apply version bumps/changelog updates
deno task release:version

# Verify generated/runtime versions
deno task version:check

# Validate the full Tufa release path before tagging
deno task release:verify:tufa
```

## Build and smoke-test npm artifacts

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

## CI workflows

- `/.github/workflows/changesets-version-pr.yml`
- `/.github/workflows/keri-ts-npm-release.yml`
- `/.github/workflows/cesr-npm-release.yml`
- `/.github/workflows/tufa-npm-release.yml`

Tag-triggered release workflows require package version/tag alignment.

Tufa release order rule:

- if `@keri-ts/tufa` depends on new `cesr-ts` or `keri-ts` versions, publish
  those first, then publish `@keri-ts/tufa`

Tufa release prep rule:

- add a changeset when `@keri-ts/tufa` changes in a publishable way, run
  `deno task release:version`, then run `deno task release:verify:tufa` before
  creating `tufa-v<version>`

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
