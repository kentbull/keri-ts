# Project learnings

Routing and durable rules only. Current source, tests and normative contracts
outrank these summaries. The [parity roadmap](../docs/plans/PARITY_ROADMAP.md)
owns remaining work; do not duplicate its checklist here. Parser structure,
nested consumers and optional KRAM intake are implemented. Shared budgets,
storage/transport reconciliation and final qualification remain incomplete.

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

One progressive parser engine; CESR stays framework-neutral with an optional
Effection adapter. KERI/Tufa own cancellable operations and joined cleanup.
Consume-scoped hydration joins disposal and propagates cleanup failures before returning.
Retryable handoff acknowledges after disposal; callback effects remain at least once.
Parsed evidence, wrapper construction, verified acceptance and durable publication
are separate boundaries. Parent signatures never authenticate nested children.
Public registry intake borrows issuer KEL state independently of local Hab aliases.
Accepted legacy bytes remain readable; new intake requires full witnessed tuples.
Raw evidence stays separate from opt-in strict seal projection.
Native addon loading alone is not runtime compatibility; qualify large-row paths.
Pinned nested-row preflight preserves active writers; shared copy admission remains separate.
Finite retry credit precedes native row materialization and outlives joined transport/cursor cleanup.

Active KERIpy parity targets `7143832813cac6a394ab1faf9be83bb3372be87c`.
Keep historical 927 fixtures and fork/legacy compatibility results labeled by their actual sources.

Kever returns decisions and describes follow-up work without a queue. Baser owns
accepted event/FEL row persistence; Kevery keeps processing and publication policy.

Normal remote outcomes use typed decisions. Exceptions retain invariant,
infrastructure and caller-contract failures. Keep protocol compatibility and
frozen-reference evidence explicit; no old TypeScript API shims are required.
Finite local limits do not establish a shared in-flight memory bound.
Baser fixes the deployment policy before reopen; runtime inherits it. This release
bounds in-flight work and reports accepted-state growth separately. Streaming is
required where KERIpy 714 supports it. New caches, accepted-state API redesign,
further stack-wide streaming and exhaustive CBOR extension accounting are deferred.
KERIpy parity comes first; optional additions are proposals, not implementation gates.
Selective inter-component streaming may reuse existing engines for a concrete
benefit after parity priorities; it does not restore a stack-wide mandate.
PRs target 300–500 added or removed lines or fewer, including verification.
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
