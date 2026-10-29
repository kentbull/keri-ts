# Project learnings

Routing and durable rules only. Current source, tests and normative contracts
outrank these summaries. The [parity roadmap](../docs/plans/PARITY_ROADMAP.md)
owns remaining work. Buffered parsing, accounting/durability removal, concrete
component ownership and the public runtime API reduction are implemented; the 1.0.0
cleanup/release baseline is qualified. The [release report](../docs/reports/parity/CLEANUP_RELEASE_2026-10-16.md)
owns its evidence and limits; future changes still require relevant qualification.
Post-release Tevery ownership (#523) has separate scoped evidence and is not in
published 1.0.0. Historical inventories must never become fresh implementation
queues; the roadmap owns remaining parity work and accepted deployment boundaries.
The [runtime contract](../docs/design-docs/runtime/INGRESS_AND_EGRESS.md) owns current
cue, protocol, transport and resource-lifetime behavior. Poster owns queued output;
producers prepare messages, and concrete messengers own attempts and input-specific
parsers over shared protocol processing. Composition supplies explicit dependencies.
Provider mailbox storage is independent from direct intake and remote polling.
Reactor accepts awaited sources/bytes; its unused input queue and worker are removed.

The runtime contract records the exact routing/lifecycle source pins and deliberate
source exceptions. The [reliability roadmap](../docs/plans/runtime/cue-reliability-roadmap.md) retains deferred
capabilities. Completed execution plans and declaration ledgers are removed; Git/PR
history owns delivery chronology. Do not update plan files for routine progress.

The [compatibility inventory](../docs/reference/compatibility/KERI_V1_V2_COMPATIBILITY.md)
owns the v1/v2 matrix and implemented bridges. The
[dependency qualification report](../docs/reports/runtime/EXPLICIT_RUNTIME_DEPENDENCIES_2026-10-19.md)
retains exact source identity, validation and limits at its recorded revision.

## Read by subject

- [CESR](learnings/PROJECT_LEARNINGS_CESR.md): parsing, framing and primitives.
- [Crypto](learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md): suites, sodium and secrets.
- [KELs](learnings/PROJECT_LEARNINGS_KELS.md): accepted state, delegation and replay.
- [Exchange](learnings/PROJECT_LEARNINGS_EXCHANGE.md): proofs, multisig and IPEX.
- [ACDC](learnings/PROJECT_LEARNINGS_ACDC.md): disclosure, TEL and verifier state.
- [Storage](learnings/PROJECT_LEARNINGS_STORAGE.md): DB parity and exchange evidence.
- [Runtime](learnings/PROJECT_LEARNINGS_RUNTIME.md): scopes, transport and mailboxes.
- [DID](learnings/PROJECT_LEARNINGS_DID.md): generation, resolution and aliases.
- [Infrastructure](learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md):
  test provenance, witness harnesses, packaging and release.

## Cross-topic rules

[ADR-0013](../docs/adr/adr-0013-simple-component-flows.md) governs concrete
KERIpy-shaped owners, records and Decks. Refactor responsibility/contracts first,
then behavior. No runtime-shaped sibling bundles, generic execution gates or
forwarding-only facades. Lower transport knows actual byte I/O, not AgentRuntime. Tevery owns TSN route
admission/retries; ProtocolProcessor advances the composed processor without naming
its registry/credential handlers.
Application boundaries select optional owners before effects; subordinate helpers receive
concrete dependencies, not root lookup guards. Finite commands run the host workers under elapsed deadlines and join them before
store teardown; phase-specific tests invoke actual component operations.

No application accounting, quotas, estimates, synthetic leases or no-op policy
hooks. Only a minimal private socket constraint with observed production evidence
could be justified. Outboxes and unsupported mailbox-consumer/KRAM business
acknowledgements are removed. Keep protocol escrows/caches, accepted evidence,
mailbox messages/cursors, transactions and real cleanup. No old keri-ts API/data
compatibility, migration readers or new-to-old tests.

[ADR-0012](../docs/adr/adr-0012-progressive-nested-parser.md) requires complete
counted enclosures before synchronous decoding. Progressive engines, cursors,
parser-owned staging, FrameIntake and TcpRead are removed. Ordinary hydrated frames
need no disposal. Concrete inputs own cancellation and joined I/O cleanup; native
backpressure is not a process-memory guarantee. Streaming remains where supported
by KERIpy; selective new streaming needs a concrete benefit, not a stack-wide rule.

Parsed evidence, construction, verification and durable publication are separate
boundaries. Parent signatures never authenticate children. Decisions return data;
owners persist within their transactions and publish live state/cues after commit.
Kever decides; Kevery owns routing/publication; Baser owns accepted event/FEL rows.
Validation lookup must not persist delegation repairs. Independent DB environments
are not one atomic transaction. Raw partial registry evidence remains distinct from
accepted witnessed tuples; issuer KEL access does not require a local Hab alias.

Use semantic records, validated unknown input and locally justified open boundaries.
Normal remote outcomes use typed decisions; invariant, infrastructure and caller
failures remain exceptions. Diagnostics never drive domain behavior or replace an
actual Error.cause. CESR owns shared KERI CBOR encoding and exact byte parity.

Public exports are supported operations/data, not module wildcards. Named KERI
root/runtime/db entrypoints and the separate Tufa cli helper boundary replace
app/core/db/vdr deep imports. Source smoke or native addon loading alone does not
qualify installed packages, strict declarations or real LMDB large-row behavior.

Recorded frozen table/vector reference: `7143832813cac6a394ab1faf9be83bb3372be87c`.
Keep historical fixtures, current upstream and mailbox-fork results labeled by
actual source. Protocol parity and qualification outrank optional additions.
Green narrow tests do not establish final composed interoperability.

The [2.0.0 preparation report](../docs/reports/parity/V2_PREPARATION_2026-10-21.md)
owns the later completed implementation/organization and unpublished qualification.
Publication waits for separate native-registry/wallet completion and affected
requalification. ProtocolProcessor remains a shared dispatch/reply-capture/escrow
owner without a mutex; multisig replay borrows its concrete matching KEL/reply owners; ESSR uses pinned-main LMDB sets and authenticated owned bytes.

## Maintenance and handoff

Read AGENTS, this index and relevant topics/contracts at session start. Rewrite the
owning topic in place; keep execution in docs/plans, behavior in docs/design-docs,
dated evidence in docs/reports and examples in docs/reference. Git retains earlier
chronology; do not append milestone diaries or duplicate the execution tracker.

Kickoff: ten concise current-state bullets, then a concise execution plan.
Handoff: result, changed contracts, checks and unfinished work/risk. Cohesive
1,000–3,000-line deletion/refactoring PRs are allowed; avoid temporary APIs merely
to split a cut. Reuse meaningful tests, preserve topology and independent protocol/
cleanup assertions, and prefer narrow regressions over new scaffolding.
