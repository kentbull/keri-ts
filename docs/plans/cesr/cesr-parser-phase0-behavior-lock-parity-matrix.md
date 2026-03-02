# CESR Parser Phase 0 Behavior-Lock and KERIpy Parity Matrix

## Status

- Created: 2026-02-27
- Phase: 0 (Baseline and Evidence Capture)
- Depends on:
  - `docs/plans/cesr/cesr-parser-readability-improvement-plan.md`
  - `docs/plans/cesr/cesr-parser-readability-phased-roadmap.md`
- Source of truth target: `keripy` main (`keripy/src/keri/core/parsing.py` and
  `keripy/tests/core/test_parsing.py`)

## Goal

Lock parser behavior before readability refactors and explicitly track parity
with KERIpy semantics that matter for CESR interoperability.

This document is the Phase 0 working matrix:

- what is already covered
- what is partially covered
- what is missing and must be added as test vectors

## Baseline Snapshot (2026-02-27)

Executed in `packages/cesr`:

```sh
deno test test/unit/parser.test.ts test/unit/parity.test.ts test/unit/chunk-fuzz.test.ts test/unit/external-fixtures.test.ts test/unit/parity-generic-group.test.ts test/unit/annotate.test.ts test/unit/parser-version-context.test.ts test/unit/parser-framed-mode.test.ts test/unit/parser-flush.test.ts test/unit/parser-pending-frame.test.ts test/unit/parser-wrapper-map-errors.test.ts test/unit/parser-mixed-stream.test.ts test/unit/parser-wrapper-big-count-parity.test.ts test/unit/parser-wrapper-version-context.test.ts test/unit/parser-boundary-shortage.test.ts test/unit/parser-legacy-v1-implicit-version.test.ts
```

Result:

- 60 passed
- 0 failed

## Parity Scope

In scope for parity lock:

- stream parsing boundaries and chunk continuation
- version-counter semantics and version context propagation
- body-group parsing behavior (message, non-native, fix, map, wrapped
  body+attachments)
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

