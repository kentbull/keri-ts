# PROJECT_LEARNINGS (Index)

## Purpose

Top-level routing and durable cross-topic memory for `keri-ts`.

Use this file to:

1. identify current focus,
2. route to the right topic doc,
3. capture only the highest-signal cross-topic conclusions,
4. keep startup context small enough to reread every thread.

## Current Focus

1. CESR parser, primitive, and serder work is stable enough for upper-layer
   progress; the job now is to preserve parity, readability, and regression
   coverage rather than reopen settled parser architecture.
2. KERI Phase 2 work is parity-first around DB closure, runtime/key-management
   behavior, and practical `kli`/`tufa` interoperability.
3. The learnings layer is intentionally compact. Durable conclusions belong
   here; detailed task transcripts do not.

## Topic Learnings Index

| Topic                          | File                                                                    | Scope                                                                    |
| ------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| CESR Parser                    | `.agents/learnings/PROJECT_LEARNINGS_CESR.md`                           | Parser architecture, primitive/serder parity, native handling            |
| Crypto Suite                   | `.agents/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`                   | Primitive semantics, signer/verifier ownership, encryption behavior      |
| KELs                           | `.agents/learnings/PROJECT_LEARNINGS_KELS.md`                           | DB parity, state transitions, runtime/cue/reply ownership, interop gates |
| ACDC                           | `.agents/learnings/PROJECT_LEARNINGS_ACDC.md`                           | Credential compactification, section semantics, ACDC-native rules        |
| Witness/Watcher/Observer Infra | `.agents/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md` | CI/release/runtime interop contracts plus infra-role operational notes   |

## Session Start Policy

1. Read `AGENTS.md`.
2. Read this file.
3. Read only the topic doc(s) relevant to the task.
4. Read the contract/ADR/plan docs referenced by those topic docs when the task
   actually depends on them.
5. Use KERIpy at `$HOME/code/keri/kentbull/keripy` as the behavioral authority
   whenever parity reasoning becomes uncertain.

## Compaction Policy

1. Keep this file as a routing layer, not a second archive.
2. Keep durable cross-topic rules here; keep topic detail in topic docs.
3. When history gets noisy, roll it into milestone summaries instead of adding
   more micro-handoffs.
4. Prefer "what matters now" over "everything that happened."
5. Most tasks should update `Current State` and `Current Follow-Ups` rather than
   append a new milestone entry.

## Cross-Topic Snapshot

1. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is the
   normative parser lifecycle contract. Parser changes should keep
   contract-to-test traceability and KERIpy parity.
2. CESR parser architecture remains atomic/bounded-substream first. Nested
   incremental parsing stays deferred unless performance evidence says
   otherwise.
3. The tracked P2 CESR vector set is the regression floor for parser behavior.
4. Generated KERIpy-parity codex objects such as `MtrDex`, `PreDex`, `DigDex`,
   `IdrDex`, and `TraitDex` are the primary source of truth. Helper sets in
   `codex.ts` are derived readability views, not a competing authority.
5. When the code already knows the semantic type, it should construct and return
   the narrow primitive. `Matter` and `Indexer` are low-level parser/storage
   bases, not the default public API result.
6. Concrete crypto primitives own their suite dispatch too: `Signer` and
   `Verfer` are the signer/verifier behavior seams, and sidecar helper modules
   should not become a second home for curve-selection logic.
7. Fixed-field seal/blind/media structing values belong to CESR through
   `packages/cesr/src/primitives/structing.ts`; the stable design there is plain
   frozen records plus companion helpers/registries, with raw-SAD-first
   boundaries and explicit typed projections. `packages/keri` runtime dispatch
   now uses those CESR records directly, while LMDB tuple aliases remain a
   derived storage boundary instead of a second semantic home.
8. CESR-native and ACDC-native behavior should extend the shared support matrix
   in `packages/cesr/src/serder/native.ts`; do not reintroduce sidecar native
   branching.
9. ACDC parity depends on explicit compactification rules: top-level compactive
   verification uses the most compact section form, while section identifiers
   stay label-aware (`$id`, `d`, `agid`).
10. Weighted thresholds are semantic through `Tholder`; KEL and reply logic
    should use `tholder.satisfy(...)` rather than collapsing threshold material
    into ad hoc numeric parsing.
11. `docs/design-docs/db/db-architecture.md` is the shared DB invariants
    contract. DB work remains parity-first rather than abstraction-first.
