# CESR Parser State Machine Contract

## Status

- Created: 2026-02-28
- Scope:
  - `packages/cesr/src/core/parser-engine.ts`
- Architecture:
  - Atomic bounded substream parser (`docs/adr/adr-0001-parser-atomic-bounded-first.md`)
- Contract strictness:
  - Normative and test-mapped. Behavior changes require updates to this document and mapped tests.

## Purpose

Define the normative parser state machine for `CesrParser` so maintainers can
reason about lifecycle behavior without re-deriving rules from control flow.

## Terminology (Normative)

- Frame:
  one parser emission unit (`CesrFrame` event with `type: "frame"`).
- `CesrMessage`:
  historical public payload type name for that frame unit (`body` +
  `attachments`), retained for API compatibility.
- Message-domain frame:
  frame whose body starts with cold-start code `msg` and is parsed through
  Serder reaping.
- Body group:
  counter-declared frame-start payload form that defines or encloses frame body
  bytes (`GenericGroup`, `BodyWithAttachmentGroup`, native fixed/map groups).
- Attachment group:
  post-body trailing group parsed by attachment dispatch.
- Annotation separator byte (`ano`):
  delimiter byte consumed between parse units, not itself a frame payload unit.
- Deferred frame lifecycle:
  `pendingFrame` is the oldest incomplete top-level frame continuation;
  `queuedFrames` are additional already-complete enclosed frames emitted after
  `pendingFrame` to preserve stream order.

## State Variables

- `state.buffer`:
  unconsumed stream bytes.
- `state.offset`:
  absolute consumed-byte position. Must be monotonic.
- `streamVersion`:
  active top-level version context.
- `pendingFrame`:
  older top-level frame waiting for continuation bytes or terminal flush.
- `queuedFrames`:
  additional complete enclosed frames parsed from one `GenericGroup` payload.
- `framed`:
  emission policy mode (`true` bounded, `false` greedy/unframed).

## Derived Parser States

- `Idle`:
  `buffer` empty, `pendingFrame` null, `queuedFrames` empty.
- `Buffered`:
  `buffer` non-empty with no deferred frame state.
- `PendingOnly`:
  `pendingFrame` set, `queuedFrames` empty.
- `QueuedOnly`:
  `pendingFrame` null, `queuedFrames` non-empty.
- `PendingAndQueued`:
  both `pendingFrame` and `queuedFrames` set.
- `ErroredAndReset`:
  non-shortage error emitted; parser state reset to defaults.
- `Flushed`:
  after `flush()` returns, terminal remainder is consumed; repeated flush is idempotent.

## Transition Table

| Trigger                            | Precondition                                  | Action                                                                                                       | Postcondition                              | Emits                         |
|------------------------------------|-----------------------------------------------|--------------------------------------------------------------------------------------------------------------|--------------------------------------------|-------------------------------|
| `feed(chunk)`                      | any                                           | append to `buffer`, call `drain()`                                                                           | depends on `drain()` loop                  | zero or more `frame`/`error`  |
| `drain()` start                    | `buffer` has leading `ano`                    | consume separators                                                                                           | stays in current deferred state            | none                          |
| `drain()` pending branch           | `pendingFrame` exists                         | call `resumePendingFrame()`                                                                                  | pending resolved, extended, or paused      | maybe one `frame`             |
| `drain()` queued branch            | no pending, `queuedFrames` exists             | shift one queued frame                                                                                       | queued length decreases                    | one `frame`                   |
| `drain()` base parse               | no pending/queued, bytes available            | call `parseFrame()`                                                                                          | base body consumed; stream context updated | none yet                      |
| `drain()` attachment collect       | base parsed                                   | greedily parse trailing attachments (policy-aware)                                                           | complete frame or deferred pending         | zero or one `frame`           |
| `drain()` shortage in collect      | attachment parse shortage                     | set `pendingFrame` with accumulated frame                                                                    | enters `PendingOnly` or `PendingAndQueued` | none                          |
| `drain()` non-shortage parse error | parse failure not `ShortageError`             | emit normalized error, `reset()`                                                                             | `ErroredAndReset`                          | one `error`                   |
| `resumePendingFrame()` boundary    | next token is `msg` or frame-boundary counter | emit pending frame, clear pending                                                                            | pending removed                            | one `frame`                   |
| `resumePendingFrame()` attachment  | next token is attachment material             | append attachment group to pending frame                                                                     | pending retained or emitted (framed mode)  | maybe one `frame`             |
| `resumePendingFrame()` pause       | insufficient bytes / continuation unresolved  | return pause                                                                                                 | pending kept                               | none                          |
| `parseGenericGroup()`              | counted payload complete                      | parse bounded payload via `parseFrameSequence()`                                                             | return first frame, queue rest             | none directly                 |
| `parseFrameSequence()`             | bounded payload                               | parse enclosed frames in order                                                                               | returns ordered frame list                 | none directly                 |
| `parseCompleteFrame()`             | bounded substream                             | parse one complete enclosed frame                                                                            | returns frame + consumed bytes             | none directly                 |
| `flush()`                          | any deferred state                            | emit deferred frames in contract order; emit terminal shortage if buffer remainder exists; consume remainder | `Flushed`                                  | `frame` and maybe one `error` |
| `reset()`                          | any                                           | clear `buffer`, `pendingFrame`, `queuedFrames`, reset version                                                | `Idle`                                     | none                          |

