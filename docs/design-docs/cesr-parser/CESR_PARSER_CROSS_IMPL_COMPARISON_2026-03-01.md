# CESR Parser Cross-Implementation Comparison (2026-03-01)

## Gate Model

- Blocking baseline: `KERIpy`
- Advisory baselines: `KERIox`, `libkeri`, `cesrixir`, `cesride`, `CESRox`, `kerits`, `keride`
- Decision rule used: any `keri-ts` mismatch against KERIpy core parser semantics is blocking (`S0`/`S1`); comparator-only differences are advisory (`S3`) unless they reveal a KERIpy/spec mismatch.

## Evidence Inputs

- `keri-ts`
  - `packages/cesr/src/core/parser-engine.ts`
  - `packages/cesr/src/core/parser-frame-parser.ts`
  - `packages/cesr/src/parser/group-dispatch.ts`
  - `packages/cesr/src/tables/counter-version-registry.ts`
  - `packages/cesr/test/unit/*.test.ts`
  - `packages/cesr/test/hardening/*.test.ts`
- `KERIpy`
  - `keripy/src/keri/core/parsing.py`
  - `keripy/src/keri/core/counting.py`
  - `keripy/tests/core/test_parsing.py`
- `KERIox`
  - `keriox/src/event_parsing/attachment.rs`
  - `keriox/src/event_parsing/payload_size.rs`
  - `keriox/src/event_parsing/message.rs`
  - `keriox/src/event_parsing/mod.rs`
- `libkeri`
  - `libkeri/src/keri/core/parsing.rs`
  - `libkeri/src/cesr/counting/mod.rs`
- `cesrixir`
  - `cesrixir/lib/cesr.ex`
  - `cesrixir/lib/CountCode/CntCodeGeneratorV1.ex`
  - `cesrixir/lib/CountCode/CntCodeGeneratorV2.ex`
- `cesride`
  - `cesride/src/lib.rs`
  - `cesride/src/core/common.rs`
  - `cesride/src/core/counter/tables.rs`
  - `cesride/src/core/serder.rs`
  - `cesride/README.md`
- `CESRox`
  - `cesrox/src/lib.rs`
  - `cesrox/src/prefix/mod.rs`
  - `cesrox/src/derivation/attached_signature_code.rs`
  - `cesrox/src/prefix/seed.rs`
  - `cesrox/README.md`
- `kerits` (Aaron/LSEG)
  - `kerits/src/cesr/codex.ts`
  - `kerits/src/cesr/matter.ts`
  - `kerits/src/storage/parser.ts`
  - `kerits/src/app/signing.ts`
  - `kerits/src/app/verification.ts`
  - `kerits/docs/cesr.md`
- `keride`
  - `keride/Cargo.toml`
  - `keride/src/cesr/mod.rs`
  - `keride/src/cesr/parside/message/message.rs`
  - `keride/src/cesr/parside/message/message_list.rs`
  - `keride/src/cesr/parside/message/groups/mod.rs`
  - `keride/src/cesr/parside/message/groups/pathed_material_quadlets.rs`

## Capability Matrix

Legend:

- `Full`: implemented and used as first-class parser capability
- `Partial`: capability exists but with notable scope limits, TODOs, or caveats
- `Limited`: narrow/specialized support only

| Capability                                                                        | keri-ts | KERIpy | KERIox  | libkeri         | cesrixir | cesride | CESRox  | kerits (LSEG) | keride  |
|-----------------------------------------------------------------------------------|---------|--------|---------|-----------------|----------|---------|---------|---------------|---------|
| Version model and codex selection (`major/minor`)                                 | Full    | Full   | Partial | Partial         | Partial  | Partial | Limited | Partial       | Partial |
| Cold-start domain handling (`msg`/`txt`/`bny`/`ano`)                              | Full    | Full   | Partial | Partial         | Partial  | Limited | Limited | Partial       | Partial |
| Wrapper/group breadth (Generic, BodyWithAttachment, Attachment, nested recursion) | Full    | Full   | Partial | Partial         | Partial  | Limited | Limited | Partial       | Partial |
| Native body support (Fix/Map)                                                     | Full    | Full   | Limited | Limited/Partial | Partial  | Limited | Limited | Limited       | Partial |
| qb64/qb2 parity behavior                                                          | Full    | Full   | Partial | Partial         | Partial  | Partial | Partial | Partial       | Partial |
| Shortage/flush stream lifecycle semantics                                         | Full    | Full   | Partial | Partial         | Partial  | Limited | Limited | Limited       | Limited |
| Strict/compat recovery policy and diagnostics                                     | Full    | Full   | Limited | Limited         | Limited  | Limited | Limited | Limited       | Limited |
| Test corpus depth for parser semantics                                            | Full    | Full   | Partial | Partial         | Partial  | Partial | Partial | Partial       | Partial |