12. Durable local state is DB-backed: `states.` is the authoritative local key
    state, `kels.` / `fels.` / `dtss.` support reopenable event state, and
    `Habery.habs` is only an in-memory reconstruction cache.
13. The mapper/record mental model is `FooRecord` plus `FooRecordShape`, with
    `recordClass` as the durable public seam. Public `*Like` aliases and
    mapper-facing `hydrate` / `normalize` APIs are drift.
14. KEL control flow should stay on typed decisions (`accept`, `duplicate`,
    `escrow`, `reject`): `Kever` decides validity, `Kevery` routes/applies, and
    `docs/adr/adr-0005-kel-decision-control-flow.md` is normative.
15. Cue/runtime ownership is dual-scope and explicit: `AgentRuntime` owns the
    shared runtime cue deck for `Reactor` / `Revery` / runtime `Kevery` /
    `Oobiery`, `Habery.kevery` owns a separate local cue deck for `Hab` local
    processing, `Hab.processCuesIter()` owns cue semantics, `Revery` owns reply
    verification/BADA/escrows, `Kevery` owns KEL and `/ksn`-style reply
    families, `Oobiery` owns introduction-driven OOBI work, and
    `QueryCoordinator` owns incomplete `query` cue correspondence so
    `Hab.processCuesIter()` stays an interpreter for already-complete cues. The
    primary end-to-end explainer for this now lives in
    `docs/design-docs/keri/CUE_ARCHITECTURE_CROSS_RUNTIME.md`, while
    `docs/adr/adr-0004-cue-runtime-portability.md` remains the normative
    `keri-ts` runtime contract.
16. The primary end-to-end mailbox explainer now lives in
    `docs/design-docs/keri/MAILBOX_ARCHITECTURE_ACROSS_KERIPY_AND_KERI_TS.md`.
    Use it to rehydrate the sender/recipient/mailbox-provider split, `/fwd`
    storage semantics, mailbox polling, and `POST /mailboxes` before changing
    mailbox behavior. `docs/adr/adr-0009-mailbox-architecture.md` remains the
    normative decision record.
17. Receipt-family mental models should stay KERIpy-shaped: live `rct`
    transferable receipts use grouped `tsgs`, while replay/clone attached
    transferable receipt material uses `trqs`. That split is now real end to end
    in runtime ingress too: `Reactor` routes attached replay receipts through
    dedicated `Kevery.processAttachedReceiptCouples(...)` and
    `processAttachedReceiptQuadruples(...)` paths, while escrow/storage may
    flatten those families into quintuple/quadruple rows. Keep the explicit
    KERIpy receipt escrow seams (`escrowUReceipt`, `escrowUWReceipt`,
    `escrowTRGroups`, `escrowTReceipts`, `escrowTRQuadruple`) instead of merging
    them into one local helper.
18. Local location updates must enter through signed `/loc/scheme` replies that
    flow through the normal parser -> `Revery` path, not by direct writes to
    `locs.` / `lans.`.
19. Interop contracts are exact, not approximate: keep `lmdb` pinned to `3.4.4`,
    preserve `LMDB_DATA_V1=true` for KERIpy interop workflows, and route
    protocol/storage CBOR through the shared CESR codec for byte parity.
20. Deno config ownership is graph-wide for local-source workflows, and CLI
    startup should stay lazy so `--help` / `--version` do not pull CESR/LMDB
    startup work.
21. CI policy is `dprint` plus stage-gated quality checks, a pinned KERIpy CLI,
    explicit environment/version pins, and cache topology that respects LMDB v1
    rebuild requirements.
22. Test parallelization should follow isolation boundaries, not folder names.
    DB-core suites can parallelize more freely; CLI/app/interop suites that
    mutate globals or persisted stores need stronger isolation.
23. Gates B, C, and D are closed enough to treat local visibility, compat-store
    visibility, and encrypted keeper semantics as established foundations.
