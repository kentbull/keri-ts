# Weighted Threshold Parity

Date: 2026-04-02

## Purpose

Capture the maintainer contract for weighted-threshold support in `keri-ts`
now that threshold logic is no longer limited to simple numeric `parseInt()`
checks inside KEL and reply-processing code.

## Design Rules

1. `Tholder` is the semantic authority.
   - It owns threshold normalization, CESR limen/sith projection, exact
     threshold-size calculation, and `satisfy(indices)`.
   - Higher layers must not reimplement weighted-threshold logic from raw
     `kt`/`nt` text or JSON structures.

2. `ThresholdSith` is the shared SAD-facing representation.
   - Numeric thresholds remain lowercase hex strings.
   - Weighted thresholds use KERIpy-shaped semantic arrays:
     - flat clause example: `["1/2", "1/2"]`
     - nested group example: `[{"1": ["1/2", "1/2"]}]`
   - Durable key-state `kt`/`nt` fields may therefore be structured values,
     not only strings.

3. Parsing and authoring must preserve weighted forms.
   - `SerderKERI` and CESR-native threshold fields must hydrate and emit the
     same semantic threshold structures across JSON, CBOR, and CESR-native
     paths.
   - Local authoring inputs such as `Hab.make()` and CLI/file inception options
     must accept weighted threshold expressions without flattening them.

4. KEL and reply verification must use `Tholder.satisfy(...)`.
   - `Kever` should validate signer-threshold material through `tholder.size`
     and signer satisfaction through `tholder.satisfy(indices)`.
   - Prior-next threshold checks on establishment events use the same rule.
   - `Revery` applies the same threshold semantics to transferable reply
     endorsements.

## Non-Goals

- This design does not implement multisig orchestration, group coordination, or
  membership-policy flows.
- Witness thresholds (`toad` / `bt`) remain numeric-only; weighted-threshold
  parity in this pass is for signing thresholds (`kt` / `nt`).

## Regression Floor

Changes in this area should preserve coverage for:

- flat weighted threshold roundtrip and satisfaction
- nested weighted group roundtrip and satisfaction
- weighted `SerderKERI` accessors from semantic arrays and CESR-native parsing
- weighted local inception and durable-state reload
- weighted `ixn` signature escrow/acceptance in `Kevery`
- weighted reply-signature aggregation in `Revery`
