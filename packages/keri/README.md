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

Those three entrypoints are the general library surfaces. `keri-ts/cli` is the
separate command-helper boundary used by Tufa. Runnable CLI/server ownership
lives in `@keri-ts/tufa`.

The runtime exports deliberate operations and data contracts. Scheduling details,
handler installation, reply-slot state and constructor helpers remain internal;
implementation-module exports do not automatically become package API. npm deep
imports such as `keri-ts/app/...` and `keri-ts/core/...` are not supported. Import
runtime operations from `keri-ts/runtime` and storage from `keri-ts/db`.

## Maintainer Docs

- `docs/ARCHITECTURE_MAP.md`: package and module ownership map
- `docs/design-docs/credentials/ACDC_TEL_VERIFIER.md`:
  credential stack ownership and failure modes
- `docs/design-docs/kel/DELEGATION_AND_ENDPOINTS.md`:
  delegation, group coordination, and endpoint-role mental model
- `docs/design-docs/cesr/ATTACHMENT_COUNTER_GVRSN.md`:
  attachment counter versioning and replay boundaries

## License

Licensed under the Apache License, Version 2.0 (`Apache-2.0`). See the top-level
`LICENSE` file in this repository.
