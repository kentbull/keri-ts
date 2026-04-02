# ADR-0005: Typed KEL Decision Control Flow

## Status

Accepted

## Context

KERIpy uses exceptions such as `OutOfOrderError`, `MissingSignatureError`,
`MissingWitnessSignatureError`, `MissingDelegationError`,
`LikelyDuplicitousError`, and `MissingDelegableApprovalError` as part of normal
event-processing control flow inside `Kever.__init__`, `Kever.update()`, and
`Kevery.processEvent()`.

That Python style works because the KERIpy runtime is already organized around
exception-driven doer loops. In `keri-ts`, the same approach makes the normal
branch surface harder to reason about because it hides expected outcomes behind
throws:

- accept
- duplicate
- escrow
- reject

Those are ordinary event-processing results, not exceptional runtime failures.

## Decision

`keri-ts` models normal KEL-processing outcomes as typed discriminated unions:

- `KeverDecision`
- `AttachmentDecision`

`Kever` remains the accepted-state machine, but it now evaluates events through
decision-returning helpers such as:

- `Kever.evaluateInception(...)`
- `kever.evaluateUpdate(...)`
- `Kever.validateAttachments(...)`

`Kevery` owns orchestration:

- `Kevery.decideEvent(...)`
- `Kevery.applyDecision(...)`
- `Kevery.processEvent(...)`

`Kevery.processEvent(...)` now returns a `KeverDecision` instead of `void`.

## Ownership Split

`Kever` owns:

- state-machine validation rules
- provisional next-state construction
- attachment validation
- accepted-state serialization
- accepted-event log application through `logEvent(...)`

`Kevery` owns:

- first-seen versus existing-prefix routing
- duplicate versus likely-duplicitous routing
- escrow persistence
- duplicate late-attachment logging
- post-acceptance cue emission

This keeps the KERIpy mental model while making the control surface explicit in
TypeScript.

## Decision Taxonomy

### `KeverDecision`

- `accept`
  - carries a `KeverTransitionPlan`
  - means the event is fully validated and may be applied to state
- `duplicate`
  - means the event is already accepted
  - may still carry a late-attachment log plan
- `escrow`
  - means the event is not yet fully decidable but should remain durable for
    later reprocessing
- `reject`
  - means the event is invalid or stale and should not be retried as an escrow

### `AttachmentDecision`

- `verified`
  - controller signatures, witness receipts, and delegation material are
    sufficient for the current validation path
- `escrow`
  - attachment-related verification is incomplete but potentially repairable
- `reject`
  - attachment-related material is invalid, not merely incomplete

## KERIpy Branch Mapping

| KERIpy branch                                          | `keri-ts` result                                                    |
|--------------------------------------------------------|---------------------------------------------------------------------|
| `OutOfOrderError` after `escrowOOEvent()`              | `KeverDecision { kind: "escrow", reason: "ooo" }`                   |
| `LikelyDuplicitousError` after `escrowLDEvent()`       | `KeverDecision { kind: "escrow", reason: "duplicitous" }`           |
| `MissingSignatureError` after `escrowPSEvent()`        | `AttachmentDecision { kind: "escrow", reason: "partialSigs" }`      |
| `MissingWitnessSignatureError` after `escrowPWEvent()` | `AttachmentDecision { kind: "escrow", reason: "partialWigs" }`      |
| `MissingDelegationError` after `escrowPDEvent()`       | `AttachmentDecision { kind: "escrow", reason: "partialDels" }`      |
| `MissingDelegableApprovalError` after delegable escrow | `AttachmentDecision { kind: "escrow", reason: "delegables" }`       |
| `MisfitEventSourceError` after misfit escrow           | `AttachmentDecision { kind: "escrow", reason: "misfit" }`           |
| duplicate event with same SAID                         | `KeverDecision { kind: "duplicate", duplicate: "sameSaid" }`        |
| duplicate event with new verified attachments          | `KeverDecision { kind: "duplicate", duplicate: "lateAttachments" }` |
| stale / invalid / policy-violating event               | `KeverDecision { kind: "reject", ... }`                             |
| fully verified event                                   | `KeverDecision { kind: "accept", ... }`                             |

## What Still Throws

Exceptions remain for cases that are truly exceptional in `keri-ts`:

- corrupt durable state during `Kever.reload()`
- impossible accepted-state application paths
- programming misuse of accepted-state-only helpers
- lower-level DB/path/infrastructure failures

Exceptions are no longer the intended mechanism for normal remote KEL branch
outcomes.

## Consequences

### Benefits

- normal branch outcomes are visible in the type system
- escrow reprocessing can reuse `decideEvent()` instead of catch-and-re-escrow
  loops
- local callers such as `Hab.acceptLocally()` can explicitly convert non-accept
  decisions into `ValidationError` without forcing remote processing into the
  same model

### Costs

- more plumbing types and plan objects
- some KERIpy helper logic must be split into evaluation and application layers
- partial parity helpers may remain structurally present before every escrow
  family reaches full behavioral depth

## Notes

This ADR preserves KERIpy’s behavioral contract, not Python’s exception style.
The goal is a TypeScript-native port that keeps the same branch semantics while
making them easier to inspect, test, and maintain.

This decision is also intended as the default control-flow rule for future
state-machine ports with the same shape, including `Tever`/`Tevery`,
escrow-heavy verifier/orchestrator pairs, and similar processor families. New
ports should start from explicit decision taxonomies and only fall back to
exception-driven branching when the branch is truly exceptional in `keri-ts`
rather than merely expected in KERIpy.
