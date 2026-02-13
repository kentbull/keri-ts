# Proposed Plan

## CESR Parser Implementation Plan for keri-ts (Phase 1, Decision-Complete)

### Summary

Build a new publishable CESR package in keri-ts that delivers a complete parser stack with faithful KERIpy/SignifyTS core
behavior, using your required three-layer model:

1. Sync core parser engine (transport/runtime agnostic).
2. Async iterable adapter.
3. Effection adapter.

Scope includes full CESR framing and attachments for KERI/ACDC streams, full v1/v2 support, JSON/CBOR/MGPK body framing, strict
fail-fast unknown-code policy, and a thin router contract stub only.

### Public Interfaces and Package Changes

- Create packages/cesr as a dedicated workspace package with its own deno.json, exports, and tests.
- Root keri-ts imports parser APIs from packages/cesr (no parser logic remains in current empty placeholders).
- Add explicit exported APIs:
- createParser(options): CesrParserCore
- CesrParserCore.feed(chunk: Uint8Array): ParseEmission[]
- CesrParserCore.flush(): ParseEmission[]
- CesrParserCore.reset(): void
- parseBytes(bytes: Uint8Array, options?): ParseEmission[] (convenience)
- toAsyncFrames(source: AsyncIterable<Uint8Array>, options?): AsyncGenerator<CesrFrame>
- toEffectionFrames(source, options?): Operation<FrameChannel>
- CesrRouter interface + createRouterStub(...) only (no event processing logic)
- Exported model types:
- CesrFrame
- SerderEnvelope
- AttachmentGroup
- AttachmentItem
- ParserState
- ParserError + typed subclasses (ShortageError, ColdStartError, VersionError, UnknownCodeError, GroupSizeError,
  DeserializeError)
- Versionage, Smellage, ColdCode, CounterCode, MatterCode

### Repository Structure to Implement

- packages/cesr/src/core/
- parser-engine.ts (sync state machine)
- state.ts (ParserState + transitions)
- emissions.ts (frame/error/event emissions)
- errors.ts
- packages/cesr/src/tables/
- matter.tables.generated.ts
- counter.tables.generated.ts
- versions.ts
- table-types.ts
- packages/cesr/src/primitives/
- matter.ts
- counter.ts
- indexer.ts
- siger.ts
- cigar.ts
- prefixer.ts
- seqner.ts
- saider.ts
- dater.ts
- verfer.ts
- diger.ts
- number.ts
- pather.ts
- verser.ts
- labeler.ts
- packages/cesr/src/serder/
- serder.ts
- serder-keri.ts
- serder-acdc.ts
- serdery.ts
- smell.ts
- packages/cesr/src/parser/
- cold-start.ts
- frame-parser.ts
- attachment-parser.ts
- group-dispatch.ts
- group-parsers/\*.ts (all supported counter groups)
- packages/cesr/src/adapters/
- async-iterable.ts
- effection.ts
- router-stub.ts
- packages/cesr/scripts/
- generate-tables.ts (pinned-source table generation)
- verify-tables.ts
- packages/cesr/test/
- unit/\*
- integration/\*
- fixtures/\* (goldens from KERIpy/parside/cesr-decoder)

### Implementation Approach

### 1. Generated Tables as Canonical Source

- Implement generator script that builds TS tables from pinned upstream references.
- Pin source snapshots (commit-hash metadata) for:
- Matter codex + sizage tables.
- Counter codex + sizage tables.
- Version-related mappings (v1/v2).
- Commit generated TS artifacts; CI verifies regeneration produces no diff.
- Runtime never loads dynamic JSON tables.

### 2. Primitives and Core Types

- Implement Matter/Counter primitives with full qb64/qb64b/qb2 support.
- Enforce alignment checks, lead/pad checks, and strict size invariants.
- Implement version-aware table lookup by Versionage.
- Keep primitive constructors deterministic and side-effect-free.
- Include byte-offset-aware parsing helpers for precise error reporting.

### 3. Version and Cold-Start System

- Implement KERIpy-compatible sniff over tritet:
- msg, txt, bny, ano.
- Implement versify/deversify/smell for v1 and v2 with exact formatting rules.
- Enforce protocol-kind-version compatibility checks:
- Protocol: KERI/ACDC.
- Kind: JSON/CBOR/MGPK/CESR (where applicable).
- Genus/message version compatibility constraints.

### 4. Sync Parser Core (State Machine)