| Area                                              | KERIpy Reference                                                                              | keri-ts Coverage                                                                                                    | Status  | Notes                                                                                                                                     |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Basic parse of message + attachment counters      | `test_parser_v1_basic` (`keripy/tests/core/test_parsing.py:31`)                               | `parser.test.ts`, `parity.test.ts`, `external-fixtures.test.ts`                                                     | LOCKED  | Core happy-path exists.                                                                                                                   |
| Strict vs compat major-version fallback           | KERIpy versioned counter behavior in v1/v2 tests                                              | `parser.test.ts`, `parity.test.ts`                                                                                  | LOCKED  | Callback path covered.                                                                                                                    |
| Chunk split determinism                           | KERIpy generator/yield behavior across shortages                                              | `chunk-fuzz.test.ts`                                                                                                | LOCKED  | Single and two-split fuzz on key streams.                                                                                                 |
| BodyWithAttachmentGroup parse (txt + qb2)         | `test_parser_v1_enclosed_message` (line ~938), `test_parser_v2_enclosed_message` (line ~3024) | `external-fixtures.test.ts`, `chunk-fuzz.test.ts`, `parser-wrapper-big-count-parity.test.ts`                        | PARTIAL | Core lock is complete for P0/P1; additional breadth is deferred to P2 hardening (`cesr-parser-p2-hardening-interop-plan.md`).             |
| NonNativeBodyGroup behavior                       | `test_parser_v1_non_native_message` (line ~1350), enclosed-message tests                      | `parser.test.ts`, `annotate.test.ts`                                                                                | LOCKED  | Both size-mismatch error and size-consistent opaque fallback behavior are now lock-tested.                                                |
| Native FixBody/MapBody parse                      | `test_parse_native_cesr_fixed_field` (line ~4399)                                             | `external-fixtures.test.ts`, `parser.test.ts`, `primitives-native.test.ts`, `parser-wrapper-map-errors.test.ts`     | PARTIAL | Core lock is complete for P0/P1; additional breadth is deferred to P2 hardening (`cesr-parser-p2-hardening-interop-plan.md`).             |
| Annotation-byte (`ano`) handling                  | KERIpy `sniff`/stream-state semantics                                                         | `parser.test.ts`                                                                                                    | LOCKED  | Inter-frame and leading/repeated `ano` handling are lock-tested, including chunked continuation.                                          |
| Attachment wrapper nested-group recovery          | KERIpy wrapper/enclosed attachment semantics                                                  | `parity.test.ts`, `annotate.test.ts`, `parser-wrapper-map-errors.test.ts`, `parser-wrapper-version-context.test.ts` | PARTIAL | Core lock is complete for P0/P1; additional breadth is deferred to P2 hardening (`cesr-parser-p2-hardening-interop-plan.md`).             |
| Top-level GenericGroup nesting and re-entry       | `test_parse_generic_group` (line ~3466), `test_group_parsator` (line ~3916)                   | `parity-generic-group.test.ts`                                                                                      | PARTIAL | Core lock is complete for P0/P1; additional breadth is deferred to P2 hardening (`cesr-parser-p2-hardening-interop-plan.md`).             |
| Version-stack behavior inside nested groups       | `test_parser_v1_version` (line ~404), enclosed/group tests with `KERIACDCGenusVersion`        | `parser-version-context.test.ts`                                                                                    | PARTIAL | Core lock is complete for P0/P1; additional breadth is deferred to P2 hardening (`cesr-parser-p2-hardening-interop-plan.md`).             |
| Framed-mode emission policy (`framed=true`)       | KERIpy framed parser mode used broadly                                                        | `parser-framed-mode.test.ts`                                                                                        | LOCKED  | V-P0-007 locks bounded one-frame-per-drain-cycle emission for multi-frame feeds.                                                          |
| Flush behavior on pending frame + shortage tail   | KERIpy parsator extraction/shortage conventions                                               | `parser-flush.test.ts`                                                                                              | LOCKED  | V-P0-008 and V-P0-009 lock flush frame emission and shortage ordering semantics; V-P1-014 locks pending+queued stream-order preservation. |
| Full-frame qb64/qb2 parity (same semantic result) | KERIpy txt/bny equivalence assumptions                                                        | `external-fixtures.test.ts`, `parser-mixed-stream.test.ts`, `parser-wrapper-big-count-parity.test.ts`               | PARTIAL | Core lock is complete for P0/P1; additional breadth is deferred to P2 hardening (`cesr-parser-p2-hardening-interop-plan.md`).             |
| Exact-cut shortage boundaries                     | KERIpy shortage/yield behavior at token boundaries                                            | `parser-boundary-shortage.test.ts`                                                                                  | LOCKED  | V-P1-009 locks deterministic behavior after-header, mid-payload, and just-before-complete cuts.                                           |
| Legacy implicit-v1 (no selector) compatibility    | Deployed v1 streams without `KERIACDCGenusVersion`                                            | `parser-legacy-v1-implicit-version.test.ts`                                                                         | LOCKED  | Legacy top-level v1 body/group streams are lock-tested without context/version selector counters.                                         |
| Multi-message mixed stream ordering               | KERIpy top-level counter/message boundary behavior                                            | `parser-mixed-stream.test.ts`                                                                                       | LOCKED  | V-P1-005 locks deterministic order for JSON + native + wrapped frame sequences.                                                           |

## Missing Test Vector Catalog

Priority legend:

- `P0`: must add before Phase 1 refactors
- `P1`: should add in Phase 0 if feasible, else Phase 1 gate

### P0 Vectors (Must Add)

- None remaining. `V-P0-001` through `V-P0-010` are implemented and passing.

## P0 Codex Visual Map (KERIpy Entry Mapping)

Use this section as a quick decode key when reading P0 vectors and mapping each
to KERIpy codex entries.

Primary KERIpy codex references:

- `keripy/src/keri/core/counting.py` `CounterCodex_2_0` entries around lines
  193-251.
- `keripy/src/keri/core/counting.py` `CounterCodex_1_0` entries around lines
  58-79.
- `keripy/src/keri/core/counting.py` universal subsets `UniDex_*`/`SUDex_*`
  around lines 125-157 and 267-310.