24. Gate E now has a real shared runtime, mailbox/OOBI/query/receipt slice,
    broader Chunk 7 query/reply correspondence closure, attached replay receipt
    parity for cloned KEL events, KERIpy-shaped transferable query ingress
    (`ssgs` -> `source + sigers`), bounded init/incept convergence, and the
    first Gate F/G bridge: `Exchanger`, `challenge generate/respond/verify`,
    `exchange send` plus `exn send`, and shared runtime-composed mailbox
    forwarding and polling through `/fwd` with durable `(pre, witness)` topic
    cursors. Mailbox interop is now materially real in both directions too:
    `kli mailbox add` works against a `tufa` mailbox host, `tufa mailbox add`
    works against the real KERIpy `kli mailbox start` host, mailbox-polled
    challenge flows pass live, and base-path-relative mailbox/OOBI serving is
    exercised. The critical host-composition invariant is that the mailbox host
    must pass the shared cue deck into `MailboxStart`; otherwise `/fwd`
    deliveries can land in KERIpy mailbox LMDB while `mbx` queries hang because
    no `stream` cue ever reaches the SSE responder. The remaining runtime gaps
    are now primarily broader exchange/forwarding route breadth beyond the
    current mailbox/challenge slice, plus the broader stale/timeout continuation
    tail outside the now-closed receipt/query correspondence slice.
25. `tufa agent` release confidence must come from the packed npm artifact, not
    just the Deno source path. CLI flag semantics and Node host/runtime
    compatibility can drift unless smoke coverage exercises
    `init -> incept -> agent -> /health` against the tarball users actually
    install.
26. End-to-end CLI tests should stay on honest public seams. For bootstrap
    config, prefer explicit file-path flags such as `--config-dir` /
    `--config-file`; do not seed a command's default internal config path or
    inspect LMDB through ad hoc `deno eval` helpers in bash and call that CLI
    coverage. For runtime-hosted exchange/challenge paths, keep bash coverage
    honest about store ownership too: if a CLI command needs the same store as a
    long-lived `tufa agent`, stop the host, run the command, then restart the
    recipient host as needed instead of depending on implicit concurrent access.
27. For interop debugging, `tufa db dump` is now a first-class maintainer seam.
    Prefer targeted selectors such as `baser.<subdb>`, `mailboxer.<subdb>`, and
    `outboxer.<subdb>` against both `.tufa` and `.keri` stores over ad hoc LMDB
    scripts or whole-store dumps when validating state transitions.
28. The host mental model must stay explicit: one long-lived listener/runtime
    serves a Habery or command invocation, while hosted-prefix filtering decides
    which local AIDs are reachable through that host. Multi-AID seeding bugs are
    about over-broad bootstrap/selection, not one-listener-per-AID topology.
29. AEID is keeper auth/encryption identity state, not an ordinary hosted or
    user-facing AID. KERIpy allows it to be supplied at init and later changed
    to re-encrypt keeper secrets, but that does not make it part of normal user
    habitat hosting or OOBI/mailbox surfaces.
30. Keep endpoint-role support separate from startup synthesis. `Roles.agent`
    may remain part of routing and OOBI support, but `tufa agent` should not
    auto-seed self `agent` end roles until there is an intentional runtime
    construct that actually needs that state.
31. Hosted controller endpoint bootstrap should now be config-first, KERIpy-
    style. Alias-scoped config sections own `dt` plus `curls` for self
    controller endpoint publication, `Hab`/`Habery` feed that material through
    normal reply acceptance on open/reopen, and `tufa agent` only falls back to
    synthesized localhost controller state when no alias config exists and
    accepted state is still incomplete.
32. Mailbox polling timeout policy is now explicitly split by responsibility:
    short request-open guard, KERIpy-shaped long-poll duration, and bounded
    command-local turn budget. `MailboxPoller` remains the TS-native port of
    KERIpy `Poller`, while `MailboxDirector` keeps topic/cursor/query-cue
    coordination and long-lived runtime polling restores one concurrent remote
    worker per endpoint. The finite/infinite API split matters too:
    `MailboxPoller.processOnce()` returns typed mailbox batches so bounded
    callers can preserve per-source ingestion boundaries explicitly, while
    long-lived `pollDo()` stays sink-based because concurrent workers do not
    have a natural finite return value.

## Current Follow-Ups

1. Promote the highest-value DB `Partial` rows with evidence, especially
   `fetchTsgs` and the `Komer` family.
2. Preserve CESR parser/serder/primitive parity without reopening settled
   architecture unless KERIpy or regression evidence forces it.
