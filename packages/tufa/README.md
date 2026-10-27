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

## ACDC v2 wallet admission

`tufa ipex admit --acdc-v2 --consent --said <grant> -n <store> -a <holder>`
requires a locally accepted v2 Grant and explicit wallet consent. Wallet checks
current authenticated graph truth before signing; ordinary ingress must accept
the Admit before consent is recorded. Delivery uses the existing host/Poster
workflow, or `--out <file>` writes the signed response. Final JSON follows owned
store/runtime shutdown. A later delivery or shutdown failure does not erase an
already accepted local admission.

`tufa vc wallet list -n <store>` lists ACDC v2 issued/held inventory references.
`tufa vc wallet read -n <store> --grant <grant>` reads that admitted Grant's exact
disclosed credential. A second/full disclosure has its own Grant key; reads do
not merge private material or assert current standing. Legacy `vc list/export`
and ordinary `ipex admit` retain their existing paths. ACDC v2 negotiated Admit
publication gathers the required source-anchor receipts before returning; group
holders use explicit member approval of the exact Admit before wallet consent
is recorded. `--approval-timeout 0` returns a pending proposal without admission.

## ACDC v2 IPEX disclosure

The existing `ipex apply`, `offer`, `agree`, `grant` and `spurn` commands accept
`--acdc-v2`. Supply a flat disclosure `--plan JSON_OR_@FILE` for Apply/Offer, and
carry the actual predecessor with `--apply`, `--offer`, or Grant's `--prior`.
`--anchor` requests negotiated source anchoring. Grant authorizes current graph
use before signing and rechecks after receipt collection.

For an admitted view, use:

```sh
tufa ipex grant --acdc-v2 -n STORE -a HOLDER -r VERIFIER \
  --from-grant GRANT --disclose '["a/status/"]' --out presentation.cesr
```

`--said` selects an issued credential. A separately transferred exact stream uses
`--view FILE --presenter-authorized`; an accepted transferred `--from-grant` also
requires that explicit authorization. This does not create wallet admission
consent. A partial view cannot gain withheld fields from another cached Grant.
`--refresh` updates proof evidence only; supply exact `--opening FILE...`, or use
`--derive` with explicitly provisioned custody. `--presentation-registry NAME`
selects a local registry matching the disclosed Issuee declaration. `--input FILE`
first admits supplied signed evidence through ordinary ingress.

ACDC v2 group registry commands stage the same RIP/BUP bodies and publish exact
member proposals. Approve registry proposals with `tufa multisig join`; approve
IPEX proposals with `tufa ipex join`. A proposal or one local signature is not
accepted issuance, admission or permission to present. Group Grant/Admit signing
requires current authenticated root truth, and completed delivery or new consent
rechecks that truth after threshold completion. Historical wallet reads keep the
original admitted proof after revocation. Prepare a presentation BUP against the
frozen unsigned Grant before its first member approval; recorded wrapper retries
replay their exact original nests.

`ipex unblind --opening FILE --said CREDENTIAL --states '["issued"]'` tests an
explicitly possessed opening UUID against candidate states; optional `--out FILE`
writes the matching counted opening. A match does not establish accepted standing
or permission to disclose.

ACDC v2 IPEX attachment genus defaults to 2.0. Agree/Grant/Admit independently
accept `--witness-gvrsn 2` for the known v2 witness profile; the witness
default remains 1.0. Body protocol version and attachment genus are independent.
`--out` writes supporting public evidence plus signed wire; otherwise existing
runtime delivery runs and joins cleanup before final output.

ACDC v2 mutation commands load the store's normal configuration. Flows requiring
qualified receiver time need KRAM enabled with explicit cache windows; enabling
it alone supplies no windows. The selected Locksmith policy is
`"kram": {"enabled": true, "caches": {"~": [10000, 300000, 3600000, 86400000, 300000, 3600000, 86400000]}}`.
`tufa agent` forwards KRAM from its selected configuration too; use the same
policy for the store and its host. Omitting `kram` leaves it disabled.

## ACDC v2 registry authoring

Use `vc registry incept --acdc-v2 --registry-name NAME --alias AID_ALIAS`, then
`vc create --acdc-v2 --registry-name NAME --alias AID_ALIAS --data JSON`. ACDC v2
create/revoke default to derived custody; `--public` deliberately publishes the
BUP opening instead. `vc update --registry-name NAME --alias AID_ALIAS --said CREDENTIAL --state STATE` advances ACDC v2 BUP state. `vc revoke --acdc-v2` uses the
same exact acceptance path. All four authoring commands accept `--witness-gvrsn 2`
for the known v2 witness profile; the default remains 1.0. Legacy commands retain
their existing defaults.

Provision explicitly with inception's `--with-custody` and optional `--discloser`.
An encrypted authenticated Keeper is required. `vc registry custody export` writes
an exclusive protected `--file`; `import` requires explicit `--controller` and
`--discloser`, and optionally `--rewrap` after Keeper AEID replacement. Select a
local `--registry-name` or accepted `--registry` SAID for a remote designated
discloser. Transfer the plaintext artifact over an authenticated private operator
channel; the CLI does not distribute secrets. Derived state commands accept
`--bound-event` for an exact witnessed Issuee event. Groups remain a separate
approval workflow.

ACDC v2 success JSON follows exact anchored acceptance and joined store cleanup.
A timeout or receipt failure leaves protocol staging for explicit retry; retrying
uses the same already signed KEL seal rather than making another anchor. Ordinary
registrar replay distributes public evidence; ACDC v2 authoring does not revive
historical `upd`, use TEL backers, or claim peer delivery from local acceptance.
