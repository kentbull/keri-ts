# CESR Parser Readability Improvement Plan

## Status

- Created: 2026-02-27
- Archived as historical reference: 2026-04-09
- Outcome: substantially completed; parser readability work is now governed by
  the normative parser contract plus the durable decisions summarized here

## Purpose

Capture the durable readability goals behind the CESR parser cleanup without
preserving the full implementation diary.

## Durable Outcomes

1. The parser lifecycle contract is explicit and normative in
   `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`.
2. Parser architecture stayed readability-first and
   atomic/bounded-substream-first.
3. Parser control flow was decomposed into smaller collaborators and clearer
   seams rather than one expanding parser monolith.
4. Boolean policy branching moved toward explicit policy/strategy seams.
5. Attachment payloads moved toward typed/discriminated models rather than
   `unknown[]`.
6. Dispatch metadata is driven from declarative specs rather than scattered
   hard-coded tables.
7. Recovery behavior is explicit, observable, and policy-gated.
8. Syntax extraction and semantic interpretation are separated on the
   highest-coupling parse paths.
9. Parity-oriented lock tests were treated as the safety net for readability
   refactors.
10. Performance work was deliberately deferred behind readability-safe seams.

## Implemented Work

1. Published the parser state-machine contract.
2. Introduced policy seams such as frame-boundary and fallback policies.
3. Added typed attachment payload modeling.
4. Centralized group-dispatch metadata in a declarative spec.
5. Added structured recovery diagnostics and removed implicit compat warning
   side effects.
6. Split syntax vs semantic interpretation on frame-start, native-body, and
   mapper paths.
7. Expanded parity-oriented behavioral lock coverage.
8. Normalized key naming/terminology where ambiguity was obscuring the mental
   model.
9. Kept deferred perf work out of the main readability path.

## Design Principles

1. Make state transitions explicit.
2. Prefer policy injection over boolean branch accumulation.
3. Keep parser/router boundaries explicit.
4. Use typed domain models where payload shape matters.
5. Preserve behavior with tests before changing structure.
6. Optimize for maintainer reviewability before speed tricks.

## Remaining Rule

Future parser work should use this archived plan only as historical context.
Active authority is now:

1. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
2. `docs/design-docs/cesr/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. The current CESR learnings doc