3. Continue honest runtime closure around bounded init/incept convergence,
   shared-mailbox forwarding on top of the runtime-composed provider
   `Mailboxer`, broader exchange/forwarding route breadth beyond the now-proven
   mailbox add plus `/challenge` interop slice, and the remaining stale/timeout
   continuation tail now that the broader query/reply, receipt/query, and first
   challenge/exchange slices are landed. Mailbox polling itself now has an
   explicit timeout split and KERIpy-shaped long-lived worker concurrency;
   remaining timeout work should be about other continuations, not reopening
   this poller seam.
4. Keep maintainer-facing docs and referenced contracts in sync with behavior
   changes in the same change set, especially the new cross-runtime cue
   architecture doc when mailbox/query/OOBI wiring changes.
5. Keep KERI storage tuple aliases derived from CESR structing descriptors and
   resist reintroducing duplicate wrapper families or raw seal-shape parsing in
   runtime code.
6. Keep this memory layer compact. If a future update cannot be summarized
   cleanly, the real problem is probably unresolved design, not missing prose.
7. Treat `tufa agent` source-vs-npm drift as a release blocker. If CLI flags or
   Node hosting change, the tarball smoke path must prove the published entry
   point still starts cleanly.
8. When a workflow needs external bootstrap config during `init` or `incept`,
   keep the file input explicit at the CLI surface so scripts can use arbitrary
   filesystem locations without hidden config-path coupling.
9. Keep Gate E/G e2e scripts honest about single-store ownership. For
   controller-to-controller challenge coverage, run sender CLI commands only
   when that sender's store is not also owned by a live `tufa agent`, and let
   the recipient host be the only live process on the receiving store.
10. Keep hosted-prefix selection explicit and conservative. System-managed
    identities such as signatory/AEID-related identities should not leak into
    ordinary user-facing host startup just because they exist in the local
    keystore.

## 2026-04-04 - Escrow Replay Control Flow Should Be Explicit

- `Kevery` receipt/query replay, `Revery` reply replay, and DB `Broker` retry
  flows should all use the same typed `accept` / `keep` / `drop` replay
  vocabulary instead of ad hoc string unions or exception-only branching.
- `keep` is the typed mirror of KERIpy's recoverable unverified/query-not-found
  control paths, while `drop` is for stale/corrupt rows that must be removed and
  `accept` is successful unescrow.
- Reprocess loops should switch on the typed decision and decide side effects
  there. Do not collapse all non-keep cases into one boolean test, because
  different drop reasons can require different cleanup behavior.

## 2026-04-04 - Structing Boundary Rules Matter More Than Helper Names

- Fixed-field disclosure commitments (`BlindState`, `BoundState`, `TypeMedia`)
  must compute their blinded `d` field from the primitive-field `qb64`
  serialization with a dummied `d`, not from crew/SAD strings. Empty nonce and
  text projections make those two representations diverge.
- Keep raw `ked.a` / `serder.seals` access wherever the rule is structural
  rather than semantic. Example: non-transferable inception rejects any raw seal
  payload before typed projection is relevant.
- The useful KERIpy `Blinder` behavior ports cleanly as pure CESR helper
  functions (`makeBlindUuid`, `makeBlindState`, `unblindBlindState`, etc.), but
  those verbs belong in a dedicated disclosure module, not in `structing.ts`.
- Keep `structing.ts` as the fixed-field schema/conversion layer, keep
  `blinder.ts` / `mediar.ts` as counted-group transport wrappers, and put the
  blind/unblind/commit workflow in `primitives/disclosure.ts`.

## 2026-04-05 - Mailbox Parity Needs Two Durable Stores, Not One

- The real mailbox boundary is now explicit in code: `Mailboxer` is the
  recipient-side stored inbox on a mailbox provider, while `Outboxer` is the
  sender-side retry queue for mailbox-targeted outbound delivery. Do not fold
  sender retry state back into `Mailboxer` or `Baser`.
- `Poster` now follows mailbox-first semantics: if a recipient has authorized
  mailboxes, send to those mailboxes and queue failed targets durably per
  mailbox endpoint. Direct controller/agent delivery is only the fallback when
  no mailbox is configured.
- `POST /mailboxes` can be built honestly on existing protocol truth in `ends.`.
  The server does not need a second mailbox-grant authority store; it needs to
  verify submitted `kel` + signed `/end/role/add|cut`, ingest them through the
  normal runtime, and treat accepted `ends.` state as the operational
  authorization.
- `/fwd` acceptance must be request-context-aware. The missing ingredient was
  not more DB rows, it was knowing which hosted mailbox AID the request actually
  hit. Request path -> hosted mailbox identity now gates whether a forwarded
  payload is stored at all.
