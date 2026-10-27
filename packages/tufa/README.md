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
in `src/cli/support`. Indirect-host, witness TCP/role composition and operator
planning retain their `host`, `roles` and `operator` directories. The HTTP host/kernel,
app policy and connected routes live in `@keri-ts/hosting`. Verifier
application policy, cue storage and webhook work live in `@keri-ts/verifier`;
Tufa retains command registration and runtime composition. Import verifier APIs
from `@keri-ts/verifier` and HTTP hosting APIs from `@keri-ts/hosting` directly.

## Native wallet admission

`tufa ipex admit --native --consent --said <grant> -n <store> -a <holder>`
requires a locally accepted v2 Grant and explicit wallet consent. Wallet checks
current authenticated graph truth before signing; ordinary ingress must accept
the Admit before consent is recorded. Delivery uses the existing host/Poster
workflow, or `--out <file>` writes the signed response. Final JSON follows owned
store/runtime shutdown. A later delivery or shutdown failure does not erase an
already accepted local admission.

`tufa vc wallet list -n <store>` lists native issued/held inventory references.
`tufa vc wallet read -n <store> --grant <grant>` reads that admitted Grant's exact
disclosed credential. A second/full disclosure has its own Grant key; reads do
not merge private material or assert current standing. Legacy `vc list/export`
and ordinary `ipex admit` retain their existing paths. Native negotiation,
anchored Admit publication, groups and custody remain separate operations.
