# Plan: Harden `keri-ts` npm Dependency Handling At The `cesr-ts` Package Boundary

## Summary

The current npm dependency failures are a symptom, not the core problem:
`keri-ts` production source still imports local CESR source via relative paths
like `../../../cesr/mod.ts`, so the npm build vendors an `esm/cesr` subtree
into the `keri-ts` tarball.

That vendoring makes `keri-ts` responsible for CESR runtime dependencies
indirectly and incompletely, which is why missing-module failures appear one
package at a time (`@msgpack/msgpack`, then `cbor-x`, and likely more if left
as-is).

The best solution is to make `keri-ts` consume `cesr-ts` as a real package
dependency in both local Deno development and npm builds, then add an automated
artifact audit that proves every bare import in the built tarball is declared in
the generated `package.json`.

## Current Findings

1. Most production `keri-ts` source still imports CESR through local relative
   source paths such as `../../../cesr/mod.ts`.
2. One production file reaches deeper into CESR internals:
   `packages/keri/src/db/core/keys.ts` imports `to32CharHex` from
   `../../../../cesr/src/core/bytes.ts`.
3. `packages/keri/deno.json` already defines the intended development seam by
   mapping bare `"cesr-ts"` imports to `../cesr/mod.ts`.
4. Some `keri-ts` source already uses the package boundary directly
   (`packages/keri/src/app/cli/annotate.ts`,
   `packages/keri/src/app/cli/benchmark.ts`).
5. The current npm build for `keri-ts` uses an import map only for bare
   `"cesr-ts"` imports. Relative imports to local CESR source remain relative,
   so `dnt` vendors a CESR subtree into `packages/keri/npm/esm/cesr`.
6. Vendoring `esm/cesr` into the `keri-ts` tarball causes `keri-ts` to inherit
   CESR runtime dependencies implicitly. That is the root cause behind the
   repeated `ERR_MODULE_NOT_FOUND` failures.
7. The existing smoke tests are useful but reactive: they catch missing runtime
   dependencies only after the tarball is built and executed.

## Desired Invariant

For npm packaging, `keri-ts` should depend on `cesr-ts` through the package
boundary, not by vendoring CESR source into its own tarball.

That means:

1. production `keri-ts` source imports CESR via bare `cesr-ts`
2. `packages/keri/npm/esm/cesr/**` is absent from the built `keri-ts` artifact
3. `keri-ts` only declares its own direct runtime dependencies plus `cesr-ts`
4. CESR-internal runtime dependencies remain owned by `cesr-ts`

## Implementation Plan

### 1. Migrate production `keri-ts` imports to the `cesr-ts` package boundary

- Replace production-source imports of `../../../cesr/mod.ts` and similar local
  CESR paths with bare `cesr-ts` imports throughout `packages/keri/src/**`.
- Keep this migration scoped to production source first; test imports can remain
  local for now unless they block packaging or type-checking.
- Remove the deep CESR internal import in
  `packages/keri/src/db/core/keys.ts` by importing `to32CharHex` from the
  public `cesr-ts` surface.
- Treat `packages/keri/deno.json`'s `"cesr-ts": "../cesr/mod.ts"` mapping as
  the development-time source of truth so local Deno workflows continue to use
  repo-local CESR source.

### 2. Make the npm build rely on the package boundary instead of vendoring CESR

- Keep the `packages/keri/scripts/build_npm.ts` import-map behavior that maps
  bare `cesr-ts` to the versioned npm package during the build.
- After the import migration, verify that `dnt` no longer emits
  `packages/keri/npm/esm/cesr/**` inside the built `keri-ts` package.
- Reduce `keri-ts` runtime dependencies to the packages it directly imports in
  its own built artifact, plus `cesr-ts`.
- Stop manually mirroring CESR-owned runtime dependencies like `cbor-x`,
  `@noble/*`, and `libsodium-wrappers` in `keri-ts` when they are no longer
  directly imported by the built `keri-ts` artifact.

### 3. Add a deterministic npm artifact dependency audit

- Add a build/release check that scans the built npm artifact for bare imports
  under `packages/keri/npm/esm/**/*.js` and `packages/cesr/npm/esm/**/*.js`.
- Treat as valid only:
  - relative/self imports
  - Node built-ins (`node:*`)
  - packages explicitly listed in the generated `package.json` dependencies
- Fail the check if:
  - the built artifact contains a vendored `esm/cesr/**` tree inside
    `keri-ts`, or
  - any bare runtime import is missing from the generated manifest.
- Run the same audit for `cesr-ts` so both package builds are held to the same
  rule.

### 4. Clean up misleading packaging seams and docs

- Remove or explicitly retire the unused `packages/keri/src/cesr/**`
  "rewritten by the build system" convenience files if they are not part of the
  real import strategy.
- Update packaging/release docs to document the intended invariant:
  `keri-ts` consumes `cesr-ts` through the package boundary and should not ship
  vendored CESR runtime code.
- Keep the local reinstall and smoke-test workflows focused on validating the
  built tarballs, not compensating for architectural dependency drift.

## Public Interface Impact

- No library API changes are required.
- `keri-ts`'s generated npm manifest will change shape:
  - it should keep only `keri-ts` direct runtime dependencies plus `cesr-ts`
  - CESR-internal dependencies should remain in the `cesr-ts` package
- No new `cesr-ts` public API is expected to be required if `keri-ts` uses the
  already-exported `to32CharHex` from the CESR public surface.

## Validation Plan

### Source Validation

- Static search confirms no production `packages/keri/src/**` files still
  import `../../../cesr/**` or deeper CESR source paths.
- `deno task check` continues to pass for `keri-ts`.
- Targeted `keri-ts` tests continue to pass after the import migration.

### Packaging Validation

- `deno task build:npm` succeeds for both `packages/keri` and `packages/cesr`.
- The new artifact dependency audit passes for both generated npm packages.
- `packages/keri/npm/esm/cesr` is absent from the built `keri-ts` artifact.
- The generated `packages/keri/npm/package.json` dependency list aligns with
  actual bare runtime imports in the built artifact.

### Runtime Validation

- The local reinstall workflow installs both tarballs successfully.
- `scripts/smoke-test-keri-npm.sh` passes when both tarballs are supplied.
- Running installed `tufa` from the packed artifact no longer produces
  `ERR_MODULE_NOT_FOUND` for CESR-owned runtime packages.

## Assumptions

1. `packages/keri/deno.json`'s `"cesr-ts": "../cesr/mod.ts"` mapping is the
   accepted local-development seam.
2. Production-source migration is the priority; test import cleanup is optional
   follow-up work.
3. The correct long-term invariant is architectural, not procedural:
   `keri-ts` should not ship vendored CESR runtime code in its npm tarball.