## Emission Rules (Normative)

1. During `drain()`, `pendingFrame` always has higher priority than `queuedFrames`.
2. During `drain()`, `queuedFrames` emit before starting a new parse from `buffer`.
3. During `flush()`, deferred frame order preserves stream order:
   - emit `pendingFrame` first,
   - then emit `queuedFrames`.
4. `flush()` emits at most one terminal `ShortageError`, only when remainder bytes still exist.
5. Repeated `flush()` calls after terminal emission are idempotent (no duplicate frame/error emission).

## Invariants

- `state.offset` is monotonic and increases only through `consume(...)`.
- No silent byte loss: bytes are either consumed into parsed artifacts or retained for later continuation/terminal shortage.
- Counted group parse is bounded and atomic for nested payloads (`GenericGroup`, wrapper groups, body+attachment groups).
- Enclosed frame order is preserved (`parseFrameSequence()` and queued emission ordering).
- Stream order is preserved when both `pendingFrame` and `queuedFrames` exist.

## Error Semantics

- `ShortageError` in `feed` path is non-terminal:
  parser pauses and waits for more bytes.
- `ShortageError` in `flush` path is terminal for buffered remainder:
  error emitted once, remainder consumed.
- Non-shortage parser errors emit one `error` event and trigger `reset()`.

## Version Context Semantics

- Top-level stream scope:
  `streamVersion`, affected by leading `KERIACDCGenusVersion` at frame start.
- Current frame scope:
  `version` used for that frame's attachment parse.
- Nested wrapper scope:
  wrapper-local nested version context in dispatch parsing.

These scopes are function-bounded and avoid a global mutable nested version stack.

Legacy note:

- Deployed v1 streams may omit `KERIACDCGenusVersion` selectors at stream start.
- In those cases, version context is inferred from the first parsed message/body semantics.

## Framed vs Unframed

- `framed=false`:
  greedy lookahead and attachment collection; may defer body-only end-of-buffer frame until more bytes or `flush()`.
- `framed=true`:
  bounded emission per drain cycle; may emit earlier and stop after first frame/attachment boundary work unit.

## Contract-to-Test Matrix

| Contract Item                                                               | Test Coverage                                                                                         |
|-----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------|
| Pending continuation treats body-group counter as new frame boundary        | `packages/cesr/test/unit/parser-pending-frame.test.ts` (`V-P1-001`)                                   |
| Flush emits pending frame without remainder error                           | `packages/cesr/test/unit/parser-flush.test.ts` (`V-P0-008`)                                           |
| Flush emits pending frame then terminal shortage when tail remains          | `packages/cesr/test/unit/parser-flush.test.ts` (`V-P0-009`)                                           |
| Flush idempotency (frame/error not duplicated)                              | `packages/cesr/test/unit/parser-flush.test.ts` (`V-P1-012`)                                           |
| Framed-mode bounded one-frame drain behavior                                | `packages/cesr/test/unit/parser-framed-mode.test.ts` (`V-P0-007`)                                     |
| GenericGroup parsing and split determinism                                  | `packages/cesr/test/unit/parity-generic-group.test.ts` (`V-P0-001`, `V-P0-002`)                       |
| Version selector at top-level and enclosed scopes                           | `packages/cesr/test/unit/parser-version-context.test.ts` (`V-P0-003`..`V-P0-005`)                     |
| Nested wrapper version-context behavior                                     | `packages/cesr/test/unit/parser-wrapper-version-context.test.ts` (`V-P1-007`, `V-P1-008`, `V-P1-010`) |
| Legacy implicit-v1 behavior without selectors                               | `packages/cesr/test/unit/parser-legacy-v1-implicit-version.test.ts`                                   |
| Mixed multi-frame order determinism across splits                           | `packages/cesr/test/unit/parser-mixed-stream.test.ts` (`V-P1-005`)                                    |
| Non-shortage error recovery via reset                                       | `packages/cesr/test/unit/parser-recovery.test.ts` (`V-P1-011`)                                        |
| Leading/repeated `ano` separator handling                                   | `packages/cesr/test/unit/parser.test.ts` (`V-P0-010`)                                                 |
| `pendingFrame` + `queuedFrames` coexistence preserves stream order at flush | `packages/cesr/test/unit/parser-flush.test.ts` (`V-P1-014`)                                           |

## Change Control

Any parser lifecycle change that affects:

- deferred emission ordering,
- shortage behavior,
- version-scope transitions,
- framed/unframed branch behavior,

must update this contract and the mapped tests in the matrix.
