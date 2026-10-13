# PROJECT_LEARNINGS_KELS

## Purpose

Persistent learnings for KEL processing, DB parity, replay, runtime ownership,
and KERIpy interoperability.

## Current State

Live LMDB V1 inspection requires separate processes or the existing owning
Habery. Opening the same database twice in one process can corrupt reader-slot
ownership even when the second handle is read-only. Keep live host assertions
and protocol participants; move the inspection or host into a real CLI process
instead of suppressing the error or waiting until shutdown.

Protocol-v2 `/fwd` now preserves parent-owned child trees through `Exchanger`,
`enst.` storage, escrow retry, reopen and replay. The signed `a.evt` digest binds
one verified child body; child signatures remain recipient evidence. Candidate
rows use uniquely owned private stages and replace the public IoSet atomically
with accepted/escrow state. Verified duplicates replace child evidence and rerun
the handler, matching frozen Python. Fresh children stay hydrated; reopened ESSR
uses temporary file owners and aggregate tree credit across rows. See
`packages/keri/src/db/payload-store.md` for finite LMDB-copy and recovery limits.
Shared exchange encoding retains supplied v2 Number primitives; only v1 widens
ordinals to Seqner. Nested multisig admits only frozen `/icp`, `/rot`, `/ixn`,
and `/rpy` commitments: one saidive child, its exact signed SAID, allowed child
ilk and local membership. The child remains unprocessed until a local submitter
has approved that child SAID. Additional signatures replay through ordinary
KEL/reply validation and escrows; wrapper acceptance does not mean child acceptance.
Remote-first approval reopens original exchange evidence; local-first approval
borrows hydrated children. Further descendants remain guarded. IPEX and the
broader v2 non-event policy remain unsupported.

Multisig v2 bodies use synchronous `multisigExnBody()` with a parsed child Serder;
construction neither reads payloads nor authenticates proofs. Parsed-frame callers
reuse `nestedPayload()` with borrowed owners. Byte-input route helpers delegate
to `prepareMultisigEventExn()`, an Effection operation owning parsing, bounded wire
collection and joined disposal on failure/cancellation. Explicit v2 output carries
supplemental nested bytes that must share an attachment enclosure with parent
signatures; v1 output retains pathed evidence and its distinct aggregation key.
The frozen native EXN builder leaves `ri/x/p` empty and cannot decode its own
output; default native multisig construction remains unqualified. JSON/CBOR/MGPK
have actual accepted storage/replay and Python return-path evidence.
CLI proposal/join remains v1, as in the frozen reference. Preserve its first-notice
behavior; repeated notices for indexed proposals cause approval re-publication.

Exchange retry reads one key at a time up to a captured initial horizon, closing
the LMDB cursor before awaiting or removing rows. Mutating a suspended live range
iterator can skip the following escrow. Cross-runtime retry admission remains
part of the shared-resource/storage follow-ons.

Query delivery is deferred until guarded cue handling completes. The runtime owns
its bounded request queue and joins active HTTP cleanup at shutdown. Mailbox SSE
awaits each event consumer; provider output reads one record per demand and
releases LMDB iterators before suspension. Aggregate connection admission and
pre-read storage size limits remain explicit follow-ons.

KEL replay hydrates stored JSON or native CESR bodies with `SerderKERI` and
selects attachment genus from the body protocol/genus. Every outer and inner
counter uses that genus. Source and receipt ordinals convert to `Seqner` only
for v1; v2 retains the stored qualified `Number`. Independent frozen KERIpy
fixtures cover both genera, grouped receipts, source seals, and database reopen.
Frozen issuance evidence now also enters through real HTTP/OOBI resolution,
TEL escrow, and credential verification before reopen/export in either attachment
genus. `Reger` accepts an explicit genus floor for TEL clones; credential exports
apply the body minimum and preserve qualified Numbers through TEL escrow/storage.
The reference supports v1 TEL/ACDC issuance bodies under v2 attachment framing;
it rejects v2 `vcp` bodies. This proof does not claim v2 TEL protocol support.

Canonical KEL replay emits transferable receipt signature groups (`-F` in v1),
collated by the complete receiptor establishment seal. Durable `vrcs.` quadruples
and legacy wire receipt parsing remain unchanged. Current KERIpy main removed
v1 `-D`; emitting it can truncate an OOBI stream before endpoint replies arrive.
Grouped receipts authenticate each signature independently, without the
receiptor's controller threshold. Missing state escrows the group; invalid
evidence stops that receipt pass. Following KEL/reply frames still dispatch.