### keri-ts implementation notes

- Version/codex selection via `packages/cesr/src/tables/counter-version-registry.ts`.
- Stream lifecycle contract is explicit in parser engine (`feed()/flush()` semantics).
- Test corpus includes P0/P1, KERIpy golden corpus, and P2 high-priority hardening vectors.

### KERIpy implementation notes

- Version handling and codex behavior are authoritative in `keripy/src/keri/core/parsing.py` and `keripy/src/keri/core/counting.py`.
- Lifecycle model is generator/parsator-based, not `feed()/flush()` API-style.

### KERIox implementation notes

- Attachment parsing includes explicit unimplemented branches (`todo!()` in `event_parsing/attachment.rs`).
- Payload-size and some binary-version helper paths are documented with TODO/testing caveats.

### libkeri implementation notes

- Parser flows are strongly anchored to `VRSN_1_0` in several extraction paths.
- Known TODO parity gap is documented in sad-path subpath logic.

### cesrixir implementation notes

- Stream module comments note unimplemented op-code path handling.
- Count-code generators include not-implemented annotations and binary restrictions in some paths.

### cesride implementation notes

- `cesride` is explicitly scoped as cryptographic primitives and marked "currently under construction" in `cesride/README.md`.
- Exported API in `cesride/src/lib.rs` is primitive-centric (`Matter`, `Counter`, `Indexer`, `Serder`, `Signer`, `Diger`, etc.), not a unified streaming parser engine.
- Version structs and helpers exist in `cesride/src/core/common.rs` (`Version`, `versify`, `deversify`, `sniff`), but `CURRENT_VERSION` is fixed at `1.0` and `sizeify` rejects non-1.0 versions.
- Counter codex tables are present in `cesride/src/core/counter/tables.rs`; this is codex/model support rather than a full `feed()/flush()` stream contract.
- Primitive `qb64`/`qb2` support is strong, but parser-level lifecycle parity is not exposed as a first-class API.

### CESRox implementation notes

- Current surface is primitive/prefix oriented (`derivation`, `prefix`, `keys`, `error`) from `src/lib.rs`.
- No full streaming parser lifecycle contract (`feed()/flush()` equivalent) is exposed.
- Attached-signature code includes index-range TODO (`indices up to 63`).

### kerits (LSEG) implementation notes

- CESR primitive support is substantial (`src/cesr/codex.ts`, `src/cesr/matter.ts`).
- Parsing behavior is distributed across storage/signing utilities (`src/storage/parser.ts`, `src/app/signing.ts`, `src/app/verification.ts`) rather than one unified stream parser engine.
- Signature attachment parsing is currently narrow to specific local assumptions (e.g., `-AAD`, `0B`/`0C` handling in `parseIndexedSignatures`).

### keride implementation notes

- KERIde includes CESR primitives and parser modules in-tree (`keride/src/cesr/core/*` and `keride/src/cesr/parside/*`), exported via `keride/src/cesr/mod.rs`.
- KERIde does not list `cesride` as a dependency in `keride/Cargo.toml`; it uses in-crate modules (`crate::cesr::*`) instead.
- `parside` provides stream parsing entry points (`Message::from_stream_bytes`, `MessageList::from_stream_bytes`) with cold-code dispatch to JSON/CBOR/MGPK and CESR groups.
- Group coverage is broad but incomplete; at least some group paths remain explicitly unimplemented (for example `pathed_material_quadlets.rs`).
- No unified parser lifecycle contract equivalent to `feed()/flush()` state-machine semantics is exposed.

## KERIpy-First Differential Outcome (Blocking Gate)

Checked behavior classes:

