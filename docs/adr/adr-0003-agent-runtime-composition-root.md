# ADR-0003: `AgentRuntime` As A Composition Root Over Component-Owned Doers

- Status: Accepted
- Date: 2026-03-28
- Scope: `packages/keri` Gate E runtime orchestration
- Related:
  - `packages/keri/src/app/agent-runtime.ts`
  - `packages/keri/src/app/reactor.ts`
  - `packages/keri/src/app/oobiery.ts`
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`

## Context

Gate E introduced a shared `AgentRuntime` seam so the same KERI runtime work
could be hosted:

- command-local inside CLI commands such as `ends add` and `oobi resolve`
- long-lived inside `tufa agent`

The first bootstrap slice proved the viability of that seam, but the initial
shape was too flat:

- `AgentRuntime` owned ingress, OOBI jobs, completions, transport, parser,
  routing, reply handling, KEL processing, and orchestration all at once
- topic-local queues such as OOBI resolution work lived at the runtime root
- the result taught the wrong mental model to maintainers coming from KERIpy,
  where stateful components own their own queues/state and expose doer methods

In KERIpy terms, the problem was not "there is a plain helper like
`processIngress()`." KERIpy also has plain processing helpers called by doers.
The real problem was ownership: a composition root had drifted into becoming a
bag of all subsystem state.

## Decision

`AgentRuntime` is a composition root, not a bag of every runtime queue.

Concretely:

- `AgentRuntime` keeps only truly shared state:
  - `hby`
  - host `mode`
  - shared `cues` deck
- `Reactor` owns:
  - transient ingress deck
  - CESR parser
  - `Router`
  - `Revery`
  - reply route handler registration
  - `Kevery`
  - message and escrow doers
- `Oobiery` owns:
  - durable OOBI processing over `oobis.` / `coobi.` / `eoobi.` / `roobi.`
  - OOBI fetch/parse/persist flow
  - OOBI doer
- `processRuntimeTurn()` remains as a bounded single-step helper for tests and
  command-local flows, but it delegates to component-owned `processOnce()`
  methods instead of owning the architecture itself

## Effection Mapping To KERIpy

- KERIpy `Doer` -> a long-running Effection `Operation` method such as
  `msgDo()`, `escrowDo()`, or `oobiDo()`
- KERIpy `DoDoer` -> a stateful component that owns local state and exposes
  multiple doer-like operation methods
- `AgentRuntime` -> a composition root that assembles those components and hosts
  them in one shared lifecycle

This is the preferred mental model for future Gate E/F work.

## Why This Shape

1. It mirrors KERIpy's ownership model more closely. `Reactor` and `Oobiery` are
   recognizable component seams for maintainers who already think in terms of
   KERIpy reactor/OOBI doer sets.

2. It preserves the shared-runtime host goal. The same component graph still
   supports one-shot command-local hosting and long-lived `tufa agent` hosting.

3. It keeps durability where KERIpy keeps durability. OOBI queue state belongs
   in DB families such as `oobis.`, not in a root in-memory deck.

4. It keeps the shared cue model. The cue deck remains root-level because it is
   genuinely cross-component state, closer to the KERIpy mental model than
   isolated per-component cue islands.

5. It keeps the single-step test/CLI helper without turning it into the
   architecture. `processRuntimeTurn()` is retained because tests and local
   commands need a bounded step, but it is now explicitly a delegating helper
   rather than the owner of runtime flows.

## Consequences

- New runtime subsystems should usually be added as component-owned classes with
  local state plus named long-running operations, not as more root-level decks
  on `AgentRuntime`.
- Durable queue-like workflow state should default to KERIpy-style DB-backed
  storage unless there is a strong reason not to.
- Plain `process*()` helpers are still acceptable, but they should live on the
  component that owns the corresponding state/doer.
- Future Gate E/F work should prefer additions like `Exchanger` or `Tevery`
  components over enlarging the root runtime surface.