`PayloadArchive` publishes immutable file references in private LMDB tables
only after file and directory flushes. Recovery walks directory entries and
rows incrementally, removes unreferenced files, and fails closed on missing
referenced objects. The host must own its archive directory exclusively across
processes. KERIpy wire tables remain separate and unchanged.

`PayloadStore.adopt` transfers mutation ownership while preserving borrowed
readers; stale request cleanup cannot delete published content. Native filesystem
operations use Deno and `@std/path`; the npm packaging shim supplies fsync.
Final names use scoped owner identities such as `essr.SAID` and `plain.SAID`,
with temporary UUIDs confined to staging. These names do not claim to be
independent payload hashes. See `packages/keri/src/db/payload-store.md`.

`Baser` owns its archive lifetime. Startup removes `.essrs` rows lacking accepted
or escrow ownership with a key-only scan. `Exchanger` carries reopenable ESSR
wire through acceptance, escrow, and replay; `.essrs` retains individual
KERIpy-readable Texters. Private canonical wire preserves order and repeated
fragments despite `.essrs` set semantics. KERIpy-origin rows without private
metadata remain usable through a bounded borrowed view; retry snapshots and
publishes them without deleting prior evidence on failure. Such rows retain only
the insertion order and deduplication KERIpy actually stored.

`Exchanger` and `EssrRecipient` expose Effection operations that join cancellable
file reads and cleanup. Recipient processing binds one explicitly hosted habitat
and checks the accepted EXN, digest, sealed-box authentication, and SCS framing
before plaintext staging. `Baser.savePlaintext` stores authenticated output
separately from ciphertext evidence; its reopened body view retains no full
plaintext buffer. See `packages/keri/src/app/essr.md` for ownership and limits.

Runtime dispatch and settlement are Effection operations; mailbox batch callbacks may return an operation. Finish
one dispatch before advancing its source or marking a mailbox batch handed off.
The receiving mailbox AID travels as an explicit per-message argument; never
store it in mutable request-global state across a suspension. Local habitat bootstrap
configuration remains synchronous because it processes only its own endpoint
replies directly through Revery.

HTTP/file ingress pulls progressive frames through the optional CESR Effection
adapter. `Reactor.settle` serializes dispatch, escrow progress, and cue delivery;
background consumers must use the same guard. Direct HTTP replies reserve their
query SAID before dispatch so background workers cannot steal them. Only the
EOF-final query controls a multi-frame response. Earlier replies transfer to
ordinary delivery before their reservation closes. Source, frame, and runtime
permit resources precede their work children so cancellation joins I/O before
releasing ownership. See `packages/keri/src/app/reactor.md`.

CESR egress owns one admitted frame and one HTTP request per Effection scope.
`requestFrame` keeps successful response bodies live until the consuming scope
exits, then aborts and joins its I/O; `postCesr` supplies parser credit only after
delivery and ESSR disposal. Header mode is finite text-qualified metadata;
bulk body mode streams payload references. Replay/cue, mailbox, and annotation
migration remain separate obligations, not implied by the sender conversion.

KEL replay cues carry a reopenable message iterable with captured first-seen
endpoints and a bounded delegator list. Reads clone one finite event at a time
and release the LMDB cursor before yielding to transport. Reply HTTP streams
pull bounded owned chunks and close on cancellation or runtime shutdown; they
must not inherit Deno's request signal after the handler returns. Query pending
records retain capacity through delivery and failures, and one pass only drains
its initial count; continuations have separate finite admission.

Mailbox `mbx` queries authorize recipient-private bytes: requester identity must
match the recipient and its signatures must satisfy the current accepted signing
threshold. Naming a prefix in attachment material and correlating a stream cue
are not authentication. Tufa rechecks the exact request envelope before
consulting shared cues, because attachments are outside the query SAID. Verify nontransferable cigars as well as indexed
transferable signatures; duplicate indices do not increase the threshold. Public
`logs` and `ksn` query policy remains separate. This intentionally tightens the
permissive KERIpy 1.2.14 mailbox query behavior.