- cold-start domain handling
- version context propagation
- group dispatch and wrapper behavior
- shortage/flush/error lifecycle semantics
- qb64/qb2 parity
- native body parsing

Outcome:

- No open `S0`/`S1` parity break found against KERIpy for current parser commitments.
- High-priority P2 hardening vectors now pass in `keri-ts`:
  - `V-P2-001`, `002`, `005`, `008`, `011`, `012`, `014`, `015`, plus previously completed `V-P2-017`.

## Advisory Divergences (Non-Blocking)

| ID      | Divergence                                                                                                                      | Evidence                                                                                        | Classification |
|---------|---------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|----------------|
| ADV-001 | `KERIox` attachment parsing has explicit unimplemented branches                                                                 | `keriox/src/event_parsing/attachment.rs` (`_ => todo!()`)                                       | `S3` Advisory  |
| ADV-002 | `KERIox` payload-size and indexing table logic has TODO placeholders                                                            | `keriox/src/event_parsing/payload_size.rs` (`TODO` and placeholder size returns)                | `S3` Advisory  |
| ADV-003 | `KERIox` binary version parsers marked as requiring more tests                                                                  | `keriox/src/event_parsing/message.rs` (`TODO: Requires testing` on CBOR/MGPK version helpers)   | `S3` Advisory  |
| ADV-004 | `libkeri` parser path is strongly v1-anchored in many extraction flows                                                          | repeated `VRSN_1_0` usage in `libkeri/src/keri/core/parsing.rs`                                 | `S3` Advisory  |
| ADV-005 | `libkeri` has explicit TODO parity gap in sad-path subpath logic                                                                | `libkeri/src/keri/core/parsing.rs` (`TODO: fix this code to match subpath logic in KERIpy`)     | `S3` Advisory  |
| ADV-006 | `libkeri` shows likely duplicated match arm/code smell around receipt handling                                                  | duplicate `NON_TRANS_RECEIPT_COUPLES` arm in `process_attachments` (`parsing.rs`)               | `S3` Advisory  |
| ADV-007 | `cesrixir` stream module states op-code path is not implemented                                                                 | `cesrixir/lib/cesr.ex` comments in `sniff_tritet` handling                                      | `S3` Advisory  |
| ADV-008 | `cesrixir` count-code generators annotate some payload groups as not implemented and include binary restrictions for some paths | `cesrixir/lib/CountCode/CntCodeGeneratorV1.ex` comments and function guards                     | `S3` Advisory  |
| ADV-009 | `CESRox` appears scoped to CESR primitive/prefix derivations and does not expose a full streaming CESR parser lifecycle         | `cesrox/src/lib.rs` module surface (`derivation`, `prefix`, `keys`, `error`)                    | `S3` Advisory  |
| ADV-010 | `CESRox` has explicit attached-signature index range limitation                                                                 | `cesrox/src/derivation/attached_signature_code.rs` (`TODO ... only work with indices up to 63`) | `S3` Advisory  |
| ADV-011 | `CESRox` has open TODOs in seed/prefix derivation paths that reduce completeness confidence                                     | `cesrox/src/prefix/seed.rs`, `cesrox/src/prefix/mod.rs`, `cesrox/src/prefix/self_*`             | `S3` Advisory  |
| ADV-012 | `kerits` CESR parsing is split across storage/signing utilities and is not a unified streaming parser contract                  | `kerits/src/storage/parser.ts`, `kerits/src/app/signing.ts`, `kerits/src/app/verification.ts`   | `S3` Advisory  |
| ADV-013 | `kerits` signature parser is currently narrow to specific signature codes and local `-AAD` section assumptions                  | `kerits/src/app/signing.ts` (`parseIndexedSignatures`, known `0B`/`0C` handling)                | `S3` Advisory  |
| ADV-014 | `kerits` docs emphasize CESR primitive interoperability vectors more than full parser-semantic parity corpus                    | `kerits/docs/cesr.md` (primitive/vector focus)                                                  | `S3` Advisory  |
| ADV-015 | `cesride` is positioned as a primitives library and marked as under construction                                                | `cesride/README.md`, `cesride/src/lib.rs`                                                       | `S3` Advisory  |
| ADV-016 | `cesride` version handling currently enforces `CURRENT_VERSION = 1.0` in sizing/validation paths                                | `cesride/src/core/common.rs` (`CURRENT_VERSION`, `sizeify` unsupported-version rejection)       | `S3` Advisory  |
| ADV-017 | `cesride` does not expose a unified stream parser lifecycle contract equivalent to KERIpy/keri-ts parser engine                 | `cesride/src/lib.rs` exported surface (no parser-engine/flush model)                            | `S3` Advisory  |
| ADV-018 | `keride` does not currently consume `cesride` as an external crate dependency; CESR/parsing code is vendored in-tree            | `keride/Cargo.toml`, `keride/src/cesr/mod.rs`, `keride/src/cesr/README.md`                      | `S3` Advisory  |
| ADV-019 | `keride` parser/group coverage includes explicit unimplemented paths                                                            | `keride/src/cesr/parside/message/groups/pathed_material_quadlets.rs` (`unimplemented!()`)       | `S3` Advisory  |
| ADV-020 | `keride` has stream parsing entry points but no unified parser-engine lifecycle contract (`feed()/flush()` style)               | `keride/src/cesr/parside/message/message.rs`, `message_list.rs`                                 | `S3` Advisory  |

