# CESR Parser Phase 0 Behavior-Lock and KERIpy Parity Matrix

## Status

- Created: 2026-02-27
- Archived as historical reference: 2026-04-09
- Outcome: phase goal achieved; the parser now has a locked baseline and this
  doc remains only as a compact record of what Phase 0 was for

## Goal

Define the baseline vectors and edge cases needed before readability and
hardening work could safely proceed.

## What Phase 0 Established

1. Parser behavior needed explicit lock tests before structural cleanup.
2. The initial parity floor had to include chunk boundaries, mixed-version
   fallback, wrapper recovery, and nested group behavior.
3. KERIpy was the parity authority for those vectors.
4. P0/P1 vectors captured immediate must-have and next-up coverage, while P2
   was explicitly separated as later hardening work.

## Durable Outcomes

1. A behavior-lock test matrix existed before later parser refactors landed.
2. The P2 hardening backlog was split into its own plan instead of bloating the
   baseline phase.
3. Future parser work inherited the rule that readability refactors require
   parity evidence first.

## Active Authority

For current parser behavior, prefer the parser contract, current tests, and the
CESR learnings doc over this archived matrix.