Group rotation signatures carry independent current-key and prior-next-commitment
indices. Match each current public key cryptographically against the accepted
prior `ndigers`; an uncommitted replacement key signs current-only. Inception and
interaction signatures are current-only as well. Recovery must satisfy both the
prior rotation threshold and the new current threshold; preserve unavailable
participants' next commitments for later recovery.

1. Phase 2 remains parity-first. The broad DB foundation is in place; the active
   edge is runtime, key-management, and `kli`/`tufa` interoperability.
2. `docs/design-docs/db/db-architecture.md` is the storage contract for
   ordering, duplicate semantics, reopen behavior, and serialization.
3. The remaining DB story is no longer "missing broad surface area." It is
   promotion of the highest-value `Partial` rows with real parity evidence,
   especially `fetchTsgs` and the remaining `Komer` family.
4. Exact interop rules matter: keep `lmdb` pinned to `3.4.4`, preserve
   `LMDB_DATA_V1=true`, size existing mappings from stored metadata after
   applying explicit or KERIpy-compatible environment overrides, and route
   protocol/storage CBOR through the shared CESR codec.
5. Typed `Suber` / `Komer` wrappers are the active parity path; the forward
   ordinal-wrapper surface is the newer `getTop*` / `getAll*` family, with old
   `getOn*` names retained only as temporary compatibility aliases.
6. Record-model parity is `FooRecord` plus `FooRecordShape`, with `recordClass`
   as the durable public seam. Public `*Like` aliases and exposed
   `hydrate`/`normalize` hooks are drift.
7. Durable local identifier state is DB-backed: `states.` is authoritative,
   `kels.` / `fels.` / `dtss.` preserve reopenable event state, and
   `Habery.habs` is only a reconstructed in-memory cache.
8. Local key-management stays primitive-first: `Manager`, `Signator`, and keeper
   encryption should consume and return CESR primitives directly.
9. Parser-to-runtime dispatch is a first-class seam. Keep KERIpy family names
   such as `tsgs`, `trqs`, and `ssgs`, but do not create unnecessary local
   wrapper taxonomies around them.
10. Fixed-field seal/blind/media values belong to CESR structing records.
    Runtime code should project through `SealEvent.fromSad(...)`,
    `SerderKERI.eventSeals`, and related helpers rather than rechecking raw
    `{ i, s, d }` shapes everywhere.
11. Ordinal-bearing dispatch material currently needs
    `DispatchOrdinal = Seqner | NumberPrimitive`; forcing all ordinals into
    `Seqner` is false parity.
12. KEL control flow should stay TypeScript-native: normal outcomes are typed
    decisions, `Kever` decides validity, and `Kevery` owns routing, escrow
    persistence, duplicate handling, and post-acceptance side effects.
13. `docs/adr/adr-0005-kel-decision-control-flow.md` is the normative contract
    for that split.
14. Accepted identifier state belongs on `Kever` / `Baser`, not ad hoc habitat
    projections. Local inception and interaction should flow through the same
    `Kevery` acceptance path used for remote processing.
15. Weighted threshold parity is end to end through `Tholder`, including
    structured `kt` / `nt` payloads and `tholder.satisfy(...)`.
16. Cue ownership is dual-scope and explicit: runtime-hosted work uses the
    shared runtime cue deck, while `Habery.kevery` owns a separate local cue
    deck for habitat-local processing.
17. `Hab.processCuesIter()` remains the cue-semantics seam. `Revery` owns reply
    verification/BADA/escrows, `Kevery` owns KEL and `/ksn`-style reply
    families, and `Oobiery` owns introduction-driven OOBI behavior.
18. Local location state must arrive through signed `/loc/scheme` replies that
    flow back through `Revery`, not by direct writes to `locs.` / `lans.`.
19. Runtime turns should stay Effection-native; promise adaptation belongs only
    at real host edges.
20. Gates B, C, and D are established foundations. Gate E is materially real:
    shared runtime, mailbox/OOBI/query/receipt slices, bounded init/incept
    convergence, and the main query/reply correspondence closure are landed.
21. Incomplete `query` cues are runtime correspondence requests, not near-wire
    messages. They must resolve a local habitat and an honest remote attester
    before emitting follow-on `qry`.
22. Event routing and query acceptance for `logs` / `ksn` / `mbx` must use durable read-through
    state via `db.getKever(...)`, not only the hot `db.kevers` cache, or
    reopened processors will falsely escrow remote accepted subjects as
    `ooo` or `missingKever` and fail to emit `/replay` or `/reply`.
