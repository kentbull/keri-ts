# CESR Parser Buffer Performance Plan (Deferred)

## Status

- Created: 2026-02-27
- Priority: deferred until current feature work is completed
- Scope: `packages/cesr/src/core/parser-engine.ts`, `packages/cesr/src/core/bytes.ts`

## Context

Current parser streaming behavior appends and consumes by copying:

- append path: `feed()` calls `concatBytes(this.state.buffer, chunk)`
- consume path: `consume()` uses `this.state.buffer = this.state.buffer.slice(length)`

`concatBytes` itself is already reasonable for general `Uint8Array` concatenation:

- one pass to compute total length
- one pass to copy bytes into a single exact-size allocation

The bigger performance risk is repeated full-buffer copies across many small chunks.

## Decision

Do not optimize this now. Revisit only after the next feature batch is complete.

Reason:

- near-term priority is feature delivery and API/readability improvements
- parser buffer internals are easy to destabilize if changed without focused tests/benchmarks

## Proposed Optimization Direction (When Revisited)

Replace copy-on-append + copy-on-consume with cursor-based buffer reuse.

### Target state

- keep one backing `Uint8Array` plus two cursors: `start` (read), `end` (write)
- consume by moving `start` forward (no copy)
- parse from `subarray(start, end)` views (no copy)
- append into available tail capacity
- compact or grow only when capacity is insufficient

### Sketch

```ts
type ParserState = {
  buf: Uint8Array;
  start: number;
  end: number;
};
```

## Implementation Plan (Future)

1. Add focused benchmarks for parser feed/consume workloads:
   - many small chunks
   - mixed small/large chunks
   - realistic CESR message streams
2. Add behavior lock tests around incremental parsing and EOF/shortage handling.
3. Introduce cursor state internally with no public API changes.
4. Update `feed()`/`consume()` to stop allocating on every call.
5. Add compaction/growth policy and thresholds.
6. Compare benchmark and memory profiles before/after.

## Targeted TODO Tasks

1. Replace `input.slice(offset)` hot-path probes with non-copy views or offset helpers:
   - introduce `sniffAt(input, offset)` and similar offset-based helpers where practical
   - otherwise use `subarray(offset)` instead of `slice(offset)` for parse lookahead
2. Audit collaborator modules for avoidable tail-copy patterns in tight loops:
   - `packages/cesr/src/core/parser-frame-parser.ts`
   - `packages/cesr/src/core/parser-attachment-collector.ts`
   - `packages/cesr/src/core/parser-stream-state.ts`
3. Add a micro-benchmark specifically for chunked streams with frequent boundary probing to verify reduced allocation churn.

## Acceptance Criteria

- no parser behavior regressions in existing unit/integration tests
- benchmark improvement in small-chunk streaming workload
- fewer total allocations/copies under sustained incremental input
- code remains readable and explicitly documented

## Notes on `concatBytes`

- Keep `concatBytes` for general utility usage.
- If needed later, add a two-argument helper for hot paths, but only with benchmark evidence.
- Do not prematurely optimize `reduce` vs `for`; the dominant cost is byte copying, not length summation.
