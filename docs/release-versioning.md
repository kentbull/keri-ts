# Versioning and release process

## Version model

- `keri-ts` and `cesr-ts` are versioned independently.
- Canonical versions are sourced from:
  - `packages/keri/package.json` (`keri-ts`)
  - `packages/cesr/package.json` (`cesr-ts`)
- `deno.json` versions are synchronized from package manifests:
  - `deno task manifest:sync`
  - `deno task manifest:check`

## Runtime CLI version strings

- Generated files:
  - `packages/keri/src/app/version.ts`
  - `packages/cesr/src/version.ts`
- Generator:
  - `scripts/generate_versions.ts`
- Output format:
  - local/default: `x.y.z`
  - CI builds: `x.y.z+build.<run>.<sha>`

## Release intent and version bumps

### Common sequence: bump `keri-ts` after `cesr-ts`

Use this when `cesr-ts` is already bumped (for example `0.2.3`) and you want to
bump only `keri-ts` to the matching version.

```bash
# 1) Create a changeset for keri-ts only
deno task release:changeset
# select package: keri-ts
# select bump type (usually patch)

# 2) Apply versioning updates
deno task release:version

# 3) Validate
deno task quality
deno task build:npm

# 4) Commit and tag
git add -A
git commit -m "release: bump keri-ts to <version>"
git tag keri-v<version>
git push origin master --follow-tags
```

Notes:

- `keri-ts` and `cesr-ts` are independent; matching versions are optional.
- `keri-ts` npm dependency range for `cesr-ts` is derived at build time from
  `packages/cesr/package.json`.
- Deno import-map entries for `cesr-ts` (for example in `deno.json` and
  `packages/keri/deno.json`) are managed manually and are not CI-enforced.

### Common sequence: bump and release `cesr-ts` + `keri-ts` together

Use this when both packages changed and you want to release both in one cycle.

```bash
# 1) Add changesets (one for cesr-ts, one for keri-ts)
deno task release:changeset
deno task release:changeset

# 2) Apply version updates for both packages
deno task release:version

# 3) Validate and build both npm artifacts
deno task quality
deno task npm:build:all

# 4) Commit and tag both releases
git add -A
git commit -m "release: bump cesr-ts and keri-ts"
git tag cesr-v<cesr-version>
git tag keri-v<keri-version>
git push origin master --follow-tags
```

1. Add a changeset in feature PRs:

```bash
deno task release:changeset
```

2. Apply version bumps and changelog updates:

```bash
deno task release:version
```

This command now runs:

- `changeset version`
- `manifest:sync` (package.json -> deno.json)
- `version:generate` (runtime version modules)

3. Validate generated runtime version modules:

```bash
deno task version:check
```

4. Smoke test keri npm artifact in `node:alpine` (verifies `tufa version` and
   `tufa annotate`):

```bash
deno task smoke:keri:npm
```

To smoke test a specific tarball (already packed):

```bash
bash scripts/smoke-test-keri-npm.sh packages/keri/npm/keri-ts-<version>.tgz
```

## Publishing

- `keri-ts` release workflow: `.github/workflows/keri-ts-npm-release.yml`
- `cesr-ts` release workflow: `.github/workflows/cesr-npm-release.yml`
- Tag formats:
  - `keri-v<version>`
  - `cesr-v<version>`
- Each workflow validates that the tag version matches package manifest version
  before publishing.
- `keri-ts` release workflow also runs Docker smoke validation (`node:alpine`)
  against the packed tarball before `npm publish`.
