# Native-v2 ACDC and registry roadmap

Status: deferred from the 2.0.0 release on 2026-10-20 by explicit scope decision.
KERIpy `rip`, `bup` and `upd` implementation is being completed separately.
No completion date or package version is promised here. This roadmap owns the
remaining native-dependent work formerly tracked as R2 native and cuts 25–30,
and native interoperability cases N1–N3 in the release plan.

## Re-entry gate and current capability

Resume only after inspecting the completed reference implementation, selecting
and freezing an explicit full commit, and proving its actual supported intake,
validation, persistence, recovery and replay entrypoints. The current reference
remains `c7e74adc3129ba36302db32e58056560b0927424`; this deferral does not advance it.
Reconcile `rip`/`bup`/`upd` semantics and supported disclosure/binding forms before
implementing dependent CLI behavior. Do not port incomplete reference behavior,
patch Python for a passing test, or infer wallet acceptance from proof verification.

Retain merged native library/runtime work, including #627 ordinary intake and
reopen/API proofs, as partial capability. Those checks do not establish a complete
native registry or credential lifecycle. Existing relevant regression tests remain;
new native feature development and completion gates are deferred. Known failures
must remain visible with their pin and claim boundary, never relabeled as passes.
Independent legacy TEL/backers and KERI/CESR v2 work remain in the release plan.
The legacy verifier application move is independent and remains required for 2.0.0.

## Contract and evidence preparation

**Native proof: freeze claims before broad CLI authoring.** #627 proves the
first two registry-evidence directions below against main through ordinary TS HTTP
intake, reopened TS state and Python vet/vetBinds. Native IPEX/wallet and CLI custody
claims still require their separate gates. Use the maintained
registry/disclosure/IPEX helpers against unmodified main. The minimum contract is:

| Direction                   | Concrete entrypoint and observable result                                                                    | Release claim                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Python native evidence → TS | Python `acdc.messaging.regcept/blindate` and `Blinder.blind`; TS ordinary intake/import and RegistryObserver | Accepted native registry/disclosure state survives TS reopen. No custom `/_registry` endpoint or accepted-row seeding.       |
| TS native evidence → Python | Python `acdc.regeventing.vet` and `vetBinds`, using independently accepted KEL anchors                       | Independent chain/disclosure/binding verification; not a Python wallet or durable registry acceptance claim.                 |
| Python IPEX → TS            | Python `acdc.ipexing.grant/admit` builders; TS public IPEX intake/commands                                   | Accepted EXN plus the separately asserted TS credential/disclosure state and reopen.                                         |
| TS IPEX → Python            | Python parser/Exchanger with native IPEX handlers; inspect accepted `exns` and the handler's actual result   | Accepted exchange/proof verification only; application wallet receipt/reopen/use requires separate demonstrated entrypoints. |

Inspect the exact API signatures at the execution pin and run the smallest live
round-trip before calling these rows proven. Record missing capability as a narrow
claim boundary, not an optional silent pass. R2 may supply the minimal production
intake needed for its proof; broaden it in cut 25. PR 31 reuses these first proofs.
Ordinary native CLI examples/interoperability use the common I2I/NI2I/E1E and AND/OR
subset. Existing DI2I and bounded NOT semantics remain explicitly TS-only until
independent Python support is demonstrated; no negotiation framework or deletion.

Bind native event/disclosure evidence to the exact outer approval EXN and payload
SAIDs before local signing. Persist the association, validate the business
relationship and exact anchor, and disclose openings only to authorized recipients.
Mixed-language KEL approval alone does not prove native business-policy approval.

For native preparation, retain original event bytes/SAID, registry/prior/ordinal,
credential identity, disclosure opening and authorized recipient association in a
narrow typed LMDB record. Persist this preparation **before** `processEvent` stages
it, or atomically with staging in the same environment. Refactor `blindTarget`'s
current stage-then-return order accordingly. Recovery looks up the original SAID
and resumes staging/anchoring without generating another nonce. No cross-store
atomicity claim: KEL anchoring follows durable preparation. One interruption/reopen
case at this boundary must prove identical event/opening recovery. No archive or
generic workflow framework. Finish these concrete contracts before broad features.

## Cohesive implementation cuts — former cuts 25–30

**PR 25: production intake and recovery.** Compose the existing RegistryObserver
into ordinary parsed runtime ingress for `rip`/`bup`, sharing the correct public
KEL and native registry store. Keep its validation separate from legacy Tevery.
Give missing inception/anchor/order dependencies explicit progression on relevant
input and after reopen, discovering foreign registry work from durable escrows
without requiring local aliases. Preserve source-seal hints and verify them
against accepted, witnessed KEL evidence. Preserve injected/owned/readonly store
lifetimes. Provide native registry replay/export through existing input/output
paths. Remove the need for a custom `/_registry` HTTP branch or direct
accepted-row writes in feature tests.

**PR 26: explicit composition and persisted disclosure state.** At command
composition, select legacy or native-v2 owners explicitly. Proposed input is
`--protocol v1|v2` for registry/credential authoring and any ambiguous store
selection; do not infer body version from package version or `--gvrsn`.
Keep `vdr.rgy` and `acdc.rgy` concrete. No generic registry adapter or service bag.

Retain the exact credential, event and authorized disclosure opening needed
after restart; the blinded event alone cannot recreate an opening.
Reuse evidence stores where their contracts fit; keep local disclosure custody
separate from public registry rows, using a narrow typed owner for missing
records. Do not expose openings in routine logs or broadcast undisclosed
credential content.

