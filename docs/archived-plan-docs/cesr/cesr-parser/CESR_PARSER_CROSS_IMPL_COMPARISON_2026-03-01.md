# CESR Parser Cross-Implementation Comparison (2026-03-01)

Historical plan: the [accepted simplification](../../../plans/PARITY_ROADMAP.md) supersedes its
architecture instructions. Do not restore progressive parsing/cursors, parser
staging/intake frameworks, delivery preparation, general Reactor gates, application
accounting, outboxes or unsupported acknowledgements. Concrete construction and
one worker model govern; old keri-ts API/data compatibility is not required.
Historical implementation descriptions below are evidence, not active directions.

## Purpose

Archived comparison of `keri-ts` against other CESR/parser implementations. The
main value now is the conclusion, not the full comparator catalog.

## Evidence Inputs

Compared `keri-ts` primarily against KERIpy, with advisory reference points from
other implementations where they helped identify shape differences or design
tradeoffs.

## Gate Model

1. KERIpy parity was the blocking gate.
2. Other implementations were advisory only.
3. Differences were important when they revealed missing behavior, unclear
   parser contracts, or alternate design seams worth studying.

## High-Level Outcome

1. `keri-ts` was judged complete enough against the current KERIpy parser
   baseline to move out of "missing core parser capability" mode.
2. The remaining meaningful work was readability, hardening, and explicit
   contract documentation rather than wholesale feature breadth.
3. Cross-implementation differences outside KERIpy were useful for perspective
   but were not release-blocking on their own.

## Durable Comparison Notes

1. KERIpy remained the behavioral authority for parser parity.
2. `keri-ts` deliberately chose explicit contracts, typed payloads, and
   bounded-substream architecture rather than copying every implementation style
   from other codebases.
3. Advisory implementations were most useful for identifying terminology,
   missing vectors, or alternative decomposition ideas, not for redefining the
   parity target.

## Remaining Rule

Use this archived note only as historical context. For active parser decisions,
prefer:

1. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md`
2. `docs/archived-plan-docs/cesr/cesr-parser/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. `.agents/learnings/PROJECT_LEARNINGS_CESR.md`
