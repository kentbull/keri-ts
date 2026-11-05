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
`--derive` with explicitly provisioned custody. Opening files contain one raw
concatenated BlindState or BoundState CESR tuple, without attachment counters. `--presentation-registry NAME`
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

Fresh individual issuance uses a managed fresh accepted RIP, an encrypted Keeper,
accepted peer KEL/endpoints, and explicitly enabled KRAM configuration. The exact
schema must be available locally. Incept without `--with-custody`, then prepare a
body without issuing it or creating a root. Run the issuer; its `phase: selected`
output supplies the Grant SAID for explicit recipient setup:

```sh
tufa vc registry incept --acdc-v2 -n ISSUER_STORE -a ISSUER --registry-name FRESH
tufa vc create --acdc-v2 --prepare -n ISSUER_STORE -a ISSUER \
  --registry-name FRESH -r RECIPIENT --data '{"name":"Ada"}' --out credential.cesr
tufa ipex grant --issue -n ISSUER_STORE -a ISSUER -r RECIPIENT \
  --credential credential.cesr --timeout 60
tufa ipex setup -n RECIPIENT_STORE -a RECIPIENT --said GRANT --timeout 60
```

The issuer sends the pending Grant and retries the same signed DH query until
recipient setup approves that exact Grant. A direct HTTP 403 for that query keeps
the bounded wait active; other delivery failures propagate. Retry preserves the original query,
keys and Grant deadline. DH completion supplies the existing encrypted root to
wallet authoring; the issuer anchors an issued BUP and sends accepted public
KEL/TEL evidence. Both commands finish the same Grant. `setup` creates no held
inventory or Admit. After reviewing acceptance, admit separately with
`ipex admit --acdc-v2 --consent --said GRANT`.

Optional `--artifact FILE...` supplies exact authenticated far-node streams, and
`--plan`/`--prior` retain existing disclosure/DI2I checks. `--out FILE` prepares and
writes the signed pending Grant plus public support without starting DH; later
`--resume GRANT` selects those same retained bytes within their original lifetime.
Recipient `setup --input FILE` can ingest that evidence before explicit approval.
Timeouts abandon local operation state; there is no persistent DH restart or replacement-root recovery.

Group issuance uses the same fresh body and pending Grant, with each invocation
selecting the accepted `--coordinator EVENT_SAID` and its elected `--custodian MEMBER_AID`. Every member explicitly selects the exact Grant proposal; ordinary
signature thresholds still gate the Grant and DH messages. Only the elected
member derives and retains the root. Group/member mailbox routes or all selected
controller endpoints must deliver the peer query to every recipient member.

```sh
# Issuer custodian prepares the exact proposal file before waiting for members.
tufa ipex grant --issue -n ISSUER_LEAD_STORE -a ISSUER_GROUP -r RECIPIENT_GROUP \
  --credential credential.cesr --coordinator ISSUER_EVENT --custodian ISSUER_LEAD \
  --proposal-output proposal.cesr --proof-output final-proof.cesr --timeout 120
# Other issuer members select that file and the printed Grant SAID.
tufa ipex grant --issue -n ISSUER_PEER_STORE -a ISSUER_GROUP -r RECIPIENT_GROUP \
  --resume GRANT --proposal proposal.cesr --coordinator ISSUER_EVENT \
  --custodian ISSUER_LEAD --timeout 120
# Each recipient member explicitly runs setup against the delivered pending Grant.
tufa ipex setup -n RECIPIENT_STORE -a RECIPIENT_GROUP --said GRANT \
  --coordinator RECIPIENT_EVENT --custodian RECIPIENT_LEAD --timeout 120
```

The issuer contributor returns after its DH query contribution. It must then
separately review and approve the proposed BUP with the existing `multisig join`
command; DH setup does not authorize that registry update. The issuer custodian
waits for that approval and writes `final-proof.cesr`, containing accepted public
evidence and the exact original Grant with its issued opening. After BUP approval,
each departed issuer contributor explicitly verifies that file:

```sh
tufa ipex setup -n ISSUER_PEER_STORE -a ISSUER_GROUP --said GRANT \
  --coordinator ISSUER_EVENT --custodian ISSUER_LEAD --proof final-proof.cesr
```

Recipient members remain live through reply contribution and proof delivery.
Rootless members verify the original issuer authentication and appended opening;
they do not claim root custody or run root-dependent DH finish. All phases retain
the original Grant deadline, and acceptance still requires a separate explicit
`ipex admit --acdc-v2 --consent --said GRANT` to record held inventory. A group
`grant --issue --out FILE` prepares only the exact proposal, for explicit later
`--resume GRANT --proposal FILE`; it does not persist an ephemeral DH session.

`ipex unblind --opening FILE --said CREDENTIAL --states '["issued"]'` tests an
explicitly possessed opening UUID against candidate states; optional `--out FILE`
writes the matching raw opening tuple. A match does not establish accepted standing
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
same exact acceptance path. `vc create --acdc-v2 --prepare --out FILE` instead
writes only a schema-checked public body against a fresh accepted RIP, before any
custody or BUP work; it creates no issued inventory. All four authoring commands accept `--witness-gvrsn 2`
for the known v2 witness profile; the default remains 1.0. Legacy commands retain
their existing defaults.

Provision explicitly with inception's `--with-custody`. The selected issuer
habitat retains its Salt128 root in the encrypted authenticated Keeper. AEID
replacement rewraps the root atomically; retained roots prevent disabling
encryption. Derived state commands accept `--bound-event` for an exact witnessed
Issuee event. IPEX `--derive` requires the selected sender's custody and retained
exact event coordinates. Missing coordinates refuse disclosure even if the Keeper
root survives wallet loss. Fresh individual DH issuance uses the `grant --issue`
and `setup` flow above; explicit existing-root transfer uses the registry root
commands below. Network Unblind remains separate work; group DH uses the finite member phases
above, and ordinary group authoring retains its explicit approval workflow.

ACDC v2 success JSON follows exact anchored acceptance and joined store cleanup.
A timeout or receipt failure leaves protocol staging for explicit retry; retrying
uses the same already signed KEL seal rather than making another anchor. Ordinary
registrar replay distributes public evidence; ACDC v2 authoring does not revive
historical `upd`, use TEL backers, or claim peer delivery from local acceptance.
