# keri-ts

KERI TypeScript protocol/runtime library.

## Install

```bash
# As a dependency
npm install keri-ts
```

## Library surfaces

- default import: browser-safe core/types surface
- `keri-ts/runtime`: explicit non-browser-safe runtime surface
- `keri-ts/db`: explicit LMDB-backed storage surface

Only those three entrypoints are supported public surfaces. Runnable CLI/server
ownership lives in the separate `tufa` package.

## Maintainer Docs

- `docs/ARCHITECTURE_MAP.md`: package and module ownership map
- `docs/design-docs/keri/ACDC_TEL_IPEX_VERIFIER_MAINTAINER_GUIDE.md`:
  credential stack ownership and failure modes
- `docs/design-docs/keri/DELEGATION_MULTISIG_ENDPOINT_ROLES_MAINTAINER_GUIDE.md`:
  delegation, group coordination, and endpoint-role mental model
- `docs/design-docs/keri/ATTACHMENT_COUNTER_GVRSN_MAINTAINER_GUIDE.md`:
  attachment counter versioning and replay boundaries

## License

Licensed under the Apache License, Version 2.0 (`Apache-2.0`). See the top-level
`LICENSE` file in this repository.
