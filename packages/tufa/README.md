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

## Native registry authoring

Use `vc registry incept --native --registry-name NAME --alias AID_ALIAS`, then
`vc create --native --registry-name NAME --alias AID_ALIAS --data JSON`. Native
create/revoke default to derived custody; `--public` deliberately publishes the
BUP opening instead. `vc update --registry-name NAME --alias AID_ALIAS --said CREDENTIAL --state STATE` advances native BUP state. `vc revoke --native` uses the
same exact acceptance path. Legacy commands retain their existing defaults.

Provision explicitly with inception's `--with-custody` and optional `--discloser`.
An encrypted authenticated Keeper is required. `vc registry custody export` writes
an exclusive protected `--file`; `import` requires explicit `--controller` and
`--discloser`, and optionally `--rewrap` after Keeper AEID replacement. Select a
local `--registry-name` or accepted `--registry` SAID for a remote designated
discloser. Transfer the plaintext artifact over an authenticated private operator
channel; the CLI does not distribute secrets. Derived state commands accept
`--bound-event` for an exact witnessed Issuee event. Groups remain a separate
approval workflow.

Native success JSON follows exact anchored acceptance and joined store cleanup.
A timeout or receipt failure leaves protocol staging for explicit retry; retrying
uses the same already signed KEL seal rather than making another anchor. Ordinary
registrar replay distributes public evidence; native authoring does not revive
historical `upd`, use TEL backers, or claim peer delivery from local acceptance.
