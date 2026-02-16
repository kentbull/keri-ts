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

- `keri-ts` and `cesr-ts` are versioned independently.
- Build metadata is appended to CLI display versions on CI builds only.
- Full maintainer release guidance lives in `../MAINTAINER-README.md`.
