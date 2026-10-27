# @keri-ts/tufa

Trust Utilities for Agents CLI application package.

## Run From Source

```bash
deno task tufa --help
deno task tufa version
```

## Install

```bash
npm install -g @keri-ts/tufa
tufa version
```

The published npm package name is `@keri-ts/tufa`. The installed binary remains
`tufa`.

## Maintainer Docs

- `docs/ARCHITECTURE_MAP.md`: package and module ownership map
- `docs/design-docs/kel/DELEGATION_AND_ENDPOINTS.md`:
  delegation, multisig, and endpoint-role command boundaries
- `docs/design-docs/credentials/ACDC_TEL_VERIFIER.md`:
  VC/IPEX/verifier command responsibilities and interop caveats

## License

Licensed under the Apache License, Version 2.0 (`Apache-2.0`). See the top-level
`LICENSE` file in this repository.

## Source organization

`src/cli/commands` holds effectful command adapters; `src/cli/command-definitions`
holds lazy Commander registration by subject. The CLI driver, dispatch contracts,
version display and Node executable stay beside them, with shared command support
in `src/cli/support`. Listener composition, HTTP policies and operator
planning retain their separate `host`, `http` and `operator` directories. Verifier
application policy, cue storage and webhook work live in `@keri-ts/verifier`;
Tufa retains command registration and runtime composition. Import verifier APIs
from `@keri-ts/verifier` directly; `@keri-ts/tufa/runtime` exposes Tufa hosts.
