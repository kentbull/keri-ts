# Project learnings

Routing and durable rules only. Current source, tests and normative contracts
outrank these summaries. The [parity roadmap](../docs/plans/PARITY_ROADMAP.md)
owns remaining work; do not duplicate its checklist here. Parser structure,
nested consumers and optional KRAM intake are implemented. Explicit contracts,
component ownership, storage/transport reconciliation and final qualification
remain incomplete.

## Read by subject

- [CESR](learnings/PROJECT_LEARNINGS_CESR.md): parsing, framing and primitives.
- [Crypto](learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md): suites, sodium and secrets.
- [KELs](learnings/PROJECT_LEARNINGS_KELS.md): accepted state, delegation and replay.
- [Exchange](learnings/PROJECT_LEARNINGS_EXCHANGE.md): proofs, multisig and IPEX.
- [ACDC](learnings/PROJECT_LEARNINGS_ACDC.md): disclosure, TEL and verifier state.
- [Storage](learnings/PROJECT_LEARNINGS_STORAGE.md): DB parity and payload owners.
- [Runtime](learnings/PROJECT_LEARNINGS_RUNTIME.md): scopes, transport and mailboxes.
- [DID](learnings/PROJECT_LEARNINGS_DID.md): generation, resolution and aliases.
- [Infrastructure](learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md):
  test provenance, witness harnesses, packaging and release.

## Cross-topic rules

[ADR-0013](../docs/adr/adr-0013-simple-component-flows.md) governs component
flows and explicit contracts and supersedes conflicting older blanket budget,
reservation, and runtime-container guidance. Its implementation is incomplete.
The 2026-10-15 decision requires complete removal of application accounting and
unsupported outbox/mailbox-consumer/KRAM-ready durability. Only a minimal private
socket constraint supported by production evidence may remain. No no-op policies,
renamed ledgers or dormant hooks. Preserve real protocol state and resource cleanup;
old keri-ts API/data compatibility is not required. Add no migration readers,
upgrade machinery or new-to-old version tests.
ResourcePolicy, accounting errors and constructor plumbing are removed throughout
CESR/KERI/Tufa; RuntimeServices contains only clock/HTTP. Queue/client/listener and
reply-proof work caps are removed; intrinsic numeric guards use RangeError.
Cue queues and reply correlations now carry ordinary Deck records. Composition
routes directly to query, mailbox and reply owners; optional CueSink hooks and
root adapters are removed. Reactor returns dispatch data, captures replies before
publishing its protocol Deck, and offers no application callback gate. Default
query transport cannot be a no-op sink. Finite commands await state/deadlines over
the host workers, joining them before teardown; serial runtime pumping remains
removal work. Local endpoint/startup intake uses direct protocol processing; host
composition has no fake per-Hab seeding phase. Publish after
owning writes/commit; preserve real iterator, reader and payload cleanup. Do not
restore queue credit, capacity, inspection or synthetic retain/release handles.
Use concrete semantic records, narrow validated input, and locally justified
open boundaries. Diagnostic metadata must not drive domain control flow.

ADR-0012 now requires one buffered finite decoder. The progressive engine, cursor and parser-owned staging are removed.
The custom Effection frame bridge and TcpRead are removed.
Buffer complete counted enclosures before synchronous decoding; accept the group
memory/latency tradeoff. Parsing/finite annotation have no cancellation options;
KERI/Tufa input operations stop buffered or waiting work and concrete I/O owns
interruption and joined cleanup.
Composition points depend downward: transport lends actual sockets/byte streams;
application flows compose parsing/dispatch without an AgentRuntime dependency in transport.
Ordinary hydrated frames require no disposal; actual I/O owners join cleanup.
Parsed evidence, wrapper construction, verified acceptance and durable publication
are separate boundaries. Validation returns delegation-hint repairs as data;
the processing owner persists them in its transaction, never during lookup.
Parent signatures never authenticate nested children.
Public registry intake borrows issuer KEL state independently of local Hab aliases.
Accepted legacy bytes remain readable; new intake requires full witnessed tuples.
Raw evidence stays separate from opt-in strict seal projection.
Native addon loading alone is not runtime compatibility; qualify large-row paths.
Native row lifetimes and active writers remain correct without copy billing.

Active KERIpy parity targets `7143832813cac6a394ab1faf9be83bb3372be87c`.
Keep historical 927 fixtures and fork/legacy compatibility results labeled by their actual sources.

Kever returns decisions and describes follow-up work without a queue. Baser owns
accepted event/FEL row persistence; Kevery keeps processing and publication policy.

Normal remote outcomes use typed decisions. Exceptions retain invariant,
infrastructure and caller-contract failures. Diagnostic messages stay separate
from standard Error.cause, which preserves actual underlying failures,
never a substitute metadata bag. Keep protocol compatibility and
frozen-reference evidence explicit; no old TypeScript API shims are required.
Logical accounting never established a process-memory guarantee. Remove its
plumbing rather than transferring it to another owner. Streaming remains required
where KERIpy supports it; native backpressure and real cleanup remain independent.
KERIpy parity comes first; optional additions are proposals, not implementation gates.
Selective inter-component streaming may reuse existing engines for a concrete
benefit after parity priorities; it does not restore a stack-wide mandate.
During deletion/refactoring, PRs may contain 1,000–3,000 changed lines when that
completes one cohesive mechanism removal. Count verification and docs; avoid
artificial slices that require temporary accounting interfaces or repeated caller
edits. Smaller cuts remain appropriate at real ownership boundaries.
Reuse tests; new maintained integration/end-to-end coverage needs strong
justification. Exploratory probes may remain uncommitted. Choose narrow unit
regressions with durable value, not new test scaffolding by default.

## Maintenance and handoff

Read `AGENTS.md`, this index, relevant topics and their contracts at session start.
Update the owning topic in place when a durable rule changes. Keep plans in
`docs/plans`, behavior in `docs/design-docs`, dated evidence in `docs/reports`,
and examples/inventories in `docs/reference`. Do not append session or milestone
diaries to learnings; Git history retains superseded text.

Kickoff: ten concise current-state bullets, then a concise execution plan.
Handoff: result, changed contracts, checks, remaining blocker/risk. Record only
the durable substance and why future work needs it; link detailed evidence.
