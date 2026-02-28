# PROJECT_LEARNINGS (Index)

## Purpose

Top-level memory index for `keri-ts`. This file is the routing layer, not the deep detail layer.

Use it to:

1. identify current focus areas,
2. locate the right topic learnings doc(s),
3. keep a concise cross-topic summary,
4. apply consistent handoff updates.

## Current Focus

1. CESR parser readability roadmap execution (Point 1 completed on 2026-02-28; Point 2 decomposition is next).
2. KERIpy parity preservation via normative parser contract + parity matrix updates.

## Topic Learnings Index

| Topic                          | File                                                                             | Scope                                                                         |
|--------------------------------|----------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| CESR Parser                    | `docs/design-docs/learnings/PROJECT_LEARNINGS_CESR.md`                           | Parser architecture, state machine contract, parity vectors, roadmap progress |
| Crypto Suite                   | `docs/design-docs/learnings/PROJECT_LEARNINGS_CRYPTO_SUITE.md`                   | Key material, primitives, signing/verification behavior and interop           |
| KELs                           | `docs/design-docs/learnings/PROJECT_LEARNINGS_KELS.md`                           | Event logs, state transitions, replay/verification semantics                  |
| ACDC                           | `docs/design-docs/learnings/PROJECT_LEARNINGS_ACDC.md`                           | Credential issuance/exchange semantics and data-model concerns                |
| Witness/Watcher/Observer Infra | `docs/design-docs/learnings/PROJECT_LEARNINGS_WITNESS_WATCHER_OBSERVER_INFRA.md` | Network roles, deployment, ops/interoperability notes                         |

## Context Pack Policy

At session start:

1. Read `AGENTS.md`.
2. Read this file.
3. Read only the topic doc(s) relevant to the requested task.
4. Read any contract/ADR/plan docs referenced by those topic docs.

This keeps context focused and avoids long-thread drift.

## Splitting Policy

1. Split a topic learnings doc when it grows beyond about 250 lines.
2. Caveat: keep tightly coupled notes together when splitting would reduce clarity.
3. Keep top-level index concise; do not duplicate deep technical detail from topic docs.

## Cross-Topic Snapshot

### 2026-02-28

1. Canonical parser state-machine contract is established and test-mapped.
2. P0/P1 parity vectors are complete; breadth moved to dedicated P2 hardening plan.
3. Stream-order rule is explicit when `pendingFrame` and `queuedFrames` coexist.
4. Docs now link architecture, plans, ADR, and lifecycle contract as a coherent set.
5. Ten-point readability plan milestone status is explicit: Point 1 complete, Point 2 next.

## New Thread Kickoff Template

```text
Use AGENTS.md startup protocol.
Read PROJECT_LEARNINGS.md and relevant topic learnings docs.
Summarize current state in 10 bullets.
Then do task: <TASK>.
```

## End-of-Task Handoff Template

```text
### YYYY-MM-DD - <Task Title>
- Topic docs updated:
  - <topic file path(s)>
- What changed:
  - ...
- Why:
  - ...
- Tests:
  - Command: ...
  - Result: ...
- Contracts/plans touched:
  - ...
- Risks/TODO:
  - ...
```