23. Delegator-side `delegate confirm` parity is `delegables`-driven, not
    notice-driven. Notices from `/delegate/request` are UI hints only; confirm
    must derive the delegated event, delegator, and approval order from
    `db.delegables`, then avoid pinning local `aess` or forcing delegated
    unescrow until the delegate event has been observed as locally committed
    through the witness-backed confirm path.
24. Cross-implementation delegation coverage now proves single-key and 2-of-2
    multi-key threshold `dip` + `drt` in both Tufa->KERIpy and KERIpy->Tufa
    directions. Protocol-level true group delegation is also proved both ways:
    real KERIpy two-member `GroupHab` delegated inception can be approved by
    Tufa and completed in KERIpy, and a Tufa-generated two-member delegated
    group inception can be approved by KERIpy and completed in Tufa. Tufa-only
    true group delegation coverage now proves single->2-of-2 group, 2-of-2
    group->single, 2-of-2 group->2-of-2 group, and witnessed 2-of-3
    group->witnessed 2-of-3 group approval. Tufa now has public CLI multisig
    `incept`, `join`, `interact`, and `rotate` surfaces over the real
    grouping/multiplexing path; interop workflows should use those CLI seams
    instead of private `Habery.makeGroupHab(...)` shortcuts. Accepted group
    member metadata changes only after the corresponding inception or rotation
    is present in the local KEL; pending rotations retain the prior accepted
    `smids` / `rmids` state. Tufa multisig inception files preserve structured
    `isith` / `nsith` values, and the nested weighted public-CLI gate proves that
    a satisfying subgroup can complete inception, interaction, endpoint-role
    reply, and DID Webs publication without an unnecessary third signature.
25. Delegation source-seal repair has two cases. Pending delegated events in
    `pdes` / `delegables` still use explicit delegation escrow promotion, but
    already accepted local delegated events must also pin `aess` when a later
    accepted delegator event replays an anchor seal in `a`. Without that repair,
    single delegated AIDs that accepted locally before the delegator replay can
    have a valid Kever without durable authorizing seal state. KEL membership is
    also not sufficient to classify an event as a duplicate when `states.` is
    behind that sequence number; replay must repair current state before
    duplicate handling can short-circuit.
26. The remaining runtime gaps are narrower now: broader exchange/forwarding
    route breadth, the stale/timeout continuation tail, and the last high-value
    DB parity promotions.
27. Gate F/G bridge work is already partly real: `Exchanger` owns accepted and
    partially signed `exn` persistence, escrow promotion clears partial state
    exactly once so accepted signatures survive for lead election and IPEX
    evidence, challenge flows are live, and mailbox forwarding/polling now sit
    on explicit shared provider storage plus durable `tops.` cursors.
28. The mailbox mental model must stay explicit: provider mailbox storage is
    shared runtime-composed state above `Habery`, while remote topic cursors are
    durable habery state in `tops.`.
29. `tufa agent` has two independent compatibility seams: CLI flag semantics and
    packaged Node runtime behavior. Release confidence requires smoke coverage
    against the packed artifact, not just Deno source runs.
30. Honest CLI/bootstrap tests must use explicit file-path flags such as
    `--config-dir` / `--config-file` rather than hidden default-path mutation.
31. End-to-end controller-to-controller coverage must respect single-store
    ownership. Do not run CLI commands against the same store a live
    `tufa agent` is currently hosting; a stale live runtime can overwrite
    newer command-local accepted state.
32. `tufa db dump` is now a first-class interop-debugging seam; prefer targeted
    selectors over ad hoc LMDB scripts or whole-store dumps.
33. The host mental model is one listener/runtime per Habery or command
    invocation with explicit hosted-prefix filtering. A multi-AID bug is a
    selection/bootstrap bug, not one-listener-per-AID topology.
34. AEID is keeper auth/encryption state, not an ordinary hosted or user-facing
    AID. Treat signatory/AEID-related identities as non-user-facing by default.
35. Endpoint-role capability and startup seeding are separate concerns. The
    presence of `Roles.agent` in protocol code is not, by itself, a reason to
    auto-create self `agent` roles at startup.
