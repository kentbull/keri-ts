# Complete implementation and qualification for 2.0.0

Status: active; checked against merged master `b48c7dae` (#641), 2026-10-20.
Approved goal: complete the in-scope implementation, release preparation and final
qualification for **cesr-ts 2.0.0, keri-ts 2.0.0 and @keri-ts/tufa 2.0.0**.
**Publication is excluded from this goal** pending completion of the side-chat
plan. This goal may finish when all other required work and qualification pass.

## Current state

Foundational refactors, operator fixes and legacy VCP/ISS preflight/publication
are implemented, including weighted and witnessed CLI restart evidence. IPEX,
revocation, backer policy, verifier separation, organization and final qualification
remain. Selected feature checks are not a release-readiness claim.

| Work                                                                                   | Current disposition                                                                                                                                       |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design contracts and peer profiles (01–02)                                             | Merged #576–577; configurable Tholder caps accepted. Current pins below supersede original candidates.                                                    |
| Protocol/transport ownership (03–06)                                                   | Merged #578, #580–588; synchronous admission boundaries and removal of whole-protocol exclusion. Later query cuts supersede the original HTTP design.     |
| Logging, strict URL config, init, AEID (07–12)                                         | Merged #589–596.                                                                                                                                          |
| ESSR and database lifecycle (12a–12e)                                                  | Merged #598–601 and #608; LMDB evidence, archive/staging/plaintext removal, explicit close failures, ordinary Baser OOBI cleanup.                         |
| Multisig reporting and messenger selection (13, 13a–13d)                               | Ownership/reporting merged #602, #604–605, #609, #611. Durable group selection/resume and lifecycle behavior remain below.                                |
| Query composition, legacy mailbox media and docs (19, 13e–13h2)                        | Merged #612–618, including real bidirectional query evidence and command-owned cues.                                                                      |
| CLI ownership and finite bootstrap (13i–13j)                                           | Merged #619–620. Oobiery/Authenticator terminal results own completion; no inferred query graph or requirement that unrelated escrows empty.              |
| CLI validation (13k)                                                                   | Merged #621–624 and #631–632: lifecycle, multisig, credential/IPEX/verifier, host/mailbox/challenge, endpoint/DID/query and remaining operator utilities. |
| IPEX/revocation, backer lifecycle, verifier separation                                 | Not complete; acceptance criteria and order below.                                                                                                        |
| ProtocolProcessor assessment, package organization, qualification, release preparation | Pending all implementation and feature interop.                                                                                                           |

R1 is complete in #626: 33 exact-source Docker tests and selected static, ESSR,
IPEX/disclosure and mailbox gates passed. Main-native owners used `c7e74ad`; the
mailbox owner retained its separate fork. These checks do not qualify the whole release.
The last broad checkpoint was #631; run another at roughly 20 implementation PRs,
and fresh full qualification after the final changes.
Git/PRs own detailed history; this file owns current scope, order and gates.

## Scope and design decisions

- Preserve supported KERI/ACDC/CESR protocol interoperability within the
  explicit release profiles; native-v2 ACDC/registry expansion is deferred. **Old keri-ts APIs and private
  storage formats need no compatibility**: remove obsolete abstractions and
  document breaks rather than adding aliases, shims or migration readers.
- Required: complete multisig approval/fanout throughout CLI credential workflows,
  legacy TEL replay, actual legacy group backer registries, verifier separation
  and package organization. KERI/CESR v2 work independent of native ACDC stays required.
- Hosted backer comments/help and the pending release note are clarified in #636: optional
  legacy/v1-style TEL backing (`vcp`/`vrt`/`bis`/`brv`) supplies indexed backer-quorum
  endorsements, separate from issuer multisig approval and KEL witnessing.
  Native ACDC v2 `rip`/`bup`/`upd` registries do not use or require this mechanism;
  the event model does not identify a library, KERIpy or wire/genus version.
- Deferred native scope: all remaining work depending on native-v2 ACDC/registry
  `rip`/`bup`/`upd`, including CLI authoring, disclosure custody, native IPEX/wallet
  completion and presentation. The [native roadmap](credentials/NATIVE_V2_ACDC_REGISTRY_ROADMAP.md)
  retains the design and peer-test requirements pending completed KERIpy support.
  Keep merged partial capabilities and useful regressions; do not advertise them
  as a complete native lifecycle or silently count unsupported lanes as passed.
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
| Main reference        | WebOfTrust/keripy        | `c7e74adc3129ba36302db32e58056560b0927424` |
| Legacy 1.2.17         | GLEIF-IT/keripy          | `b8626e1d58770a4a480ea72a01acc5580278a9f2` |
| Legacy 1.3.x          | WebOfTrust/keripy        | `4ce4cc79e06653f77342be1bf604086b89b1f090` |
| Separate mailbox fork | Existing mailbox harness | `331f32e4de13cc5cb699587c5b1f1e5bc4468035` |

GLEIF 1.2.17 replaces the failing upstream 1.2.14 release gate; do not claim
1.2.14 passed. Verify actual interpreters/imports and freeze pins per run.
Main remains the reference for independent implemented capabilities; legacy peers
use their legacy lane. Native ACDC/registry completion is deferred to the roadmap.
Distinguish public CLI, real protocol/API intake, fixtures and full database
interchange. Missing environments and upstream defects are not passing evidence.

The [parity roadmap](PARITY_ROADMAP.md),
[compatibility inventory](../reference/compatibility/KERI_V1_V2_COMPATIBILITY.md)
and [qualification standard](qualification/QUALIFICATION_PLAN.md) retain their
own responsibilities. Historical unchecked boxes are not new implementation scope.

## Remaining review sequence

Cut labels are stable planning IDs, **not GitHub PR numbers**. Finish one cohesive
implementation PR before the next; split only for independent human review.

| Cut          | Remaining result                                                                                                     | Depends on                                            |
| ------------ | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| R1           | Complete in #626: historical IPEX seals and selected advanced-main qualification.                                    | This reconciliation                                   |
| R2           | Native partial proof #627 retained; hosted backer proof #629 complete. Native remainder deferred.                    | R1                                                    |
| 13k          | Complete in #621–624 and #631–632: strict command input validation.                                                  | R1                                                    |
| 13 remainder | Complete in #633–634 and #641: durable selection, proof reuse and interrupted-index replay.                          | Reporting already merged                              |
| 14           | Ordinary group guards/inventory merged #635; business workflows continue in 15/16/20.                                | 13k, 13 remainder                                     |
| 15           | VCP/ISS preflight, publication and CLI merged #637–639; witnessed restart proof #640. Final peer gates remain in 31. | 14                                                    |
| 16           | All six IPEX verbs: group initiation, approval, fanout and correct completion.                                       | 15                                                    |
| 17–18        | Carry query wire context; legacy TEL replay and explicit unsupported downgrade.                                      | Query composition already merged                      |
| 20           | Group revocation and independently observed revoked state.                                                           | 15, 18                                                |
| 21           | Complete in #628: accepted historical backer cohorts, accumulated partial proofs and retry/reopen.                   | R1                                                    |
| 22           | Hosted signing/collection merged #629; full group lifecycle evidence continues in 23–24.                             | 21, R2 backer slice                                   |
| 23           | Explicit backer roster/threshold and group registry inception/rotation.                                              | 14, 22                                                |
| 24           | BIS/BRV, rotated cohorts and fresh-observer replay.                                                                  | 18, 20, 23                                            |
| 30a–30b      | Narrow public protocol APIs if needed, then Tufa verifier application move.                                          | Legacy lifecycle; independent of deferred native cuts |
| 31           | Close bounded actual-peer lifecycle evidence gaps.                                                                   | All feature work                                      |
| 31a          | Remove ProtocolProcessor if it has no justified cohesive responsibility.                                             | 31                                                    |
| 31b–31d      | Organize CESR, KERI and Tufa sources, separate review per package.                                                   | 31a                                                   |
| 32           | Exact 2.0.0 versions, changesets/changelogs, breaking guide and final qualification.                                 | 31d                                                   |
| Preparation  | Prepare and qualify unpublished 2.0.0 artifacts; preserve 1.0.0 history.                                             | All gates                                             |

[CLI bootstrap supplement](runtime/CLI_BOOTSTRAP_COMPOSITION_PLAN.md) owns 13k
input details; 13i/13j are complete. The messenger, query, result-contract and
ESSR supplements describe merged designs, not extra pending implementation.
R1/R2 take precedence over their historical ordering and pin references.

## Early design and interoperability gates — R1/R2

**R1: historical seals and the new main baseline.** The manifest now selects
`c7e74ad` (upstream main checked 2026-10-20), which adds KERIpy #1733 to the old
`424a50c` pin. Its diff changes only IPEX verification/tests; dependency versions
are unchanged. Old-pin passes remain historical, not new-pin qualification.
Correct `ipex-v2.ts` evidence selection and outer source-anchor verification:
accepted historical KEL commitments survive subsequent rotations; attached
signature freshness remains independent. Verify the exact accepted event coordinate,
digest and grant anchor, preserving missing-evidence recovery. Add one live peer
anchor → rotate → deliver case and limited wrong-digest/unrelated-anchor negatives.
Re-run the maintained main-profile probes and affected IPEX/disclosure/KRAM owners;
retain old legacy/mailbox pins. Final qualification uses the manifest, not old
literal pins in reports or fixture provenance. Never relabel old results.

**R2 backer slice: define the signing contract before registry rotation.** Advance
cut 21 as its prerequisite: accepted cohorts, proof accumulation and partial-backer
retry must be reliable before the service uses them. Then settle a small concrete service contract in the owning design/source:

- The issuer selects the ordered backer AIDs explicitly. Resolve each AID through
  existing signed endpoint roles/locations; use a supported controller or authorized
  agent endpoint, not a new `backer` protocol role. Specify how the issuer return
  destination is authenticated and how the contribution reaches its ordinary intake.
- A hosted nontransferable backer checks event digest, issuer anchor, accepted
  management history, its roster index and authorization before endorsing. It must
  not require the quorum it is helping form. No global local-processing bypass.
- Persist its own event coordinate/digest and indexed contribution in the existing
  TEL evidence model where possible. Commit the endorsement before transmission;
  duplicate input reuses it after restart. Inspect whether existing rows enforce
  one digest per coordinate; add only a narrow record if they cannot. Refuse a
  conflicting endorsement, without pretending this prevents issuer duplicity.
- Prove one real hosted backer/issuer path into Python Tevery observer acceptance
  before cuts 23/24. Withhold a required contribution, reopen, then complete the
  same event. Include one conflict case for the chosen signing contract. This
  starts B1/B2 using existing helpers; it is not an additional harness or an outbox.

**Legacy VRT approval contract, before cut 23.** Bind the separate VRT evidence
to the exact outer proposal EXN and issuer anchor payload before local approval.
Persist evidence and its association; notification presence is not authority.
Members obtain the original evidence, validate the management policy and anchor,
then sign. Missing evidence stays pending. Python ixn/rot approval alone proves
KEL approval, not credential-aware business review. Native signing/disclosure
custody contracts and proofs are retained in the deferred native roadmap.

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

Split cut 16 for human review: first return typed CLI results and move final
presentation to Tufa; then clarify shared group approval/publication ownership;
then enable the conversation verbs and credential grant/admit settlement. Keep
signing, wire and acceptance changes separate from the ownership cuts.

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
evidence. Native-v2 CLI authoring is deferred; do not claim it from legacy success.

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

Define refusal per delivery owner. Local export returns a typed unsupported
outcome/nonzero command result; if its existing iterator has emitted a prefix,
retain that fact without reporting complete export. Direct TCP terminates the
actual replay operation on unsupported evidence; inspect whether that owner has
already emitted bytes and test that real boundary. An EOF is not a remote semantic
refusal message. Indirect HTTP/mailbox Respondant currently materializes the whole
cue before atomic Poster admission: preserve no-publication on construction failure
and expose the local failure without claiming that the older peer received a typed
refusal. Do not invent a negative-response protocol or streaming redesign. In all
paths, never substitute v2-only bytes for a purported v1 replay.

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

### Native-v2 ACDC/registry — deferred cuts 25–30

See the [native roadmap](credentials/NATIVE_V2_ACDC_REGISTRY_ROADMAP.md).
These cuts and N1–N3 are not 2.0.0 release prerequisites. Existing merged native
behavior still requires honest capability documentation and applicable regression
checks; this is no authorization to hide failures or advertise unsupported features.

### Verifier application ownership — PRs 30a–30b

Implement the accepted [Tufa verifier separation supplement](credentials/TUFA_VERIFIER_SEPARATION_PLAN.md)
after the legacy credential features, independently of deferred native work,
before the actual-peer matrix, final ProtocolProcessor
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

The release additions have two backer scenario families. Native N1–N3 and
their completion gates are deferred to the roadmap, not silently skipped passes:

| Case                                        | Focused happy path                                                                                                                                                                                                          | Independent interoperability evidence                                                                                                                                                                                                                                |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1: group-backed lifecycle to Python        | Tufa group issuer uses separate real backer processes with a nonempty roster and meaningful threshold: VCP -> BIS -> VRT -> BRV. Rotate the roster between issuance and revocation, then replay to a fresh Python observer. | Run the same compact verifier case against main, 1.2.x and 1.3.x; each parses original TEL plus real backer/source proofs and reaches issued then revoked state. Assert the historic management tuple as well as the final status.                                   |
| B2: Python-produced backed evidence to Tufa | Python's real constructors/signers produce a short VCP/BIS/VRT/BRV chain; ordinary Tufa CLI/runtime ingestion reaches matching accepted/revoked state.                                                                      | Reuse the three pinned profiles and their genuine crypto/parser APIs, with no TS-built fixture substituted for Python output. A minimal API driver is allowed; it must not patch reference code, preaccept rows, or claim to be an autonomous KERIpy backer service. |

Use only a few targeted failure checks for this expansion:

- Withhold one required backer contribution, observe honest pending state, reopen
  and deliver it; the same event must complete. This also checks the concrete
  partial-proof recovery bug without a separate broad failure matrix.
- Keep the accepted-management-coordinate regression local to Tevery; raw or
  escrowed management evidence must not authorize a historical backer cohort.

Existing threshold, duplicate-index, wrong-signer, cancellation and ordering
tests remain relevant; do not reproduce all of them as new multi-process interop
scenarios. Add another negative only for a newly demonstrated defect.

Retain existing useful native regression coverage and report partial API capabilities
honestly. New native lifecycle and reciprocal acceptance claims belong to the roadmap.
No reference patching or accepted-row seeding may stand in for real peer acceptance.

PR 31 closes the actual-peer matrix, using public CLI/protocol intake and
independent stores rather than seeding accepted rows:

| Scenario            | Required evidence                                                                                                                                                                                                                                                       |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Peer identities     | Unmodified main, GLEIF 1.2.17 and selected 1.3.x execute with verified imports; the mailbox fork remains separate.                                                                                                                                                      |
| TEL both directions | TS-generated v1 evidence accepted by each peer; peer-generated issuance/revocation accepted and replayable by TS.                                                                                                                                                       |
| Late observer       | Fresh state obtains issuer KEL, registry and credential TEL, reaches issued then revoked, reopens and remains revoked.                                                                                                                                                  |
| Wire combinations   | All three peer families accept supported v1 body/v1 genus. Main/TS exercise supported v1 body/v2 genus and independent KERI/CESR v2; 1.2/1.3 unsupported-v2 rejection is a negative test, not an expected acceptance cell. Unsupported downgrade is explicitly refused. |
| Transport           | Actual HTTP and supported TCP paths; old witness-mailbox polling, not only standalone fork-mailbox APIs.                                                                                                                                                                |
| Multisig roles      | TS proposer/Python approver and Python proposer/TS approver where actual reference commands exist; independent member stores.                                                                                                                                           |
| Complete lifecycle  | Registry -> issue -> apply/offer/agree/grant/admit -> revoke -> holder/observer revoked state; separate spurn path.                                                                                                                                                     |
| Threshold/topology  | Existing single/group directions, witnessed/delegated setups and a weighted threshold with a non-required absent member.                                                                                                                                                |
| Negative/recovery   | Tampered or missing child proof, wrong issuer/anchor, duplicate indices, partial signatures, hostile ordering, restart and stale replay.                                                                                                                                |
| Operator/store      | Config no-write failures, cleanup Python reopen, encrypted-store compatibility and initialization intent.                                                                                                                                                               |

Python-main apply/offer/agree CLI files and some group-join recipient handlers
are stubs at inspected references. Test real Python protocol ingestion for
those lanes and actual KLI commands where implemented. Label CLI, protocol and
fixture evidence separately. Do not patch the reference silently, claim full KLI
command parity from TS-only tests, or make a TS feature imitate an upstream stub.
Any required lane blocked by a genuine reference defect must be reported with
its exact source and reproducer; do not count it as passing.
The broad negative/recovery row above is an existing regression boundary, not a
request to multiply the two added backer interop families. Preserve its current useful
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

## Final qualification and release preparation — cut 32

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
   **Breaking changes** prominently in each changelog and prepared release notes, linking
   the version-pinned guide. Don't invent breaks merely for coordinated versioning.
3. **Qualify the final clean source.** Run the complete maintained CESR/KERI/Tufa
   and in-scope actual-peer matrix after all required features, ownership and organization changes.
   Record native ACDC/registry completion as deferred, with explicit supported
   API limits in release notes; do not advertise native CLI lifecycle parity.
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
5. **Inventory distributions for the handoff.** Verify reviewed version
   preparation, clean synchronized master, exact release commit, live npm versions,
   dist-tags/dependencies, GitHub release/tag/asset identities and other actual
   publication surfaces. Keep bot release PR #527 gated beyond this goal until
   publication is separately resumed after the side-chat plan completes.
6. **Preserve published 1.0.0 history.** Do not unpublish packages or delete
   releases, assets or tags as part of 2.0.0. The abandoned replacement-release
   withdrawal instructions are superseded. Any later deprecation or withdrawal
   is a separate explicit distribution decision after 2.0.0 is verified.
7. **Report completion with evidence.** Identify the qualified source commit and
   unpublished artifact digests, peer pins, results/skips/limits, prepared release
   notes, clean repository and healthy ENCTX. Finish this goal only when all
   remaining in-scope implementation, preparation and qualification are complete.
   Explicitly state that publication and post-publication verification are deferred.

## Deferred publication — outside this goal

After the side-chat plan is complete and publication is separately resumed,
reconcile its changes and rerun affected final qualification before publishing.
Do not publish npm packages, push release tags, publish GitHub releases or ungate
release PR #527 as part of the current goal.

The later publication work must publish CESR → KERI → Tufa from the same qualified
commit, verify each package's registry availability before its dependents, and
check npm metadata, dependency versions, dist-tags, GitHub notes/assets and
version-pinned migration links. Compare qualified/workflow/npm/GitHub artifact
identities and run clean registry-only installed runtime/CLI/declaration checks.
Preserve 1.0.0 history; never replace published bytes under an existing version.
These publication-dependent checks are not completion gates for this goal.