## CESRide and KERIde Alignment Notes

- KERIde currently vendors CESR/parsing code in-tree (`keride/src/cesr/core/*`, `keride/src/cesr/parside/*`) rather than consuming a published `cesride` crate via `Cargo.toml`.
- `keride/src/cesr/parside/README.md` states parside code is pulled in until a working agent is available, and references CESRide lineage.
- Practical impact: CESRide and KERIde are coupled by code lineage, not by package dependency boundaries; CESRide changes will not automatically propagate to KERIde parser behavior.
- Direct answer to dependency check: KERIde is not currently using `cesride` as an external crate dependency.
- Direct answer to parser-engine check: KERIde exposes stream parsing functions (`from_stream_bytes`) but does not expose a unified stateful parser engine with explicit `feed()/flush()` lifecycle semantics.
- Current KERIde parser evidence:
  - `Message::from_stream_bytes` supports cold-code dispatch for JSON/CBOR/MGPK and CESR groups.
  - Group parsing covers many attachment families in `groups/mod.rs`, but includes explicit unimplemented paths (for example `pathed_material_quadlets.rs`).

## Recommended Granular Matrix (Next Pass)

For CESRide/KERIde update planning, add a second, more granular matrix keyed by explicit contracts:

1. `versioning`: accepted versions, fallback policy, mixed-version wrapper behavior.
2. `cold-start`: `msg`/`txt`/`bny`/`ano` detection and dispatch behavior.
3. `counter families`: per-code support (including big-counter aliases and binary parity).
4. `group coverage`: each attachment/group code with parse/serialize parity status.
5. `wrapper recursion`: nested depth, opaque-tail behavior, and recovery semantics.
6. `native payloads`: JSON/MGPK/CBOR behavior by shape (map/fix) and error mode.
7. `stream lifecycle`: shortage, pending, flush idempotency, and reset/recovery behavior.
8. `qb64/qb2 parity`: deterministic equivalence per primitive and per group wrapper.
9. `error taxonomy`: syntax/deserialization/semantic/recovery classification comparability.
10. `test evidence`: vector IDs, corpus source, and pass/fail status per capability row.

## Comparator Limitations and Normalization Notes

- Direct apples-to-apples parser lifecycle comparison is constrained by architecture differences:
  - `keri-ts`: synchronous `feed()/flush()` state machine.
  - KERIpy: generator/parsator flow with yields and side-effect dispatch hooks.
- `KERIox`, `libkeri`, `cesrixir`, `cesride`, `CESRox`, `kerits`, and `keride` are useful interoperability references but do not provide the same breadth and maturity as KERIpy parser semantics for this gate.
- Some counter-format ecosystems use alternative big-counter textual forms (for example `-0X` families), reducing direct vector portability without normalization.

## Cross-Impl Conclusion

- Blocking comparison (`KERIpy`) indicates the `keri-ts` CESR parser is complete for current core commitments and high-priority hardening coverage.
- Secondary implementation differences are advisory and do not currently indicate a KERIpy/spec contract violation in `keri-ts`.