### Counter and Count Legend

| Token shape | Meaning                                                      | Example                 |
| ----------- | ------------------------------------------------------------ | ----------------------- |
| `-Xcc`      | short counter: hard code `-X` + 2-char soft count            | `-AAB` (`AB` = count 1) |
| `--Xccccc`  | big counter: hard code `--X` + 5-char soft count             | `--AAAAAAB`             |
| `-_AAAvvv`  | genus-version counter: hard `-_AAA` + 3-char version payload | `-_AAAAAB`              |
| `cc` values | CESR b64 integers (`AA=0`, `AB=1`, `AC=2`, `AQ=16`)          | `AB`                    |

### Wrapper/Attachment Family Cheat Sheet

| Logical code name         | V2 (keri-ts `CtrDexV2`) | V1 (keri-ts `CtrDexV1`) | KERIpy codex entry                                                         |
| ------------------------- | ----------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `GenericGroup`            | `-A`                    | `-T`                    | `CtrDex_2_0.GenericGroup`, `CtrDex_1_0.GenericGroup`                       |
| `BodyWithAttachmentGroup` | `-B`                    | `-U`                    | `CtrDex_2_0.BodyWithAttachmentGroup`, `CtrDex_1_0.BodyWithAttachmentGroup` |
| `AttachmentGroup`         | `-C`                    | `-V`                    | `CtrDex_2_0.AttachmentGroup`, `CtrDex_1_0.AttachmentGroup`                 |
| `NonNativeBodyGroup`      | `-H`                    | `-W`                    | `CtrDex_2_0.NonNativeBodyGroup`, `CtrDex_1_0.NonNativeBodyGroup`           |
| `KERIACDCGenusVersion`    | `-_AAA`                 | `-_AAA`                 | `CtrDex_2_0.KERIACDCGenusVersion`, `CtrDex_1_0.KERIACDCGenusVersion`       |
| `ControllerIdxSigs`       | `-K`                    | `-A`                    | `CtrDex_2_0.ControllerIdxSigs`, `CtrDex_1_0.ControllerIdxSigs`             |

### P0 Vector Visual Examples

Notation:

- `<q2>`: 2-char quadlet count.
- `<q5>`: 5-char quadlet count (big counters).
- `<n2>`: 2-char item count.
- `<vers3>`: 3-char genus-version payload.
- `<body>`: CESR message body bytes.
- `<sig>`: one controller signature token.
- `<ano>`: annotation/separator byte where `sniff(...) == "ano"` (for example
  newline `0x0A`).

| Vector     | Visual stream sketch (qb64-style)                                | Key codex entries to map                                                                  |
| ---------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `V-P0-001` | `-A<q2_outer>-B<q2_inner><body>-K<n2><sig>`                      | `GenericGroup`, `BodyWithAttachmentGroup`, `ControllerIdxSigs`                            |
| `V-P0-002` | `-A<q2_outer>(-A<q2_inner>-B<q2_inner2><body>-K<n2><sig>)<body>` | `GenericGroup` (nested), `BodyWithAttachmentGroup`, `ControllerIdxSigs`                   |
| `V-P0-003` | `-_AAA<vers3><body>...`                                          | `KERIACDCGenusVersion`                                                                    |
| `V-P0-004` | `-B<q2>-_AAA<vers3><body>-K<n2><sig>`                            | `BodyWithAttachmentGroup`, `KERIACDCGenusVersion`, `ControllerIdxSigs`                    |
| `V-P0-005` | `-B<q2><body>-C<q2>-_AAA<vers3>-K<n2><sig>`                      | `BodyWithAttachmentGroup`, `AttachmentGroup`, `KERIACDCGenusVersion`, `ControllerIdxSigs` |
| `V-P0-006` | `-H<q2><opaque-non-serder-payload>`                              | `NonNativeBodyGroup`                                                                      |
| `V-P0-007` | `-B<q2><body1>-K<n2><sig1>-B<q2><body2>-K<n2><sig2>`             | `BodyWithAttachmentGroup`, `ControllerIdxSigs`                                            |
| `V-P0-008` | `-B<q2><body>-K<n2><sig>` then `flush()`                         | `BodyWithAttachmentGroup`, `ControllerIdxSigs`                                            |
| `V-P0-009` | `<complete-frame><truncated-next-token...>` then `flush()`       | previous frame codex + shortage path on partial next code                                 |
| `V-P0-010` | `<ano><ano><ano><frame>`                                         | `ano` handling + whatever frame codex starts first real frame                             |