- Core parser consumes arbitrary chunks and accumulates internal buffer.
- Parsing states:
- AwaitColdStart
- AwaitBody
- AwaitAttachmentsCounter
- AwaitAttachmentGroup
- EmitFrame
- Error
- feed(chunk) loops until shortage or terminal error, returning ParseEmission[].
- flush() returns terminal shortage/incomplete-frame errors when buffer is non-empty.
- Strict fail-fast behavior:
- Unknown/unsupported code causes typed error with byte offset and parser state.
- Core does not auto-skip malformed frames.

### 5. Body Extraction Rules

- For JSON/CBOR/MGPK bodies:
- Use smell/version extraction to derive exact body size.
- Slice exact raw body bytes to Serder factory.
- Build SerderEnvelope with protocol, ilk, pvrsn, gvrsn, kind, size, said.
- For CESR-native body groups:
- Parse enclosing counters and body groups according to version-selected tables.

### 6. Attachment Parsing and Group Coverage

- Implement full counter-dispatch map (v1/v2-aware) modeled after KERIpy method table pattern.
- Implement group parsers for:
- Controller indexed signatures
- Witness indexed signatures
- Non-transferable receipt couples
- Transferable receipt quadruples
- Transferable indexed signature groups
- Transfer-last indexed signature groups
- First-seen replay couples
- Pathed material couples/quadlets
- Seal source couples
- Seal source triples
- Typed digest seal couples
- ESSR payload groups
- Attached material quadlets
- Generic groups and big-counter variants where table defines support
- Group parsers return normalized AttachmentGroup discriminated unions with exact raw slices and parsed primitives.

### 7. Async and Effection Adapters

- Async adapter:
- Wraps any AsyncIterable<Uint8Array>.
- Feeds chunks into core and yields CesrFrame emissions.
- Preserves error semantics from core.
- Effection adapter:
- Wraps core or async adapter.
- Exposes frame/error channel with structured cancellation semantics.
- Does not alter parse logic; adapter-only responsibility.

### 8. Thin Router Stub

- Add minimal router contract:
- Accepts CesrFrame.
- Dispatches by protocol/ilk to injected handlers.
- No Kevery/Revery/Tevery behavior implementation yet.
- Router exists to lock API for next phase without mixing event processing now.

### 9. Integration into Current keri-ts

- Replace current empty CESR placeholders by re-exporting package APIs.
- Keep existing CLI/db work untouched.
- Add small parser smoke usage path only if needed for build validation.

### Test Cases and Scenarios

- Unit: sniff tritet matrix for all 8 tritet values.
- Unit: v1/v2 versify/deversify/smell golden cases and invalid variants.
- Unit: Matter and Counter round-trip tests for qb64/qb64b/qb2.
- Unit: strict alignment and size mismatch error conditions.
- Unit: each group parser with normal, shortage, and malformed payload cases.
- Unit: unknown code strict fail-fast with byte-offset assertion.
- Integration: parse complete KERI event + attachments from KERIpy fixtures.
- Integration: parse ACDC stream frames with attachments.
- Integration: mixed stream with JSON/CBOR/MGPK messages.
- Integration: chunk-boundary fuzz tests (every possible split point over fixtures).
- Integration: async adapter parity with sync core emissions.
- Integration: Effection adapter cancellation and cleanup behavior.
- Compatibility: fixture parity against KERIpy and parside expected parse structures.
- Regression: generator-table verification test to ensure pinned source consistency.

### Acceptance Criteria

- Parser package builds and tests independently and from monorepo root.
- Full fixture suite passes for v1 and v2, KERI and ACDC, JSON/CBOR/MGPK.
- All listed attachment groups parse and emit typed structures.
- Strict unknown-code policy verified.
- Core parser has no runtime dependency on Effection, Deno globals, IO, or network.
- Async and Effection adapters are thin wrappers with parity-validated outputs.
- Router stub contract compiled and covered by contract tests.

### Execution Order

1. Workspace/package scaffolding and exports.
2. Table generation pipeline and pinned artifacts.
3. Core error/type system.
4. Matter/Counter + essential primitives.
5. Version/smell/cold-start.
6. Serder factory and protocol serder envelopes.
7. Core parser state machine.
8. Attachment group dispatch/parsers.
9. Async adapter.
10. Effection adapter.
11. Router stub.
12. Full compatibility and fuzz test suite.
13. Documentation for external consumers (API + migration notes).

### Assumptions and Defaults Chosen

- Package layout: dedicated workspace package (packages/cesr).
- Parser completeness target: full CESR framing plus KERI/ACDC stream parsing before escrow/event processing phase.
- Core architecture: three-layer model with sync transport-agnostic engine first.
- Serialization kinds in scope now: JSON, CBOR, MGPK.
- Unknown code behavior: strict fail-fast (no frame skipping).
- Router in this phase: thin contract stub only, no processing logic.
- Code/size tables source: generated artifacts from pinned upstream references, committed to repo.