Distinguish prepared/staged, anchored and accepted state in command output.
Persist preparation before anchor coordination and recover deterministically
across separate KEL/registry environments; do not claim a cross-database atomic
transaction. Never generate a new nonce/event on a resumed operation.

**PR 27: single-identifier native authoring.** Expose native registry inception,
credential construction/issuance, revocation/state changes, list and status using
existing `regcept`, credential builders and `Registry.blind`. `vc create --protocol v2` constructs and issues; `vc revoke --protocol v2` commits the native
`revoked` state. Validate schema, issuer, registry and disclosure inputs before
local signatures or durable creation. Complete real KEL anchoring, witness
obligations and evidence publication.

Export/import genuine-v2 credentials, accepted registry chains, necessary KEL
evidence and authorized disclosure material through ordinary CLI/runtime intake.
A staged body or local alias is not an accepted chain. Preserve ordering and
original signed bytes. Use explicit export/replay to a fresh receiver; this does
not add subscriptions, automatic freshness guarantees or a synchronization service.

**PR 28: group authoring.** Reuse standard `/multisig/ixn` or `/multisig/rot`
approval for the exact `rip`/`bup` anchor seal. Distribute the corresponding
native event and authorized support separately; members validate its identity,
schema/state relationship and anchor before signing. Reuse group KEL authority,
threshold and witness completion; keep native registry acceptance with its
existing engine. Do not invent `/multisig/rip` or overload legacy VCP/ISS/REV.
Resumption selects the original proposal and retained opening after a member
has already consumed its notification.

**PR 29: native IPEX.** Select the native proof-building and verification owners
for all six CLI IPEX verbs. Openers select their protocol explicitly; responses
derive it from the accepted predecessor and reject a contradictory flag.
Grant/admit must use native accepted-chain
and disclosure evidence, not legacy `iss`/`anc` assumptions. Distinguish EXN
acceptance from credential wallet acceptance and prove both. Persist received
native credential/disclosure selection for later list/export/presentation;
accepting an EXN does not imply possession of an undisclosed full credential.
Keep recipient and group fanout behavior consistent with PR 16.

For native group IPEX, verify the existing v1 `/multisig/exn` coordination
envelope carrying a genuinely v2 child with its original nested evidence.
The inspected v2 nested-multisig contract permits only KEL/endpoint routes;
do not silently enable a v2 `/multisig/exn` wrapper. Body and attachment versions
remain independent and their admissible combinations require exact tests.

**PR 30: presentation and state changes.** Expose domain-named native operations
such as `vc registry blind --protocol v2 --said ... --state ...`,
`present --grant ...` and `vacate`, composing existing methods. Provide
presentation-registry creation and integrate presentation preparation into grant
orchestration. Complete holder/group presentation through its registry and anchor,
retaining the issuer's independent state-change semantics. Validate the referenced grant and
authorized holder before a CLI presentation commitment; library syntax checking
alone is insufficient. Presentations bind the grant and its receiver cutoff.
A vacuous update preserves the prior binding; it is not credential revocation.
Reuse supported disclosure/Mapper forms without adding new operators or porting
reference stubs. Cover supported command forms with focused owner tests.

## Bounded peer confidence — deferred N1–N3

Reassess these scenarios against the newly pinned implementation before execution.
Use maintained helpers, independent stores and actual public CLI/API intake. Keep
happy paths and only justified negatives; no Cartesian test matrix. An altered
child/anchor proof must not become an accepted credential. Preserve interruption/
reopen coverage for disclosure preparation and original event/opening identity.
Do not claim Python wallet persistence from `vet`/`vetBinds` or EXN acceptance.

| Case                                   | Happy path                                                                                                                                                                                                                                                | Independent evidence                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1: native CLI lifecycle               | Independent Tufa group issuer/holder/protocol-observer stores complete registry inception, issue, IPEX delivery/admit, presentation, vacate and issuer revocation. Use one ordinary and one establishment-only anchor, with a reopen before presentation. | Real Python witnesses/mailbox where those roles are implemented; Tufa public commands and ordinary ingress, without the custom registry endpoint or direct row seeding. Use native vc import/list/status and protocol observer state after reopen; this excludes legacy-only tufa verifier run and proves CLI composition, not Python recipient parity. |
| N2: native evidence in both directions | Python authors native registry/credential evidence for ordinary Tufa import/intake; Tufa CLI authors genuine-v2 evidence for Python's implemented registry/disclosure vetting APIs.                                                                       | Unmodified pinned main, live Python construction/verification and independently owned state; assert body identity, authentic anchors, disclosed state and the exact R2 vet/vetBinds verification result; no Python wallet acceptance claim. No historical fixture-only pass.                                                                            |
| N3: native IPEX in both directions     | One representative grant/admit conversation in each direction using real Python v2 APIs, including a disclosed subset and presentation proof. Reuse N1's group CLI orchestration and existing verb tests.                                                 | Python-produced proofs are verified by Tufa; Tufa-produced nested proofs and grants are verified by Python. Assert recipient/credential state as well as transport/EXN completion, using the frozen R2 distinction between Python EXN/proof acceptance and TS wallet persistence.                                                                       |

The common I2I/NI2I/E1E and AND/OR subset remains the proposed interoperability
profile pending source verification. DI2I and bounded NOT stay explicitly TS-only
until demonstrated otherwise. Native `upd` behavior must be assessed explicitly
alongside `rip` and `bup`, including its callers and persistence/replay obligations;
do not assume the earlier cuts exhaust the completed reference contract.

Apply the release plan's ten constraints, SOLID, human-reviewable PR discipline,
minimal documentation and explicit breaking changes. Qualify the resulting feature
at its eventual release; 2.0.0 qualification does not prequalify this roadmap.
