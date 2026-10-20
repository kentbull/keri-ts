# Complete the coordinated 2.0.0 release

Status: active; checked against merged master `fa8c101a` (#622), 2026-10-20.
Approved goal: publish **cesr-ts 2.0.0, keri-ts 2.0.0 and @keri-ts/tufa 2.0.0**.

## Current state

**About 55% complete by estimated effort, not PR count.** Foundational refactors
and operator fixes are merged. Most credential lifecycle expansion and final
qualification remain. This estimate is not a release-readiness claim.

| Work                                                                       | Current disposition                                                                                                                                   |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design contracts and peer profiles (01–02)                                 | Merged #576–577; configurable Tholder caps accepted. Current pins below supersede original candidates.                                                |
| Protocol/transport ownership (03–06)                                       | Merged #578, #580–588; synchronous admission boundaries and removal of whole-protocol exclusion. Later query cuts supersede the original HTTP design. |
| Logging, strict URL config, init, AEID (07–12)                             | Merged #589–596.                                                                                                                                      |
| ESSR and database lifecycle (12a–12e)                                      | Merged #598–601 and #608; LMDB evidence, archive/staging/plaintext removal, explicit close failures, ordinary Baser OOBI cleanup.                     |
| Multisig reporting and messenger selection (13, 13a–13d)                   | Ownership/reporting merged #602, #604–605, #609, #611. Durable group selection/resume and lifecycle behavior remain below.                            |
| Query composition, legacy mailbox media and docs (19, 13e–13h2)            | Merged #612–618, including real bidirectional query evidence and command-owned cues.                                                                  |
| CLI ownership and finite bootstrap (13i–13j)                               | Merged #619–620. Oobiery/Authenticator terminal results own completion; no inferred query graph or requirement that unrelated escrows empty.          |
| CLI validation (13k)                                                       | In progress: lifecycle #621 and multisig #622 merged. Credential/IPEX/verifier next, then remaining command families.                                 |
| Credential lifecycle, backers, native-v2, verifier separation              | Not complete; acceptance criteria and order below.                                                                                                    |
| ProtocolProcessor assessment, package organization, qualification, release | Pending all implementation and feature interop.                                                                                                       |

#622 passed 65 focused exact-source Docker tests, static/package checks and
selected delegation interoperability. Those checks do not qualify the whole
release. The last broad checkpoint was #611; run another at roughly 20
implementation PRs, and fresh full qualification after the final changes.
Git/PRs own detailed history; this file owns current scope, order and gates.

## Scope and design decisions

- Preserve KERI/ACDC/CESR v1/v2 interoperability. **Old keri-ts APIs and private
  storage formats need no compatibility**: remove obsolete abstractions and
  document breaks rather than adding aliases, shims or migration readers.
- Required: complete multisig approval/fanout throughout CLI credential workflows,
  legacy TEL replay, actual group backer registries, native-v2 CLI authoring,
  disclosure/presentation, verifier separation and package organization.
- Deferred: generic delivery retries, durable outboxes, delivery acknowledgements,
  generic database providers and broad Python porting. Ordinary protocol escrows
  and recovery remain required. Direct legacy ESSR LMDB interchange is deferred;
  legacy wire interoperability is not.
- Apply [ten constraints](/Users/kbull/enc/enctx/adrs/ten-constraints.md), SOLID and
  [ADR-0013](../adr/adr-0013-simple-component-flows.md). Refactor responsibility
  before changing behavior. Prefer concrete owners and explicit dependencies;
  no runtime-shaped bags, callback schedulers or speculative frameworks.
- Semantic owners synchronously validate current state, commit and publish live
  state/cues. Do not hold writers across yields or restore a whole-protocol mutex.
  Independent processor instances/database writer locks do not cure stale decisions.
  Preserve causal child processing, proof unions and per-request mailbox authority.
- Poster waits observe an exact admission's transport outcome, not peer acceptance.
  Keep clocks at real time owners and joined cancellation/cleanup with both
  operation and independent cleanup failures preserved.
- Tholder `maxWeights`/`maxSithLength` remain configurable deployment caps, set
  before concurrent processing; they are not wire maxima or general memory budgets.
- ESSR follows pinned-main `Baser.essrs` ordered-set storage. Keep incoming and
  reconstructed digest validation separate; repeated/alternate fragment limitations
  are explicit, not silently repaired by custom storage. Preserve the local
  [upstream issue report](../reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md).
  No upstream submission is authorized.
- OOBI cleanup uses ordinary Baser loading and canonical pending `oobis` keys;
  accepted startup effects include habitat reload/cleanup. Missing databases fail.
  Unexpected close failures propagate; no reopen/delete after failed close and no
  command success before owned cleanup. Completed deletions are not rolled back
  by a subsequent close failure.
- Simplify policy-bearing nested/async ternaries when their owners change,
  especially IPEX recipient/approval selection. No blanket ternary ban or unrelated
  codec cleanup. Preserve offline-versus-network recipient semantics explicitly.

<a id="essr-storage-correction--pr-12e"></a>

ESSR cut 12e is complete in #608; the
[storage supplement](essr/ESSR_STORAGE_PARITY_PLAN.md) records its accepted scope.

## Reference profiles and evidence boundaries

The authoritative pins/dependencies are
[`scripts/ci/keripy-reference.json`](../../scripts/ci/keripy-reference.json):

| Lane                  | Repository               | Commit                                     |
| --------------------- | ------------------------ | ------------------------------------------ |
| Native/main           | WebOfTrust/keripy        | `424a50c03421165c5f289e07a341bd57b8d8ab78` |
| Legacy 1.2.17         | GLEIF-IT/keripy          | `b8626e1d58770a4a480ea72a01acc5580278a9f2` |
| Legacy 1.3.x          | WebOfTrust/keripy        | `4ce4cc79e06653f77342be1bf604086b89b1f090` |
| Separate mailbox fork | Existing mailbox harness | `331f32e4de13cc5cb699587c5b1f1e5bc4468035` |

GLEIF 1.2.17 replaces the failing upstream 1.2.14 release gate; do not claim
1.2.14 passed. Verify actual interpreters/imports and freeze pins per run.
Native-v2 uses implemented main capabilities; legacy peers use their legacy lane.
Distinguish public CLI, real protocol/API intake, fixtures and full database
interchange. Missing environments and upstream defects are not passing evidence.

The [parity roadmap](PARITY_ROADMAP.md),
[compatibility inventory](../reference/compatibility/KERI_V1_V2_COMPATIBILITY.md)
and [qualification standard](qualification/QUALIFICATION_PLAN.md) retain their
own responsibilities. Historical unchecked boxes are not new implementation scope.

## Remaining review sequence

Cut labels are stable planning IDs, **not GitHub PR numbers**. Finish one cohesive
implementation PR before the next; split only for independent human review.

| Cut          | Remaining result                                                                                                                                                                                                                     | Depends on                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------- |
| 13k          | Validate credential/IPEX/verifier inputs, then remaining host/mailbox/challenge and command families; retain omission, explicit false/zero/empty lists and field-specific defaults. Reject malformed supplied values before effects. | #621–622                         |
| 13 remainder | Durable exact-event group selection/resume after notification consumption.                                                                                                                                                           | Reporting already merged         |
| 14           | Route or guard every group-capable command before effects.                                                                                                                                                                           | 13k, 13 remainder                |
| 15           | Complete group registry inception/issuance, approval and witness/TEL obligations.                                                                                                                                                    | 14                               |
| 16           | All six IPEX verbs: group initiation, approval, fanout and correct completion.                                                                                                                                                       | 15                               |
| 17–18        | Carry query wire context; legacy TEL replay and explicit unsupported downgrade.                                                                                                                                                      | Query composition already merged |
| 20           | Group revocation and independently observed revoked state.                                                                                                                                                                           | 15, 18                           |
| 21           | Accepted historical backer cohorts and durable accumulated partial proofs.                                                                                                                                                           | 20                               |
| 22           | Real TEL backer signing/collection through public hosting.                                                                                                                                                                           | 21                               |
| 23           | Explicit backer roster/threshold and group registry inception/rotation.                                                                                                                                                              | 14, 22                           |
| 24           | BIS/BRV, rotated cohorts and fresh-observer replay.                                                                                                                                                                                  | 18, 20, 23                       |
| 25           | Native-v2 public intake, dependency recovery and replay.                                                                                                                                                                             | Existing query ownership         |
| 26           | Explicit native CLI composition and durable disclosure custody.                                                                                                                                                                      | 14, 25                           |
| 27           | Single-identifier native authoring/state changes.                                                                                                                                                                                    | 26                               |
| 28           | Exact native anchors through group approval/fanout.                                                                                                                                                                                  | 15, 27                           |
| 29           | Native IPEX and wallet acceptance.                                                                                                                                                                                                   | 16, 28                           |
| 30           | Presentation and vacuous updates.                                                                                                                                                                                                    | 28–29                            |
| 30a–30b      | Narrow public protocol APIs if needed, then Tufa verifier application move.                                                                                                                                                          | 30                               |
| 31           | Close bounded actual-peer lifecycle evidence gaps.                                                                                                                                                                                   | All feature work                 |
| 31a          | Remove ProtocolProcessor if it has no justified cohesive responsibility.                                                                                                                                                             | 31                               |
| 31b–31d      | Organize CESR, KERI and Tufa sources, separate review per package.                                                                                                                                                                   | 31a                              |
| 32           | Exact 2.0.0 versions, changesets/changelogs, breaking guide and final qualification.                                                                                                                                                 | 31d                              |
| Release      | Authorized 1.0.0 withdrawal, then publish/verify CESR → KERI → Tufa 2.0.0.                                                                                                                                                           | All gates                        |

[CLI bootstrap supplement](runtime/CLI_BOOTSTRAP_COMPOSITION_PLAN.md) owns 13k
input details; 13i/13j are complete. The messenger, query, result-contract and
ESSR supplements describe merged designs, not extra pending implementation.

## Remaining feature acceptance criteria

### Group lifecycle — cuts 13–16 and 20

After PR 13d, typed send results expose `messages` with `exnSaid` and `payloadSaid`;
transport destinations remain distinct from approval/acceptance. Define a
public CLI selection/resume path for the exact VCP/ISS/REV from durable evidence,
independent of whether its notification still exists. Reuse the existing join
selection surface where it fits. Resuming must not re-prompt recorded approval,
construct another event or require accepted rows to be manually seeded.

PR 14 inventories every CLI entry point that selects, signs with or mutates a
group habitat: inception, interaction, rotation, delegation, endpoint roles,
credential commands, IPEX and ordinary commands accepting a group alias.
Each uses the appropriate group proposal/approval/fanout path, or rejects with
the correct supported group command before effects. In particular, verify
ordinary `interact`/`rotate` against their multisig counterparts; endpoint-role
commands already have explicit group handling. Raw contribution output must
identify partial evidence. Preserve existing KEL/delegation/endpoint approval
tests and add focused subprocess regressions for uncovered entry points.

PR 15 finishes existing VCP/ISS paths. Register the exact signed local wrapper
before transmission so returning proofs can recognize local approval. One
command-owned host runs the existing workers and observes accepted state.
Persist the actual protocol progression required across group anchor signatures,
witness receipts and TEL publication. Existing `tmse/tpwe/tede` definitions are
not proof that their lifecycle is implemented; inspect their real writers/readers.

Before local signing or KEL mutation, preflight the VCP/ISS group, issuer,
registry identifier, credential/schema validity, TEL event, source seal and
exact anchor relationship. This applies to both initiation and peer approval.
Reuse pure validation responsibilities; add no generic preflight framework.
Missing dependencies remain pending without signing. Malformed or inconsistent
proposals produce no new local signature, anchor or alias writes.

Assign completion to one concrete VDR owner. Restore no historical Registrar
facade by name; add a domain owner only for the demonstrated work. Do not mark
`ctel` complete at mere local TEL admission when group anchor/witness obligations
remain. Match reference completion semantics without describing fire-and-forget
TEL publication or local transmission as remote acceptance. Prove remote state
separately. Honor advertised establishment-only anchoring through rotation.

PR 16 applies group initiation to **apply, offer, agree, grant, admit and spurn**,
reusing existing wrapped-IPEX approval, group-index signing, threshold aggregation
and leader selection. Preserve verb-specific predecessors, parties, recipient
selection, support proofs and admit wallet acceptance. Member fanout, group
business acceptance and elected external delivery are separate facts.
Offline output must not label partial group evidence as a completed grant.
Preserve actual Poster partial-success diagnostics at CLI boundaries.

PR 20 extends VDR proposal approval with REV and uses the completed owner:

- Validate group membership, credential issuer, registry, prior TEL event and
  exact anchor relationship before a member signs.
- Aggregate proofs for the original event; duplicate approval/revocation does
  not create a replacement credential, another REV or another KEL anchor.
- Fan out to peers, then disseminate completed evidence to the issuee/selected
  recipients using their supported protocol lane.
- Prove holder/verifier revoked state through actual delivery or fresh replay.
  Old issuance or stale TSN replay must not revive a revoked credential.

This phase completes the legacy no-backer baseline, including ordinary and
establishment-only anchors, single/group counterparties and witnessed operation.
The required backer phase extends that same lifecycle with separate TEL backer
evidence; the required native-v2 phase supplies genuine-v2 CLI authoring.
Do not treat success in this baseline as completion of either expansion.

Required adversarial/lifetime cases:

- Declined or unauthorized proposal produces no local signature or publication.
- Parent signatures cannot authenticate child events/credentials.
- Duplicate signature indices and foreign endorsements cannot satisfy thresholds
  or select leader; weighted thresholds do not require every member.
- Local-first and remote-first arrival, stale/mismatched anchors, changed group
  key state, late signatures and missing witnesses retain honest pending results.
- Restart after proposal receipt, approval before threshold, anchor before
  receipts, and TEL acceptance before publication. Resume the same protocol
  event from durable evidence through explicit command execution. Include a
  subprocess restart after notification consumption and resume using only the
  public CLI.
- Deadlines/cancellation join workers before stores close; no durable network
  outbox or new retry guarantee is added.
- Every participating member converges on the same accepted business state;
  elected external delivery is independently observed.

### Phase E: legacy replay and peer interoperability — PRs 17–19

PR 17 carries parsed attachment genus through `queryEnvelopeFromDispatch` into
the TEL query policy owner, preserving current emitted bytes. Keep body protocol
version, attachment genus and HTTP media type separate. Introduce no peer
capability registry or inferred protocol downgrade.

PR 18 selects replay framing from the actual request context. Genuine unselected
legacy requests receive v1-compatible attachment counters/source seals without
a v2-only selector. Explicit v2 contexts retain v2 framing. Direct library
callers select their intended wire settings explicitly. Reuse `Reger.cloneTvt`
and known semantic attachment conversion; preserve raw signed bodies, SAIDs,
signatures and source-seal meaning.

Reger currently treats requested genus as a floor. A v1 request for an event
whose signed body or proof requires v2 must receive an explicit unsupported
outcome; do not silently raise the floor and call it v1 compatibility. Missing,
opaque or unmappable proof material must never be rewritten into plausible wire.
Preserve replay horizons, order, lazy reads and cursor cleanup.

Define refusal at the replay owner: incompatible later evidence may be discovered
after a valid prefix has been sent. Return a typed unsupported outcome and
terminate the stream without reporting completion; preserve any prefix the
receiver already accepted. Preflight available metadata when sufficient, but
do not eagerly materialize every body merely to hide this streaming boundary.
Test incompatibility both at the first event and after a valid emitted prefix.

### Phase F: real group backer registries — PRs 21–24

**PR 21: accepted cohorts and accumulated evidence.** Extract the narrow
backer-state selection responsibility before changing admission. Resolve
`ra.i/ra.s/ra.d` against accepted registry management evidence, not a raw or
escrowed body. VCP uses its validated initial roster; VRT uses its validated
rotated ordered roster and threshold; BIS/BRV use their exact historical
management tuple. Reuse existing signature verification and merge valid proofs
by unique index. Retry and reopen partial-witness `twes` evidence; repeated
bodies may contribute missing proofs without reapplying business state.
Preserve earlier valid contributions instead of replacing `tibs`.

**PR 22: real backer participation.** Add one concrete backer-operation owner,
composed with explicitly hosted nontransferable backer signers, the parser,
existing endpoint resolution and Poster/messengers. It validates the exact
event, issuer anchor, registry history and its authorized index before signing.
Expose activation through the existing agent/witness hosting CLI composition,
with an explicit selected backer AID and role; do not auto-host or sign as every
local Hab. Use the established listener and endpoint ownership. B1 must launch
backers through this public command, not a test-only service constructor.
Eligibility to endorse is separate from observer acceptance: requiring a full
backer threshold before producing a contribution would deadlock the workflow.
Do not bypass verification by globally enabling local processing.

Use the existing wire: original TEL body, indexed backer signatures
(`WitnessIdxSigs`) and issuer source proof (`SealSourceCouples`), in the selected
CESR genus. Both parsers already deliver these to Tevery. Add no new receipt
message or KEL `rct`. Collect verified contributions, then disseminate the
threshold-complete evidence. Persist received evidence and protocol progression;
delivery retries/outboxes remain outside scope.

**PR 23: backer policy and management.** Replace the inadequate boolean-only
input with explicit ordered backer roster and threshold input, retaining a
clear no-backer choice. Add registry rotation with cuts/additions/threshold.
Validate the proposed policy before effects and display the policy change for
group approval. Remove the group-backers rejection only when the actual receipt
path is available.

There is no inspected standard `/multisig/vrt` handler or Python registry-rotation
CLI. Use existing `/multisig/ixn` or `/multisig/rot` approval for the exact issuer
anchor, with the VRT evidence supplied separately and verified before signing.
Prove the binding between both parts. Do not invent a TS-only route and label
it Python CLI compatibility. Keep establishment-only anchoring distinct from
registry management rotation.

**PR 24: issuance/revocation and completion.** Select BIS/BRV from accepted
registry mode and historical management state. Existing issuance/revocation
coordination must validate the actual embedded ilk and relationships. Complete
three separate obligations: group authority over the issuer anchor, required
issuer KEL witness evidence, and TEL backer quorum with completed dissemination.
None alone establishes remote acceptance.

Exercise a nonempty roster and a real threshold, change the backer roster
between issuance and revocation, then replay both states to a fresh observer.
The old event retains its original authorized cohort. Use existing protocol
tests for signature/ordering invariants; add focused regressions only for the
accepted-coordinate and partial-proof bugs and the new concrete owner.

Inspected Python main, 1.2.x and 1.3.x do not automatically produce TEL backer
receipts; their Tevery comments disable that cue path. Python Registrar's
witness progression does not implement it. Qualify TS backer services against
real Python observer intake. A helper invoking the unmodified Python signer
can independently produce proof bytes, but must be labeled a Python API driver,
not a native autonomous backer service.

### Phase G: native-v2 credential CLI — PRs 25–30

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

### Verifier application ownership — PRs 30a–30b

Implement the accepted [Tufa verifier separation supplement](credentials/TUFA_VERIFIER_SEPARATION_PLAN.md)
after credential features, before the actual-peer matrix, final ProtocolProcessor
assessment, package organization and qualification. Recheck its inspected paths
and exports against the completed feature work; skip an empty export PR if those
operations are already public. The supplement's original planning-only status is
superseded by Kent's instruction to include it in this execution goal.

**PR 30a** exposes only existing reusable IPEX evidence operations, the grant route
constant and the necessary transitional CLI parser through appropriate public
entrypoints. Keep semantics unchanged and verify installed declarations and the
browser-safe root. Do not add APIs merely to preserve an obsolete facade.

**PR 30b** moves the Sally-style application, cue store and command atomically to
Tufa, splitting workflow sequencing, business policy and webhook delivery into
cohesive units as the supplement specifies. Remove original files and keri-ts
application exports in the same PR; no re-exports, compatibility shims, sibling
source imports or new dependency containers. Protocol Verifier, KEL/TEL/native-v2
validation, accepted evidence, escrows and reusable IPEX operations remain in
keri-ts. Tufa depends on public keri-ts APIs; never reverse that dependency or
retain ProtocolProcessor solely for this consumer.

Preserve current command and application behavior during relocation, including
its explicit legacy-Reger profile. This move does not add native-v2 application
verification, Sally parity, delivery guarantees, retries or durable outboxes.
Existing local webhook delivery markers are application records, not KERI
acknowledgements. Reproduced behavior defects justify a separately reviewed
follow-up, not silent semantic changes during the move. Apply the close contract:
the command owns its cue store and closes it before runtime/Habery; overall
success follows required cleanup.

Move the existing five agent cases and real issuer/holder/verifier CLI workflow
without reducing topology. Retain protocol tests in keri-ts. Include one saved,
protocol-valid credential refused by business policy without a webhook or change
to protocol validity, one unsuccessful HTTP delivery and a focused cleanup-failure
case. Update suite ownership, Tufa nested-test checking and maintained execution
tasks with the move; do not leave deleted test paths or duplicate runs. This local
CLI workflow is not a Python interoperability test. Run established peer cases
only if shared protocol behavior changes.

Installed coordinated tarballs must prove public imports/declarations, the Tufa runtime API and real cue-store lifecycle,
and one `tufa verifier run --once` issuance to a loopback webhook. Preserve package
build guards against bundled sibling source and direct native LMDB dependencies.
Record removed APIs and replacement imports prominently in the 2.0.0 migration
guide/release notes. Broad final qualification follows this move and all remaining
implementation and organization work. Old keri-ts APIs and private formats impose
no compatibility requirement; preserve protocol interoperability and document
intentional breaks.

### Phase H: bounded actual-peer confidence — PR 31

Kent explicitly requested sufficient happy-path interoperability with limited,
justified sad paths. Build a small scenario set, reusing maintained helpers and
existing tests; do not multiply every feature by every transport, threshold,
runtime and Python version. Use HTTP for the new end-to-end cases; retain the
existing transport suite for TCP/lifetime coverage.

The additions have five scenario families, not a Cartesian product:

| Case                                        | Focused happy path                                                                                                                                                                                                                               | Independent interoperability evidence                                                                                                                                                                                                                                |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| N1: native CLI lifecycle                    | Independent Tufa group issuer/holder/verifier stores complete registry inception, issue, IPEX delivery/admit, presentation, vacate and issuer revocation. Use one ordinary and one establishment-only anchor, with a reopen before presentation. | Real Python witnesses/mailbox where those roles are implemented; Tufa public commands and ordinary ingress, without the custom registry endpoint or direct row seeding. This proves CLI composition, not Python recipient parity by itself.                          |
| N2: native evidence in both directions      | Python authors native registry/credential evidence for ordinary Tufa import/intake; Tufa CLI authors genuine-v2 evidence for Python's implemented registry/disclosure vetting APIs.                                                              | Unmodified pinned main, live Python construction/verification and independently owned state; assert body identity, authentic anchors, disclosed state and accepted state where the API actually accepts events. No historical fixture-only pass.                     |
| N3: native IPEX in both directions          | One representative grant/admit conversation in each direction using real Python v2 APIs, including a disclosed subset and presentation proof. Reuse N1's group CLI orchestration and existing verb tests.                                        | Python-produced proofs are verified by Tufa; Tufa-produced nested proofs and grants are verified by Python. Assert recipient/credential state as well as transport/EXN completion, labeling any narrower Python proof-verification result accurately.                |
| B1: group-backed lifecycle to Python        | Tufa group issuer uses separate real backer processes with a nonempty roster and meaningful threshold: VCP -> BIS -> VRT -> BRV. Rotate the roster between issuance and revocation, then replay to a fresh Python observer.                      | Run the same compact verifier case against main, 1.2.x and 1.3.x; each parses original TEL plus real backer/source proofs and reaches issued then revoked state. Assert the historic management tuple as well as the final status.                                   |
| B2: Python-produced backed evidence to Tufa | Python's real constructors/signers produce a short VCP/BIS/VRT/BRV chain; ordinary Tufa CLI/runtime ingestion reaches matching accepted/revoked state.                                                                                           | Reuse the three pinned profiles and their genuine crypto/parser APIs, with no TS-built fixture substituted for Python output. A minimal API driver is allowed; it must not patch reference code, preaccept rows, or claim to be an autonomous KERIpy backer service. |

Use only a few targeted failure checks for this expansion:

- One altered child/anchor proof must not become an accepted native credential.
  Reuse an existing real-verifier regression if it already exercises the new path.
- Withhold one required backer contribution, observe honest pending state, reopen
  and deliver it; the same event must complete. This also checks the concrete
  partial-proof recovery bug without a separate broad failure matrix.
- Keep the accepted-management-coordinate regression local to Tevery; raw or
  escrowed management evidence must not authorize a historical backer cohort.

Existing threshold, duplicate-index, wrong-signer, cancellation and ordering
tests remain relevant; do not reproduce all of them as new multi-process interop
scenarios. Add another negative only for a newly demonstrated defect.

Native-v2 evidence uses main. The old peer profiles are tested on their legacy
lane, without attempting to downgrade native credentials. At the inspected main
pin, Python's production parser still rejects nonempty ACDC ilks and its native
KLI path is incomplete. Use actual supported APIs for N2/N3 and report exactly
which operations are proof verification versus full receiver acceptance.
Recheck that limitation at the execution pin. Do not patch Python or seed its
accepted registry rows to make a nonexistent foreign-intake path appear complete.
TS public intake and CLI composition must pass regardless of that upstream gap.
This is a documented interoperability boundary, not permission to skip an
implemented Python capability or count an unexecuted assertion as passed.

PR 31 closes the actual-peer matrix, using public CLI/protocol intake and
independent stores rather than seeding accepted rows:

| Scenario               | Required evidence                                                                                                                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native peer identities | Unmodified main, GLEIF 1.2.17 and selected 1.3.x execute with verified imports; the mailbox fork remains separate.                                                                                                                                        |
| TEL both directions    | TS-generated v1 evidence accepted by each peer; peer-generated issuance/revocation accepted and replayable by TS.                                                                                                                                         |
| Late observer          | Fresh state obtains issuer KEL, registry and credential TEL, reaches issued then revoked, reopens and remains revoked.                                                                                                                                    |
| Wire combinations      | All three peer families accept supported v1 body/v1 genus. Main/TS exercise supported v1 body/v2 genus and genuine v2; 1.2/1.3 unsupported-v2 rejection is a negative test, not an expected acceptance cell. Unsupported downgrade is explicitly refused. |
| Transport              | Actual HTTP and supported TCP paths; old witness-mailbox polling, not only standalone fork-mailbox APIs.                                                                                                                                                  |
| Multisig roles         | TS proposer/Python approver and Python proposer/TS approver where actual reference commands exist; independent member stores.                                                                                                                             |
| Complete lifecycle     | Registry -> issue -> apply/offer/agree/grant/admit -> revoke -> holder/observer revoked state; separate spurn path.                                                                                                                                       |
| Threshold/topology     | Existing single/group directions, witnessed/delegated setups and a weighted threshold with a non-required absent member.                                                                                                                                  |
| Negative/recovery      | Tampered or missing child proof, wrong issuer/anchor, duplicate indices, partial signatures, hostile ordering, restart and stale replay.                                                                                                                  |
| Operator/store         | Config no-write failures, cleanup Python reopen, encrypted-store compatibility and initialization intent.                                                                                                                                                 |

Python-main apply/offer/agree CLI files and some group-join recipient handlers
are stubs at inspected references. Test real Python protocol ingestion for
those lanes and actual KLI commands where implemented. Label CLI, protocol and
fixture evidence separately. Do not patch the reference silently, claim full KLI
command parity from TS-only tests, or make a TS feature imitate an upstream stub.
Any required lane blocked by a genuine reference defect must be reported with
its exact source and reproducer; do not count it as passing.
The broad negative/recovery row above is an existing regression boundary, not a
request to multiply the five added interop families. Preserve its current useful
coverage and add only the limited cases justified here.

## Final ownership assessment and organization — cuts 31a–31d

After feature code and interop, remove ProtocolProcessor if explicit dependencies
suffice; retain only a demonstrated cohesive dispatch responsibility. No empty
refactor if earlier work already achieves this.

Organize each package by change-together responsibilities, especially crowded
app/CLI modules. Use KERIpy categories where useful, but let actual dependencies
and human navigation decide. Split large files at real responsibility boundaries;
no file-count quotas, new published packages, wildcard barrels or old-path shims.
Keep behavior changes separate from moves. Update imports, test ownership, DNT
export discovery and builds together; provide a short category map in each PR.
Verify affected integration, packed entrypoints and strict NodeNext declarations;
rerun peer paths when their composition changes. Full qualification comes afterward.

## Review and validation discipline

- One reviewable implementation PR at a time, with an appropriate changeset,
  concrete before/after description, relevant reference source and honest limits.
  Keep maintainer docstrings useful; no per-PR reports or play-by-play docs.
- Run focused owner tests first; preserve real participant topology and independent
  crypto/storage oracles. No tests/lint proving discarded ideas stay absent.
- Use [PR test scope](../reference/PR_TEST_SCOPE.md): exact-commit local credit only
  for checks actually executed, relevant interop/package CI, and required static
  checks. Broad checkpoint about every 20 implementation PRs; final suite required.
- Run native LMDB tests in Docker named volumes, not host/bind mounts. Follow the
  workspace KERIpy test skill for Python execution. Repair environment failures;
  never mask them by changing behavior or calling an unexecuted assertion passed.
- Preserve existing threshold, cancellation, proof, restart and hostile-ordering
  regressions. Add limited negatives for actual new risks, not Cartesian matrices.
- After final workspace mutations, run prescribed ENCTX maintenance and require
  healthy/no stale sources. Never silently alter index selection.

## Final qualification and release — cut 32

1. **Prepare exactly 2.0.0 for all three packages.** Consume accumulated changesets
   into changelogs before deleting notes. Reconcile manifests, Deno mirrors, npm
   lock entries, generated modules and internal dependencies using manifest/version
   checks. Preserve prior release history. Version preparation does not publish.
2. **Finish breaking-change documentation.** Audit final supported APIs, exports,
   CLI/configuration, ownership/runtime requirements and storage/encryption changes
   against published 1.0.0 artifacts. Complete
   [MIGRATING_TO_2_0.md](../reference/compatibility/MIGRATING_TO_2_0.md) by package,
   with replacement/action and concise examples where useful. Include removed
   ESSR APIs, verifier move and any supported import changes. Put concrete
   **Breaking changes** prominently in each changelog and GitHub release, linking
   the version-pinned guide. Don't invent breaks merely for coordinated versioning.
3. **Qualify the final clean source.** Run the complete maintained CESR/KERI/Tufa
   and actual-peer matrix after all features, ownership and organization changes.
   Include required manual delegation/witness endurance; prior qualification's
   exclusions do not silently carry forward. Maintainer-only hosted dispatch still
   follows its explicit authorization rule.
4. **Qualify exact packed artifacts together.** Test declared Node minimum
   (currently 20.3; verify final metadata), selected current Node, established
   platform profiles and source Deno. Prove strict NodeNext without skipLibCheck,
   crypto/tamper refusal, CLI/HTTP, real TCP and >16 MiB LMDB read/reopen/owned bytes.
   Install compiler tools after runtime smoke. Record tarball digests. Workflow
   rebuilds must be identical or qualified before publication. Repairs require
   relevant retesting; shared protocol/runtime changes may require the broad suite.
5. **Inventory distributions at the release boundary.** Verify reviewed version
   preparation, clean synchronized master, exact release commit, live npm versions,
   dist-tags/dependencies, GitHub release/tag/asset identities and other actual
   publication surfaces. Keep bot release PR #527 gated until this work completes.
6. **Withdraw exact 1.0.0 distributions as previously authorized.** Recheck platform
   policy/eligibility; low downloads alone are insufficient. npm: unpublish only
   exact versions if allowed, otherwise deprecate with upgrade notice (Tufa → KERI
   → CESR dependency order). GitHub: record targets, then remove verified 1.0.0
   releases/assets and their `tufa-v1.0.0`, `keri-v1.0.0`, `cesr-v1.0.0` tags.
   Withdraw/yank only confirmed matching artifacts elsewhere. Do not delete entire
   package histories, rewrite source history, reuse tags or republish 1.0.0.
   Record absent surfaces, platform retention and partial outcomes accurately.
7. **Publish CESR → KERI → Tufa.** Explicitly push each annotated package-v2.0.0
   tag at the same qualified commit using existing workflows. Verify each registry
   artifact and dependency availability before publishing the next package.
8. **Verify actual publication.** Check npm metadata/dependencies/dist-tags,
   qualified/workflow/npm/GitHub artifact equality, clean registry-only installs,
   installed Tufa/native/runtime/declaration checks, GitHub notes/assets and
   version-pinned migration links. Verify exact withdrawal/deprecation outcomes;
   deprecation is not deletion. Recover failed side effects narrowly, never by
   replacing published bytes under an existing version.
9. **Report completion with evidence.** One concise report: package links,
   source/tag/artifact identities, peer pins, results/skips/limits, withdrawal
   outcomes, clean repository and healthy ENCTX. Do not claim completion while a
   required lane or release step remains.