36. Alias-scoped config `dt` + `curls` is the canonical controller endpoint
    bootstrap path; localhost synthesis is a fallback only when config and
    accepted endpoint state are both missing.
37. `MailboxPoller` now has an honest finite/infinite split: bounded
    `processOnce()` returns typed batches, while long-lived `pollDo()` stays
    sink-based for concurrent workers.
38. `packages/tufa` owns the runnable host/CLI edge. `packages/keri` remains a
    library/runtime surface, not the home of host composition, command
    registration, or transport middleware policy.
39. Command-local lifecycle should choose the narrowest explicit scope:
    `withExistingHabery`, `withAgentRuntime`, or `withHabAndAgentRuntime` for
    ordinary existing-store CLI commands; direct `setupHby` remains a low-level
    escape hatch, and `ensureHby` remains for create-if-missing host startup.
40. Attachment counter genus-version handling is split by message class: live
    message serialization may follow caller/requested `gvrsn` and KERIpy v2
    enclosure rules, but replay clone APIs (`Baser.clone*`, `Reger.cloneTvt*`,
    KEL/TEL replay helpers) are fixed to v1 counters because they replay stored
    KEL/TEL events rather than constructing new live attachment envelopes.
41. `did:webs` `keri.cesr` artifact generation is not an OOBI reply bundle:
    replay the controller delegation/KEL once, then append stored witness,
    agent, mailbox `/loc/scheme` and `/end/role` replies directly. Calling
    `Hab.replyEndRole(...)` per role repeats the controller KEL.

## Use This Doc For

1. Event validation and ordering rules
2. Replay/unescrow behavior and accepted-state ownership
3. DB parity, runtime architecture, and KERIpy interop nuances

## Key Docs

1. `docs/design-docs/db/db-architecture.md`
2. `docs/adr/adr-0005-kel-decision-control-flow.md`
3. `docs/adr/adr-0008-escrow-decision-architecture.md`
4. `docs/design-docs/keri/CUE_ARCHITECTURE_CROSS_RUNTIME.md`
5. `docs/design-docs/keri/MAILBOX_ARCHITECTURE_ACROSS_KERIPY_AND_KERI_TS.md`
6. `docs/design-docs/keri/QUERY_REPLY_CORRESPONDENCE_AND_WATCHER_SUPPORT.md`
7. `docs/design-docs/keri/DELEGATION_MULTISIG_ENDPOINT_ROLES_MAINTAINER_GUIDE.md`
8. `docs/design-docs/keri/ATTACHMENT_COUNTER_GVRSN_MAINTAINER_GUIDE.md`

## Current Follow-Ups

1. Keep KEL-state work parity-first on top of DB invariants rather than adding
   abstraction before behavior closure.
2. Continue the remaining Gate E / Gate F bridge with focus on broader
   exchange/forwarding route breadth and stale/timeout continuation behavior.
3. Promote high-value DB `Partial` rows with row-level evidence instead of
   symbol-existence optimism.
4. Keep cue/query/watcher/escrow docs current when behavior changes; drift in
   those contracts is a real regression.
5. Keep `tufa agent` smoke coverage honest at the packaged boundary.
6. Keep Gate E end-to-end coverage CLI-first and store-ownership-honest.
7. Keep host-prefix selection explicit and conservative when touching `agent`,
   `mailbox start`, or server route filtering.
8. When interop behavior seems ambiguous, compare targeted DB state before and
   after the operation with `tufa db dump` before inventing a new explanation.
9. Keep `packages/tufa` ownership hard: runnable CLI, role-host composition, and
   HTTP middleware policy stay there.
10. Compact this doc again when it starts reading like an archive.

## Milestone Rollup

### 2026-03-02 to 2026-03-18 - DB Foundation And Local-State Truth Landed

- The DB parity matrix and wrapper surface became real enough to support later
- runtime and interop work.
- Local identifier state moved onto the DB backbone instead of process-local
  habitat projections.

### 2026-03-27 to 2026-04-04 - Runtime Ownership And Typed Control Flow Sharpened

- Runtime architecture locked around explicit parser-to-runtime dispatch, the
  shared runtime cue deck, and `Habery`-local `Kevery` ownership for local
  acceptance.
- `Kever`/`Kevery` split, threshold semantics, live receipt-family handling, and
  replay/unescrow decisions moved onto clearer typed seams.