### GenericGroup Type Reminder

| Generic wrapper type | V2 code | V1 code | Count width      |
| -------------------- | ------- | ------- | ---------------- |
| short                | `-A`    | `-T`    | 2 chars (`<q2>`) |
| big                  | `--A`   | `--T`   | 5 chars (`<q5>`) |

### Completed P0 Vectors

1. `V-P0-001` Top-level `GenericGroup` with one enclosed
   `BodyWithAttachmentGroup`.

- Implemented in: `packages/cesr/test/unit/parity-generic-group.test.ts`.
- Status: passing.

2. `V-P0-002` Nested `GenericGroup` two levels deep with mixed enclosed content.

- Implemented in: `packages/cesr/test/unit/parity-generic-group.test.ts`.
- Status: passing with split-determinism assertions.

3. `V-P0-003` Top-level genus-version counter before message body.

- Implemented in: `packages/cesr/test/unit/parser-version-context.test.ts`.
- Status: passing.

4. `V-P0-004` Genus-version counter at start of `BodyWithAttachmentGroup`
   payload.

- Implemented in: `packages/cesr/test/unit/parser-version-context.test.ts`.
- Status: passing.

5. `V-P0-005` Genus-version counter at start of enclosed `AttachmentGroup`.

- Implemented in: `packages/cesr/test/unit/parser-version-context.test.ts`.
- Status: passing.

6. `V-P0-006` `NonNativeBodyGroup` with size-consistent but non-serder payload.

- Implemented in: `packages/cesr/test/unit/parser.test.ts`.
- Status: passing.

7. `V-P0-007` `framed=true` with two complete frames in one `feed`.

- Implemented in: `packages/cesr/test/unit/parser-framed-mode.test.ts`.
- Status: passing.

8. `V-P0-008` EOS flush when `pendingFrame` exists and no remainder.

- Implemented in: `packages/cesr/test/unit/parser-flush.test.ts`.
- Status: passing.

9. `V-P0-009` EOS flush when `pendingFrame` exists and truncated tail bytes
   remain.

- Implemented in: `packages/cesr/test/unit/parser-flush.test.ts`.
- Status: passing.

10. `V-P0-010` Leading and repeated annotation bytes before first frame.

- Implemented in: `packages/cesr/test/unit/parser.test.ts`.
- Status: passing.

### P1 Vectors (Next Up)

None currently.

### Completed P1 Vectors

1. `V-P1-001` Pending-frame continuation where next token is body-group counter
   (new frame boundary).

- Implemented in: `packages/cesr/test/unit/parser-pending-frame.test.ts`.
- Status: passing.

2. `V-P1-002` Strict/parity mode rejects opaque-tail remainder in
   `AttachmentGroup` wrapper payload.

- Implemented in: `packages/cesr/test/unit/parser-wrapper-map-errors.test.ts`.
- Status: passing.

3. `V-P1-003` Map-body dangling label and boundary mismatch errors.

- Implemented in: `packages/cesr/test/unit/parser-wrapper-map-errors.test.ts`.
- Status: passing.

4. `V-P1-004` Mixed qb64/qb2 parity for JSON+attachments stream (not only native
   fixtures).

- Implemented in: `packages/cesr/test/unit/parser-mixed-stream.test.ts`.
- Status: passing.

5. `V-P1-005` Multi-message mixed stream (JSON frame + native frame + wrapped
   frame) deterministic ordering.

- Implemented in: `packages/cesr/test/unit/parser-mixed-stream.test.ts`.
- Status: passing.

6. `V-P1-006` Big-counter parity for wrapper groups (`--A`/`--B`/`--C`) in both
   `txt` and `bny` domains.

