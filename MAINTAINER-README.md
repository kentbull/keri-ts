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

## Release and versioning

Primary reference:

- `docs/release-versioning.md`

Quick commands:

```bash
# Add release intent
deno task release:changeset

# Apply version bumps/changelog updates
deno task release:version

# Verify generated/runtime versions
deno task version:check
```

## Build and smoke-test npm artifacts

```bash
# Build keri npm package
deno task build:npm

# Build both npm packages
deno task npm:build:all

# Smoke test keri tarball in node:alpine (tufa version + annotate)
deno task smoke:keri:npm
```

To test a specific prebuilt tarball:

```bash
bash scripts/smoke-test-keri-npm.sh packages/keri/npm/keri-ts-<version>.tgz
```

## CI workflows

- `/.github/workflows/changesets-version-pr.yml`
- `/.github/workflows/keri-ts-npm-release.yml`
- `/.github/workflows/cesr-npm-release.yml`

Tag-triggered release workflows require package version/tag alignment.

## Deno global install notes for tufa

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
