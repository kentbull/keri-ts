# Production Versioning & Release Strategy for keri-ts / cesr-ts + tufa

## Summary

Use one explicit version source per package, deterministic version generation
for normal checks, Changesets for release intent, and CI that validates both
library and runnable-package artifacts. The key boundary is now explicit:
`keri-ts` is the library surface, `tufa` is the runnable host/CLI surface.

## Goals

1. One authoritative version source per published package
2. Deterministic local/CI checks unless a release job opts into stamped build
   metadata
3. Consistent version reporting across library APIs, CLI output, and npm
   artifacts
4. Honest release automation that validates the packed artifacts users install
5. Clear package ownership so `keri-ts` and `tufa` do not drift back into one
   blurred release story

## Current Gaps

1. Version data can drift when package metadata, runtime reporting, and release
   scripts are not derived from the same source.
2. Runnable `tufa` smoke confidence can diverge from library confidence if only
   Deno-source workflows are exercised.
3. CI can become nondeterministic if ordinary checks inherit release-oriented
   build metadata.

## Design

### Canonical Version Sources

1. Each published package owns its own package version.
2. Runtime-facing version reporting should read from generated version modules,
   not ad hoc package-file parsing at call sites.
3. Library and CLI version surfaces should agree with the built artifact, not
   just source-tree metadata.

### Runtime Version Modules

1. Generate small version modules during build/release preparation.
2. Ordinary checks should default to deterministic values with empty build
   metadata.
3. Release/artifact jobs may opt into stamped metadata explicitly.

### CLI Wiring

1. CLI `--version` should read from the generated runtime version source.
2. `tufa` version reporting should validate the runnable package boundary, not
   only the source path.

## Release Tooling

### Changesets

1. Use Changesets to record intended package bumps.
2. Keep package versioning explicit and reviewable in PRs.
3. Let release automation consume Changesets rather than deriving bump intent
   from commit heuristics.

### Tasks/Scripts

1. Provide Deno-friendly wrappers for version generation, pack validation, and
   release preparation.
2. Keep version scripts small, deterministic, and package-aware.
3. Avoid hidden coupling between version scripts and ambient CI variables.

## CI/CD Strategy

### PR CI

1. Validate formatting, lint, and default quality lanes.
2. Validate version-module generation deterministically.
3. Build and smoke the runnable `tufa` package when CLI/host surfaces change.
4. Keep library checks and runnable-package checks separate enough that drift is
   visible.

### Release CI

1. Consume approved Changesets.
2. Generate stamped version metadata only in the release/artifact path.
3. Build, pack, and validate the publishable artifacts before publishing.
4. Publish only from the artifacts that passed those checks.

## Public Surface Rules

1. `keri-ts` should expose the narrow library surface only.
2. `tufa` owns the runnable CLI/host/runtime package surface.
3. Do not let internal build paths or accidental exports leak into npm package
   manifests.

## Validation

### Unit

1. Version-module generation is deterministic.
2. CLI version output matches generated runtime version data.
3. Package manifests and generated modules agree.

### Integration

1. Packed `tufa` artifact can start, report version, and pass basic smoke flows.
2. Library package build and import surfaces stay aligned with the intended
   entrypoints.

### Acceptance Criteria

1. One clear version source per package
2. Deterministic checks by default
3. Explicit release-only metadata stamping
4. Runnable package smoke coverage for `tufa`
5. No accidental public-surface drift between source and published artifacts

## Rollout Order

1. Lock package ownership and intended public entrypoints
2. Add/generated version modules and wire runtime/CLI consumers to them
3. Introduce Changesets
4. Add PR checks for deterministic version validation
5. Add packed-artifact smoke coverage for `tufa`
6. Add release-only stamping and publish automation

## Day-2 Rules

1. Patch/minor/major intent is recorded through Changesets
2. Build metadata is empty unless a release/artifact path opts into stamping
3. When CLI or host behavior changes, validate the packed `tufa` artifact, not
   only the source tree