- Implemented in:
  `packages/cesr/test/unit/parser-wrapper-big-count-parity.test.ts`.
- Status: passing.

7. `V-P1-007` `GenericGroup` payload with enclosed genus-version override and
   multiple enclosed frames.

- Implemented in:
  `packages/cesr/test/unit/parser-wrapper-version-context.test.ts`.
- Status: passing.

8. `V-P1-008` Strict-mode nested mixed-version wrapper behavior (no fallback
   allowed).

- Implemented in:
  `packages/cesr/test/unit/parser-wrapper-version-context.test.ts`.
- Status: passing.

9. `V-P1-009` Boundary-shortage matrix at exact cut points (after header,
   mid-payload, just-before-complete).

- Implemented in: `packages/cesr/test/unit/parser-boundary-shortage.test.ts`.
- Status: passing.

10. `V-P1-010` Multiple genus-version counters inside one wrapper payload
    (latest override applies to subsequent nested groups).

- Implemented in:
  `packages/cesr/test/unit/parser-wrapper-version-context.test.ts`.
- Status: passing.

11. `V-P1-011` Recovery contract after parser error (`reset` and subsequent
    clean feed).

- Implemented in: `packages/cesr/test/unit/parser-recovery.test.ts`.
- Status: passing.

12. `V-P1-012` Flush idempotency (`flush()` called repeatedly does not duplicate
    emissions).

- Implemented in: `packages/cesr/test/unit/parser-flush.test.ts`.
- Status: passing.

13. `V-P1-013` Cold-start MGPK/CBOR Serder body-deserialization parity
    (`ked`/`ilk`/`said` extraction parity with KERIpy behavior).

- Implemented in: `packages/cesr/test/unit/parser-binary-serder.test.ts`.
- Status: passing.

14. `V-P1-014` `pendingFrame` + `queuedFrames` coexistence preserves stream
    order at flush (pending first, then queued).

- Implemented in: `packages/cesr/test/unit/parser-flush.test.ts`.
- Status: passing.

### P2 Hardening

Breadth/scale/parity-hardening coverage is tracked in:

- `docs/plans/cesr/cesr-parser-p2-hardening-interop-plan.md`

## Proposed Parity Test File Additions

- `packages/cesr/test/unit/parity-generic-group.test.ts` (completed)
- `packages/cesr/test/unit/parser-version-context.test.ts` (completed)
- `packages/cesr/test/unit/parser-framed-mode.test.ts` (completed)
- `packages/cesr/test/unit/parser-flush.test.ts` (completed)
- `packages/cesr/test/unit/parser-pending-frame.test.ts` (completed, P1)
- `packages/cesr/test/unit/parser-wrapper-map-errors.test.ts` (completed, P1)
- `packages/cesr/test/unit/parser-mixed-stream.test.ts` (completed, P1)
- `packages/cesr/test/unit/parser-wrapper-big-count-parity.test.ts` (completed,
  P1)
- `packages/cesr/test/unit/parser-wrapper-version-context.test.ts` (completed,
  P1)
- `packages/cesr/test/unit/parser-boundary-shortage.test.ts` (completed, P1)
- `packages/cesr/test/unit/parser-recovery.test.ts` (completed, P1)
- `packages/cesr/test/unit/parser-binary-serder.test.ts` (completed, P1)
- `packages/cesr/test/unit/parser-legacy-v1-implicit-version.test.ts`
  (completed, compatibility lock)

If preferred, vectors may be added into existing files, but separate files
improve review clarity for parity-only additions.

## Phase 0 Exit Criteria (Parity Gate)

1. All `P0` vectors implemented and passing.
2. Existing parser/parity/chunk-fuzz/external fixture tests continue passing.
3. Each new test case maps to a matrix vector ID in comments or test names.
4. Any intentional behavior divergence from KERIpy is documented explicitly in
   this matrix with rationale and approval note.

## Maintainer Review Notes

- KERIpy parity here means parser extraction semantics and stream
  interpretation, not side-effect dispatch architecture.
- For any behavior where `keri-ts` intentionally diverges (for cleaner
  parse-only model), parity decision must still be explicit, tested, and
  justified.
