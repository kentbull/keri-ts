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
