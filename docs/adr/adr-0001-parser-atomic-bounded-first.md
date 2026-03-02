# ADR-0001: Parser Architecture - Atomic Bounded Substream First

- Status: Accepted
- Date: 2026-02-28
- Scope: `packages/cesr` parser architecture
- Related:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
  - `docs/plans/cesr/cesr-parser-phase0-behavior-lock-parity-matrix.md`

## Context

`keri-ts` currently prioritizes:

- parser correctness and KERIpy parity
- human readability and reviewability
- maintainable semantics for contributors and AI agents

For counted nested groups (for example `GenericGroup`,
`BodyWithAttachmentGroup`, and `AttachmentGroup` wrappers), there are two
architectural options:

1. Parse counted nested payloads atomically once complete bytes are available.
2. Parse nested payloads incrementally across chunk boundaries with resumable
   state.

Incremental nested parsing can reduce latency and peak buffering in some
workloads, but it introduces materially higher state-machine complexity.

## Decision

We intentionally choose **atomic bounded substream parsing** as the default
parser architecture for initial `keri-ts` CESR parser evolution.

Concretely:

- a counted nested group is parsed from a size-bounded payload slice once
  completely received (bytes have all arrived from I/O layer)
- nested version overrides are handled with local, function scoped state in
  bounded parses
- parser behavior is optimized first for clarity and semantic predictability,
  not maximum throughput

## Rationale

- Simpler mental model for maintainers and reviewers.
- Smaller bug surface for chunk-boundary and resume behavior.
- Easier parity mapping to KERIpy semantics at the behavior level.
- Faster onboarding and lower cognitive load during protocol-level review.

## Consequences

Positive:

- clearer code and tests
- fewer parser states to reason about
- easier debugging of boundary and version-context behavior

Negative:

- added latency inside large counted groups (must wait for full payload)
- potentially higher transient memory use for large enclosed payloads
- less opportunity for progressive emission from nested content
- coarser-grained parse units reduce opportunities for fine-grained CPU
  pipelining across nested-group parse stages (compared to resumable incremental
  parsing)

## Non-Goals (Current Phase)

- maximizing throughput for very large nested counted payload streams
- progressive nested event emission before enclosing counted group completion

## Revisit Criteria

Re-open this ADR when one or more are true:

1. Production evidence shows parser latency or memory pressure attributable to
   atomic nested parsing.
2. Adoption scale justifies complexity cost for a higher-performance parser
   mode.
3. Benchmarks show a clear gain from resumable nested parsing that matters for
   real workloads.

If revisited, prefer introducing incremental nested parsing as a **separate
parser strategy/module**, not by replacing the readable atomic path in-place.

## Appendix A: Incremental Nested Parser Cognitive Stub (Future)

This appendix is intentionally a lightweight design outline to support future
implementation planning without committing to immediate execution.

### A1. High-Level Model

Use an explicit stack of parse frames:

- each frame represents one active counted group parse scope
- each frame stores:
  - group code/name
  - remaining bytes in the group payload
  - local version context
  - local mode (body parse, attachment parse, wrapper parse)
  - partial token state (if paused mid-token)

### A2. Suggested Core Types

- `ParserRuntimeState`
  - `streamVersion`
  - `frameStack: ParseFrame[]`
  - `pendingTopFrame`
  - `buffer/window`
- `ParseFrame`
  - `code`
  - `remaining`
  - `version`
  - `phase`
  - `accumulator`

### A3. Resume Semantics

On each `feed()`:

1. Continue top stack frame if any.
2. If a frame completes, pop and merge result into parent frame.
3. When root frame completes, emit a complete `CesrMessage`.

On `flush()`:

- if root frame complete: emit
- if truncated frame/token remains: emit deterministic shortage error

### A4. Version Handling Rules

- top-level genus-version updates `streamVersion`
- entering counted groups inherits current version into a new frame
- enclosed genus-version updates that frame's local version
- popping frame restores previous version by normal stack unwind

### A5. Rollout Plan (If Adopted)

1. Add behind feature flag or explicit parser mode.
2. Reuse the existing parity matrix vectors first.
3. Add dedicated interruption matrix: every split boundary through nested
   groups.
4. Keep atomic strategy as reference implementation until incremental reaches
   parity and benchmark goals.