- `tufa mailbox add/remove/list/update/debug` are now live local/runtime
  surfaces with focused tests, and mailbox add interop is now proven in both
  directions with live mailbox-polled `/challenge` delivery. The honest
  remaining mailbox work is broader route/topic coverage, not whether the
  add/list/debug lifecycle exists.
- KERIpy CESR HTTP mailbox transport has one non-negotiable rule: one CESR
  message per HTTP request, with that message body in the request body and only
  that message's attachments in `CESR-ATTACHMENT`. Treat whole-stream-in-one-
  request header mode as false parity. `keri-ts` now splits header-mode
  multi-message streams that way, while `body` mode remains a Tufa-only mailbox
  option.
- `Outboxer` is a Tufa-only additive sidecar. It must stay opt-in at `init` time
  and transparent to KERIpy compat stores so mailbox interop/debugging can
  reason in KERIpy's mental model first.
- `tufa mailbox start` needs to be treated as a real porcelain, not
  `agent --mailbox`. The durable seam is:
  - create-or-reopen habery
  - ensure one non-transferable mailbox AID for the selected alias
  - ensure self `loc`, `controller`, and `mailbox` state through the normal
    runtime/reply path
  - run the existing indirect-mode host with one explicit service hab and one
    hosted-prefix filter The real problem it solves is startup ownership, not
    transport semantics.
- Hosted-prefix filtering and OOBI serving are related but not identical.

## 2026-04-06 - Provider Mailbox Storage Moved Out Of `Habery`

- The real mailbox ownership correction is now explicit: provider-side
  `Mailboxer` scope is still shared per habery environment, but it is no longer
  a `Habery` dependency or field.
- `createHabery()` now reopens only core habery state. Provider mailbox storage
  is composed above it by `createAgentRuntime()` or by explicit standalone
  mailbox tooling.
- `MailboxDirector` and `Poster` must receive mailbox storage explicitly when a
  runtime actually serves or writes provider-side mailbox traffic. Do not
  rebuild the old `hby.mbx` mental model through helper indirection.
- Generic local runtimes stay mailbox-store-free by default. Indirect/mailbox
  host runtimes are the default place that auto-open and own mailbox storage.
  Runtime-owned mailbox stores must be closed by `runtime.close()`, while
  injected mailbox stores remain caller-owned. `mailbox start` should serve only
  the selected local prefix, and non-root advertised base paths should not
  silently reopen root-scoped OOBI access just because the AID is locally
  controlled.
- Current verification caveat: the new `mailbox start` local lifecycle tests are
  strong, but subprocess-heavy interop runs can still be polluted by a Deno
  2.7.10 N-API panic (`Cannot remove cleanup hook which was not registered`)
  during `deno run` child processes. Treat that as an environment/tooling
  failure first, not immediate evidence that the mailbox-start codepath is
  wrong.

## Templates

### New Thread Kickoff Template

```text
Use AGENTS.md startup protocol.
Read PROJECT_LEARNINGS.md and relevant topic learnings docs.
Summarize current state in 10 bullets.
Then do task: <TASK>.
```

### End-of-Task Handoff Template

```text
### YYYY-MM-DD - <Task Title>
- Substance: <1-3 durable changes in ownership, invariants, parity rules, or mental model>
- Why it matters: <what future work would get wrong without this>
- Next: <remaining blocker, risk, or follow-up if any>
- Verification: <passed locally / pending CI / not run>
```

### 2026-04-07 - Sign/Verify/Query/Rotate Parity Landed On Two Different Critical Paths

- Substance: `tufa sign` and `tufa verify` were mostly CLI-orchestration ports over existing habitat/manager crypto seams, but `tufa rotate` needed a real `Hab.rotate(...)` ownership seam so keeper progression, event construction, local acceptance, and rollback all stay coupled the same way KERIpy expects.
- Why it matters: the false mental model was "rotate is just another CLI wrapper like sign/verify." It is not. Without a habitat-level rotate seam, the CLI either duplicates keeper/KEL invariants or quietly gets rollback wrong.
- Next: if multisig/group parity work starts, do not extend the single-sig CLI directly. Re-open the habitat/manager ownership boundary first.
- Verification: local unit/integration/interop coverage passed for single-sig sign -> query -> rotate parity.
