# Changesets workflow

This folder stores Changesets release intent files.

1. Add a release intent in a feature PR:

```bash
npx changeset
```

2. Merge PRs as normal.

3. Create/update the release versioning PR:

```bash
deno task release:version
```

4. Build and publish package artifacts through CI release workflows.

Notes:

- `keri-ts`, `cesr-ts`, and `@keri-ts/tufa` are versioned independently.
- Add one changeset per publishable package affected by a release.
- `deno task release:version` updates package manifests, synced `deno.json`
  versions, and generated version modules for all three packages.
- `@keri-ts/tufa` publishes from the `tufa-v<version>` tag workflow after any
  required `cesr-ts` / `keri-ts` dependency versions are already on npm.
- Build metadata is appended to CLI display versions on CI builds only.
- Full maintainer release guidance lives in `../MAINTAINER-README.md`.