- CESR structing records became the semantic home for fixed-field seal/blind
  data, with KERI tuple aliases remaining derived storage views.

### 2026-04-05 to 2026-04-06 - Query, Mailbox, And Exchange Boundaries Became Honest

- `QueryCoordinator` now owns incomplete query correspondence rather than
  smuggling that policy into cue interpretation.
- Replay-attached receipt handling and query replay parity closed the real Chunk
  8 gap.
- Mailbox ownership is now explicit: shared provider-side mailbox storage above
  `Habery`, durable remote cursors in `tops.`, and `MailboxDirector`/poller
  layers above both.

### 2026-04-07 to 2026-04-09 - Host, Package, And Release Surfaces Tightened

- `tufa agent` parity now treats source-vs-npm drift as a real release risk.
- Hosted-prefix filtering, mailbox/witness role hosting, and protocol routing
  were split onto clearer host/runtime/package ownership lines.
- `packages/tufa` is now the runnable CLI/host boundary, while `keri-ts` exposes
  the narrow library surface.
- AEID and other system-managed identities were clarified as keeper/system state
  rather than ordinary user-facing hosted identities.

### 2026-06-05 - Cross-Implementation Delegation Boundary Proven

- Tufa/KERIpy delegation interop now has executable `dip` + `drt` coverage in
  both directions for single-key and 2-of-2 multi-key threshold delegated AIDs.
- KERIpy delegated events for a local Tufa delegator must route into
  `delegables` until the local delegator approves; remote-protected shortcuts
  must not bypass that local approval gate.
- True group delegation is proved at the protocol boundary in both directions:
  KERIpy `GroupHab` -> Tufa approval -> KERIpy completion, and Tufa-generated
  two-member group `dip` -> KERIpy approval -> Tufa completion.
  `Habery.makeGroupHab(...)` now provides the Tufa production inception surface
  used by that test; full Counselor/Multiplexor coordination and group rotation
  remain unimplemented.
- Group habitat metadata must be persisted before processing so pending
  delegated group records survive reopen, but `db.prefixes` / `db.groups` must
  be marked only after actual acceptance. Marking them before validation turns
  the event into a protected-party case and can incorrectly bypass remote
  delegator proof.
- Tufa-only true group delegation now has an executable matrix for
  single->2-of-2 group, 2-of-2 group->single, 2-of-2 group->2-of-2 group, and
  witnessed 2-of-3 group->witnessed 2-of-3 group approval. The witnessed case
  must preserve `WitnessIdxSigs` in both the pre-approval delegated event
  payload and the delegator approval replay.
- Accepted delegator anchor replay must repair missing `aess` for already
  accepted delegated events, not only promote events still sitting in delegation
  escrows.
- `delegate confirm` now mirrors KERIpy's source-of-truth shape: scan
  `delegables`, anchor the local delegator event, wait for normal
  query/replay-backed delegated commitment, then pin `aess` and unescrow.
  `/delegate/request` notices remain operator/UI hints and must not route
  approval or replay publication.
- Replaying a stored delegated event must not treat `kels.` membership alone as
  a duplicate when durable `states.` still trails the event sequence number.
  In that condition, replay repairs state before duplicate handling is allowed
  to short-circuit.
- KLI/Tufa interop harnesses must not keep a live `tufa agent` open for the
  same store that command-local Tufa CLI confirmation is mutating. Use witnessed
  mailbox/OOBI transport for the cross-implementation workflow instead of a
  same-store direct Tufa host.

### 2026-06-08 - Public Multisig CLI Boundary Landed

- Tufa group workflows now have public `tufa multisig incept`, `join`,
  `interact`, and `rotate` commands. Tests and seed workflows should mirror KLI
  by using `tufa multisig join` for Tufa-generated group AIDs instead of
  invoking internal group habitat APIs.
- Delegated group inception must keep the delegator proof explicit: create the
  delegated group event with `delpre`, anchor it from the delegator, then query
  the delegator KEL with the delegated event anchor and assert the delegate's
  stored delegator field.

Generic witness and signed-exchange HTTP delivery share progressive frame output;
authorization survives media-type retry while CESR metadata remains serializer
owned. Receipt responses are explicitly finite proofs (1 MiB), decoded by the
progressive engine with scoped cancellation. Query reply handoff and mailbox SSE
collection remain separate work; do not reenter Reactor from its cue consumer.
