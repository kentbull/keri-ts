# CESR Parser Phase 0 Behavior-Lock and KERIpy Parity Matrix

## Status

- Created: 2026-02-27
- Phase: 0 (Baseline and Evidence Capture)
- Depends on:
  - `docs/plans/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr-parser-readability-phased-roadmap.md`
- Source of truth target: `keripy` main (`keripy/src/keri/core/parsing.py` and `keripy/tests/core/test_parsing.py`)

## Goal

Lock parser behavior before readability refactors and explicitly track parity with KERIpy semantics that matter for CESR interoperability.

This document is the Phase 0 working matrix:

- what is already covered
- what is partially covered
- what is missing and must be added as test vectors

## Baseline Snapshot (2026-02-27)

Executed in `packages/cesr`:

```sh
deno test test/unit/parser.test.ts test/unit/parity.test.ts test/unit/chunk-fuzz.test.ts test/unit/external-fixtures.test.ts test/unit/parity-generic-group.test.ts
```

Result:

- 30 passed
- 0 failed

## Parity Scope

In scope for parity lock:

- stream parsing boundaries and chunk continuation
- version-counter semantics and version context propagation
- body-group parsing behavior (message, non-native, fix, map, wrapped body+attachments)
- attachment dispatch behavior (strict/compat, wrapper recovery, qb64/qb2)
- nested group handling where KERIpy defines behavior

Out of scope for this matrix:

- KERIpy side-effect dispatch to `kvy/tvy/exc/rvy/vry`
- application-level event validation behavior

## Behavior Matrix

Status legend:

- `LOCKED`: behavior has direct tests and should be preserved
- `PARTIAL`: some coverage exists, but key branches/variants remain untested
- `MISSING`: no direct lock test yet

| Area                                              | KERIpy Reference                                                                              | keri-ts Coverage                                                           | Status  | Notes                                                                                           |
|---------------------------------------------------|-----------------------------------------------------------------------------------------------|----------------------------------------------------------------------------|---------|-------------------------------------------------------------------------------------------------|
| Basic parse of message + attachment counters      | `test_parser_v1_basic` (`keripy/tests/core/test_parsing.py:31`)                               | `parser.test.ts`, `parity.test.ts`, `external-fixtures.test.ts`            | LOCKED  | Core happy-path exists.                                                                         |
| Strict vs compat major-version fallback           | KERIpy versioned counter behavior in v1/v2 tests                                              | `parser.test.ts`, `parity.test.ts`                                         | LOCKED  | Callback path covered.                                                                          |
| Chunk split determinism                           | KERIpy generator/yield behavior across shortages                                              | `chunk-fuzz.test.ts`                                                       | LOCKED  | Single and two-split fuzz on key streams.                                                       |
| BodyWithAttachmentGroup parse (txt + qb2)         | `test_parser_v1_enclosed_message` (line ~938), `test_parser_v2_enclosed_message` (line ~3024) | `external-fixtures.test.ts`, `chunk-fuzz.test.ts`                          | PARTIAL | Core wrapped-body parse covered; version-stack variants missing.                                |
| NonNativeBodyGroup behavior                       | `test_parser_v1_non_native_message` (line ~1350), enclosed-message tests                      | `parser.test.ts`                                                           | PARTIAL | Payload mismatch error covered; opaque fallback success path not covered.                       |
| Native FixBody/MapBody parse                      | `test_parse_native_cesr_fixed_field` (line ~4399)                                             | `external-fixtures.test.ts`, `parser.test.ts`, `primitives-native.test.ts` | PARTIAL | Positive paths covered; negative map-boundary cases missing.                                    |
| Annotation-byte (`ano`) handling                  | KERIpy `sniff`/stream-state semantics                                                         | `parser.test.ts`                                                           | PARTIAL | Inter-frame newline covered; leading/multiple `ano` and continuation cases missing.             |
| Attachment wrapper nested-group recovery          | KERIpy wrapper/enclosed attachment semantics                                                  | `parity.test.ts`, `annotate.test.ts`                                       | PARTIAL | Some nested and opaque cases covered in annotator path; parser-engine lock coverage incomplete. |
| Top-level GenericGroup nesting and re-entry       | `test_parse_generic_group` (line ~3466), `test_group_parsator` (line ~3916)                   | `parity-generic-group.test.ts`                                             | PARTIAL | V-P0-001 and V-P0-002 are locked; deeper re-entry/version-context variants still pending.      |
| Version-stack behavior inside nested groups       | `test_parser_v1_version` (line ~404), enclosed/group tests with `KERIACDCGenusVersion`        | none (explicit)                                                            | MISSING | Critical for mixed-stream correctness and explainability.                                       |
| Framed-mode emission policy (`framed=true`)       | KERIpy framed parser mode used broadly                                                        | none (explicit)                                                            | MISSING | Need deterministic bounded-emission locks.                                                      |
| Flush behavior on pending frame + shortage tail   | KERIpy parsator extraction/shortage conventions                                               | none (explicit)                                                            | MISSING | Must lock EOS behavior before refactors.                                                        |
| Full-frame qb64/qb2 parity (same semantic result) | KERIpy txt/bny equivalence assumptions                                                        | partial in fixtures                                                        | PARTIAL | Coverage exists for selected streams; broaden matrix.                                           |

