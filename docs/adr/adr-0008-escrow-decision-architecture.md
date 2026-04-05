# ADR-0008: Escrow Decision Architecture

- Status: Accepted
- Date: 2026-04-05
- Scope: `packages/keri` escrow-heavy verifier/orchestrator architecture
- Related:
  - `docs/adr/adr-0003-agent-runtime-composition-root.md`
  - `docs/adr/adr-0004-cue-runtime-portability.md`
  - `docs/adr/adr-0005-kel-decision-control-flow.md`
  - `packages/keri/src/core/eventing.ts`
  - `packages/keri/src/core/routing.ts`

## Context

KERIpy uses a doer-oriented architecture where normal remote-processing branches
often move through exceptions plus retry loops:

- `Kevery` uses exception-style branching around event, receipt, and query
  escrow
- `Revery` uses verification plus escrow replay flows that fit naturally into
  Python doer loops
- `Tevery` and similar processors follow the same general mental model:
  verification logic, exception-driven branch exits, and later retry by escrow
  processing

That architecture has real strengths:

- it is compact
- it keeps branch logic close to the original validation site
- it aligns with KERIpy's existing runtime and doer assumptions

But it also has real costs when ported directly into TypeScript:

- expected outcomes can disappear behind `throw` paths
- replay behavior becomes harder to inspect statically
- "not yet decidable" and "programming/infrastructure failure" are easy to mix
- maintainers must reverse-engineer normal branch surfaces from exception names
  plus surrounding catch/retry code

`keri-ts` has already moved away from that style in implemented areas:

- `Kevery` event processing uses typed KEL decisions: `accept`, `duplicate`,
  `escrow`, `reject`
- receipt, query, and reply replay paths use typed escrow replay decisions such
  as `accept`, `keep`, and `drop`
- `Revery` reply replay follows the same replayable decision model instead of a
  catch-and-retry loop

The repo now needs a broader architectural statement than ADR-0005 alone.
ADR-0005 covers KEL decision flow specifically. It does not fully state the
cross-subsystem escrow pattern that now spans `Kevery`, `Revery`, and future
`Tevery`-style work.

## Decision

`keri-ts` standardizes on explicit escrow decision architecture for normal
processing branches.

Concretely:

- normal escrow-driving outcomes must be typed, named, and replayable
- durable escrow families own explicit persistence helpers and replay helpers
- replay helpers must return typed outcomes instead of relying on recoverable
  exception control flow
- exceptions remain reserved for truly exceptional cases:
  - corrupt durable state
  - impossible invariant violations
  - malformed programming use
  - lower-level infrastructure failures

This does not prohibit exceptions. It prohibits using exceptions as the primary
representation for normal expected remote-processing branches.

## Architectural Rule

For escrow-heavy processors, maintainers should expect three layers:

1. Decision layer
   - evaluate whether the input is accepted, retryable, duplicate, or terminal
   - return a typed decision with a labeled reason

2. Persistence layer
   - write the durable artifacts required for replay
   - keep family-specific storage explicit

3. Replay layer
   - reconstruct enough normalized input to run the same decision logic again
   - map the result into replay decisions such as `accept`, `keep`, and `drop`

This rule applies today to:

- event escrows in `Kevery`
- receipt/query replay in `Kevery`
- reply escrow in `Revery`

It should guide future ports such as:

- `Tevery`
- other verifier/orchestrator pairs with durable retry semantics

## Why `keri-ts` Chose This Shape

### Benefits Compared To KERIpy

1. Branch surfaces are visible in the type system.
   - A maintainer can inspect expected outcomes directly instead of inferring
     them from exception names and retry loops.

2. Replay symmetry is easier to reason about.
   - The same logic that decides live processing can usually drive replay.
   - This reduces "special replay code" drift.

3. Tests become sharper.
   - Tests can assert exact decision kinds and reasons, not only eventual side
     effects or caught exception classes.

4. Ownership boundaries become clearer.
   - `Kever` decides accepted-state validity.
   - `Kevery` owns routing, escrow persistence, replay orchestration, and
     higher-level side effects.
   - `Revery` owns reply verification, BADA acceptance, reply escrow, and reply
     replay.

5. Maintainer onboarding improves.
   - Expected normal branch behavior is explicit and documented, which matters
     more in TypeScript where exception-driven normal flow feels less native.

### Costs Compared To KERIpy

1. More types and helper seams.
   - The code is more verbose.

2. More documentation burden.
   - The architecture is only a win if the decision types and helpers stay named
     and well documented.

3. Some logic must be split.
   - Evaluation and mutation often live in separate helpers instead of one
     compact body.

4. A direct line-by-line port becomes harder.
   - KERIpy and `keri-ts` may share behavior but not control-flow shape.

These costs are accepted because they buy a more maintainable and inspectable
TypeScript implementation.

## Comparison With KERIpy

### What KERIpy Still Does Well

- compact local expression of branch logic
- natural fit for HIO doer loops
- lower immediate ceremony when adding one more escrow family

### What KERIpy Makes Harder For `keri-ts` Maintainers

- identifying which exceptions are normal control flow versus true failure
- understanding replay semantics without tracing multiple loops
- proving that live and replay behavior remain aligned
- teaching new maintainers where semantic ownership ends and retry machinery
  begins

### What `keri-ts` Gains

- explicit live decisions
- explicit replay decisions
- explicit persistence helpers
- clearer subsystem boundaries

### What `keri-ts` Pays

- more named helper functions
- more labels and small types
- more comments and ADR-level explanation required to keep the verbosity honest

## Current Examples

### `Kevery` Event Escrows

`Kevery` uses typed event decisions for normal remote event processing:

- `accept`
- `duplicate`
- `escrow`
- `reject`

It then persists or applies the result through explicit orchestrator-owned
helpers instead of catching expected remote-processing exceptions.

### `Kevery` Receipt And Query Replay

Receipt families and query-not-found replay use explicit replay decisions:

- `accept`
- `keep`
- `drop`

This makes timeout policy, stale policy, and missing-artifact handling visible
without hiding them behind recoverable exception control flow.

### `Revery` Reply Escrow

`Revery` persists partially verifiable transferable replies in explicit reply
escrow and replays them through a typed replay path. Missing signer state emits
an incomplete `query` cue instead of collapsing correspondence and retry logic
into one opaque exception path.

## Consequences

- New escrow families should begin with an explicit decision taxonomy.
- Replay helpers should prefer reconstruct-and-decide over special-case retry
  branches.
- Maintainers should document the decision and replay contracts when porting a
  new escrow-heavy KERIpy subsystem.
- Future `Tevery`-style work should treat this ADR as the default architectural
  rule unless a branch is truly exceptional in `keri-ts`.

## Notes

ADR-0005 remains the narrower KEL decision-flow ADR. This ADR does not replace
it; it generalizes the same philosophy into a repo-wide escrow architecture rule
for verifier/orchestrator pairs.
