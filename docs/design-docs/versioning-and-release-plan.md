# Production Versioning & Release Strategy for keri-ts / cesr-ts + tufa

## Summary

Establish a production-grade, independent SemVer release system for keri-ts and cesr-ts using Changesets, remove hardcoded CLI version strings, and
implement deterministic build metadata for CI artifacts so tufa version and tufa --version always report a consistent, current version string.

Chosen decisions from this review:

- Version model: Independent package versioning.
- CI build metadata: Display-only suffix in CLI output (not npm package version).
- Release automation: Changesets.
- tufa version output: single-line keri-ts version.

———

## Goals and Success Criteria

1. tufa version and tufa --version return the exact same value.
2. Released artifacts show clean SemVer (x.y.z).
3. CI-built artifacts automatically show x.y.z+build.<run>.<sha> (or equivalent) in CLI output.
4. SemVer bumping (patch/minor/major) is one-command/simple PR workflow.
5. keri-ts and cesr-ts can release independently without forced lockstep bumps.
6. Release process is reproducible and documented end-to-end.

———

## Current-State Gaps (from repo inspection)

- src/app/cli/cli.ts hardcodes version as 0.0.2.
- dnt build scripts set npm versions via env vars with fallback literals (0.1.0).
- Existing release workflows are tag/manual-driven, but no unified version source used by runtime CLI output.
- No formalized SemVer workflow metadata/changelog process across both packages.

———

## Architecture & Source-of-Truth Design

### 1) Canonical version sources

Use package manifests as the canonical version source:

- Root package (keri-ts) version in package.json (to be added/normalized for Changesets).
- CESR package version in packages/cesr/package.json (to be added/normalized).

deno.json version fields are treated as non-authoritative and synced only if needed for tooling/docs consistency.

### 2) Runtime version module

Add generated runtime version modules:

- src/app/version.ts for keri-ts / tufa
- packages/cesr/src/version.ts for cesr-ts

Each module exports:

- PACKAGE_VERSION (SemVer, e.g. 0.4.2)
- BUILD_METADATA (optional, e.g. build.1842.a1b2c3d)
- DISPLAY_VERSION (PACKAGE_VERSION or PACKAGE_VERSION+BUILD_METADATA)

Generation inputs:

- package version from package manifest
- CI env (GITHUB_RUN_NUMBER, short SHA), when present

### 3) CLI wiring

In src/app/cli/cli.ts:

- Replace hardcoded .version("0.0.2") with DISPLAY_VERSION.
- Add explicit version subcommand (tufa version) printing DISPLAY_VERSION.
- Keep Commander --version/-V wired to same DISPLAY_VERSION.

Output format (locked):

- Plain single line, e.g. 0.4.2 or 0.4.2+build.1842.a1b2c3d.

———

## Release Tooling Plan (Changesets)

### 4) Introduce Changesets

Add:

- .changeset/config.json
- .changeset/README.md (short workflow guidance)
- root dev dependency for @changesets/cli

Policy:

- Independent versioning for keri-ts and cesr-ts.
- PRs that affect publishable behavior include a changeset file with bump type.
- Changesets-generated changelog used as release notes base.

### 5) Tasks/scripts (Deno-friendly wrappers)

Add root deno.json tasks:

- release:changeset -> create changeset (npx changeset)
- release:version -> apply bumps/changelogs (npx changeset version)
- release:publish -> publish (npx changeset publish) for Node-side registry publishing pipelines
- version:generate -> generate runtime version modules from manifests + optional CI metadata
- version:check -> verify generated files are in sync (CI guard)

Also add CESR package task wrappers where useful, but centralize release orchestration at repo root.

———

## CI/CD Strategy

### 6) PR CI checks

On PR:

- run tests/checks
- run version:generate and version:check to ensure no drift
- validate changeset presence for publishable changes (policy job)

### 7) Release CI

Use Changesets GitHub Action:

- On merge to main, action opens/updates a “Version Packages” PR from pending changesets.
- Merging that PR creates tags and publishes packages (or creates publish-ready commits depending on chosen mode).
- Build step injects CI metadata into generated version modules before package build so CLI in CI artifacts includes build suffix.

For stable release publish:

- npm package version remains plain SemVer (x.y.z), no build metadata in package version field.
- CLI display can still include build metadata on CI-built non-release artifacts; release artifacts can omit it (configurable default: omit for tagged
  release builds, include for non-tag CI builds).

———

## Public API / Interface Changes

1. CLI behavior:

- tufa --version -> prints DISPLAY_VERSION
- tufa -V -> same
- tufa version -> same single-line value

2. Internal version API:

- New module src/app/version.ts (and CESR equivalent) exporting:
  - PACKAGE_VERSION
  - BUILD_METADATA
  - DISPLAY_VERSION

3. Build/release interface:

- New tasks in deno.json for version generation/check and release ops.
- New Changesets config and workflow files.

———

## Testing & Validation Plan

### Unit tests

1. DISPLAY_VERSION formatting:

- no build metadata -> x.y.z
- with build metadata -> x.y.z+build...

2. CLI tests:

- tufa --version equals tufa version
- single-line output format
- no extra prose/no JSON default

### Integration tests

3. Build-time version propagation:

- generated npm artifact reports expected version string in CLI.
- CI-mode generation appends metadata deterministically with mocked env.

4. Release dry-run checks:

- changeset versioning updates only intended packages.
- independent bump behavior validated (keri-ts only and cesr-ts only scenarios).

### Acceptance criteria

- No hardcoded version literals in CLI.
- tufa always reports version consistent with packaged artifact.
- patch/minor/major bump flow can be executed with documented steps and no manual file editing.

———

## Rollout Steps (Implementation Order)

1. Add package manifests and Changesets scaffolding.
2. Implement version generation modules and wire cli.ts to DISPLAY_VERSION.
3. Add tufa version subcommand.
4. Add Deno tasks for version/release operations.
5. Update GitHub workflows to Changesets-driven release flow and CI metadata injection.
6. Add tests.
7. Update docs:

- README install + version usage
- RELEASE.md with exact bump/release commands

———

## Operational Release Process (Day-2 Usage)

### Patch/minor/major bump flow

1. Author change with corresponding changeset (release:changeset).
2. Merge PR.
3. Changesets action opens version PR.
4. Review/merge version PR.
5. CI publishes updated package(s) and tags.
6. tufa version on installed latest shows new version immediately.

### Build metadata behavior

- Non-tag CI builds: show x.y.z+build.<run>.<sha>
- Tagged release builds: default to x.y.z (or include metadata if policy switched)

———

## Assumptions and Defaults

- npm remains the publish target for both packages.
- GitHub Actions remains CI/CD system.
- We will add/manage package.json manifests needed by Changesets even though Deno is primary dev runtime.
- Build metadata is display-only and not part of published npm package version semantics.
- tufa version command remains human-readable plain text by default (no JSON unless added later with explicit flag).