## Missing Test Vector Catalog

Priority legend:

- `P0`: must add before Phase 1 refactors
- `P1`: should add in Phase 0 if feasible, else Phase 1 gate

### P0 Vectors (Must Add)

1. `V-P0-003` Top-level genus-version counter before message body.
- Why: locks `KERIACDCGenusVersion` activation semantics.
- Expected: version context shifts for following parse.
- Suggested file: `parser-version-context.test.ts`.

2. `V-P0-004` Genus-version counter at start of `BodyWithAttachmentGroup` payload.
- Why: explicitly covered in KERIpy enclosed-message tests.
- Expected: nested parse uses enclosed version and restores outer context after completion.
- Suggested file: `parser-version-context.test.ts`.

3. `V-P0-005` Genus-version counter at start of enclosed `AttachmentGroup`.
- Why: KERIpy supports version change in enclosed attachments.
- Expected: subsequent enclosed attachment groups parse under updated version context.
- Suggested file: `parser-version-context.test.ts`.

4. `V-P0-006` `NonNativeBodyGroup` with size-consistent but non-serder payload.
- Why: locks intended TS recovery behavior (opaque CESR body fallback).
- Expected: frame emitted with `kind: CESR`, `ked: null`, no hard error.
- Suggested file: `parser.test.ts`.

5. `V-P0-007` `framed=true` with two complete frames in one `feed`.
- Why: locks bounded emission policy behavior.
- Expected: first `feed` emits one frame; remaining frame emitted on subsequent drain/feed/flush.
- Suggested file: `parser-framed-mode.test.ts`.

6. `V-P0-008` EOS flush when `pendingFrame` exists and no remainder.
- Why: locks deferred emission semantics.
- Expected: `flush()` emits frame and no error.
- Suggested file: `parser-flush.test.ts`.

7. `V-P0-009` EOS flush when `pendingFrame` exists and truncated tail bytes remain.
- Why: locks frame+error emission ordering and shortage reporting.
- Expected: `flush()` emits frame then `ShortageError`.
- Suggested file: `parser-flush.test.ts`.

8. `V-P0-010` Leading and repeated annotation bytes before first frame.
- Why: ensures `ano` normalization parity at stream head.
- Expected: parser ignores leading `ano` and emits same frame result.
- Suggested file: `parser.test.ts`.

### Completed P0 Vectors

1. `V-P0-001` Top-level `GenericGroup` with one enclosed `BodyWithAttachmentGroup`.
- Implemented in: `packages/cesr/test/unit/parity-generic-group.test.ts`.
- Status: passing.

2. `V-P0-002` Nested `GenericGroup` two levels deep with mixed enclosed content.
- Implemented in: `packages/cesr/test/unit/parity-generic-group.test.ts`.
- Status: passing with split-determinism assertions.

### P1 Vectors (Next Up)

1. `V-P1-001` Pending-frame continuation where next token is body-group counter (new frame boundary).
- Why: locks subtle `resumePendingFrame` branch behavior.

2. `V-P1-002` Wrapper opaque-tail recovery in parser-engine path (not just annotate).
- Why: ensures fallback semantics are parser-locked.

3. `V-P1-003` Map-body dangling label and boundary mismatch errors.
- Why: locks strict mapper boundary rules.

4. `V-P1-004` Mixed qb64/qb2 parity for JSON+attachments stream (not only native fixtures).
- Why: broadens domain parity confidence.

5. `V-P1-005` Multi-message mixed stream (JSON frame + native frame + wrapped frame) deterministic ordering.
- Why: stream interoperability hardening.

## Proposed Phase 0 Test File Additions

- `packages/cesr/test/unit/parity-generic-group.test.ts` (completed)
- `packages/cesr/test/unit/parser-version-context.test.ts`
- `packages/cesr/test/unit/parser-framed-mode.test.ts`
- `packages/cesr/test/unit/parser-flush.test.ts`

If preferred, vectors may be added into existing files, but separate files improve review clarity for parity-only additions.

## Phase 0 Exit Criteria (Parity Gate)

1. All `P0` vectors implemented and passing.
2. Existing parser/parity/chunk-fuzz/external fixture tests continue passing.
3. Each new test case maps to a matrix vector ID in comments or test names.
4. Any intentional behavior divergence from KERIpy is documented explicitly in this matrix with rationale and approval note.

## Maintainer Review Notes

- KERIpy parity here means parser extraction semantics and stream interpretation, not side-effect dispatch architecture.
- For any behavior where `keri-ts` intentionally diverges (for cleaner parse-only model), parity decision must still be explicit, tested, and justified.
