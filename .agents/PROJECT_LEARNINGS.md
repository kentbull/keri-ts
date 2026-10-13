# Project learnings

Routing and durable rules only. Current source, tests and normative contracts
outrank these summaries. The [parity roadmap](../docs/plans/PARITY_ROADMAP.md)
owns remaining work; do not duplicate its checklist here. Parser structure and
nested consumers are implemented, while optional KRAM intake, shared budgets,
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
Parsed evidence, wrapper construction, verified acceptance and durable publication
are separate boundaries. Parent signatures never authenticate nested children.
Public registry intake borrows issuer KEL state independently of local Hab aliases.
Raw evidence stays separate from opt-in strict seal projection.

Normal remote outcomes use typed decisions. Exceptions retain invariant,
infrastructure and caller-contract failures. Keep protocol compatibility and
frozen-reference evidence explicit; no old TypeScript API shims are required.
Finite local limits do not establish a shared runtime memory bound.
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
