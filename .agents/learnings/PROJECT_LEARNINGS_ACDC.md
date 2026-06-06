# PROJECT_LEARNINGS_ACDC

## Purpose

Persistent ACDC memory for `keri-ts`.

Keep this file focused on durable ACDC rules, not step-by-step task history.

## Current State

1. ACDC-specific memory is still much smaller than CESR/KEL memory; most recent
   ACDC progress came through shared serder/native work rather than a long
   standalone credential implementation lane.
2. `SerderACDC` parity now depends on section-label-aware identifier handling:
   schema sections compute `$id`, ordinary saidive sections compute `d`, and
   aggregate sections compute and verify `agid`.
3. Compactable top-level ACDCs and partial section-message ilks are different
   verification lanes: compactive ilks hash over the most compact section form,
   while partial section messages keep the visible section expanded but still
   require embedded identifiers to be correct.
4. Native ACDC support now rides the shared native support matrix in
   `packages/cesr/src/serder/native.ts`; future parity work should extend that
   matrix and its field-family helpers instead of adding ACDC-only sidecar
   parser or serder branches.
5. ACDC storage/indexing work should inherit the same DB invariants used by the
   rest of the project; duplicate-order and idempotence assumptions live in the
   shared DB architecture contract, not in ad hoc credential-local lore.
6. The registry-backed IPEX route family now exists in `app/ipexing.ts` with
   KERIpy route graph validation, `erpy` one-response-per-prior enforcement,
   KERIpy notifier payloads, and v1 EXN builders for apply/offer/agree/grant/
   admit/spurn.
7. Parser/runtime VDR dispatch is now fakeable: TEL ilks route through injected
   `tvy.processEvent` with the last `SealSourceCouples` source, ACDC bodies
   route through injected `vry.processACDC` with the last `SealSourceTriples`
   source, and `Reactor` runs optional TEL/verifier escrow turns.
8. The first concrete registry-backed `Tevery`/`Tever` and `Verifier` exist
   behind that seam. TEL processing covers registry inception, backer rotation,
   issue, revoke, out-of-order and anchorless reprocessing, and KERIpy Reger
   state persistence; verifier processing validates cached JSON schemas, saves
   direct revoked credentials, rejects revoked chains, applies `I2I`/`NI2I`
   defaults, fails `DI2I` explicitly, writes KERIpy `saved`/`issus`/`schms`/
   `subjs` indexes, and replays `mce`/`mse`/`mre` escrows in KERIpy order.

## Use This Doc For

1. Credential data-model and compactification rules.
2. Issuance/presentation serialization and verification assumptions.
3. ACDC-specific parity or interoperability findings.

## Key Reference

1. `docs/design-docs/db/db-architecture.md`

## Current Follow-Ups

1. Grow ACDC-native coverage only through the shared native support matrix.
2. Keep compactification and partial-section verification as explicitly separate
   lanes; do not collapse them into generic "map in, map out" serder behavior.
3. Revisit ACDC-specific DB mappings once later DB parity work reaches the
   credential-indexing layers.
4. Implement registry orchestration services (`Regery`, `Registry`,
   `Registrar`, `Credentialer`) behind the VDR dispatch seam; the existing
   `Verifier` depends on TEL state from `Tever` and does not replace issuance
   orchestration.

## Milestone Rollup

### 2026-03-03 - Shared DB Invariants Became Explicit

- ACDC task threads now route through the shared DB architecture contract so
  credential indexing and duplicate-order reasoning do not drift away from the
  rest of `keri-ts`.

### 2026-03-17 - ACDC Compactification And Native Parity Became Explicit

- `SerderACDC` now treats section identifiers by family (`$id`, `d`, `agid`)
  instead of generic saidive handling.
- Top-level compactable ACDCs and partial section messages are now recognized as
  separate verification modes.
- Native ACDC handling moved under the same matrix-driven support layer used by
  the broader CESR-native serder path.

### 2026-06-06 - IPEX Routes And VDR Dispatch Seam Landed

- IPEX route handling now mirrors KERIpy `vc/protocoling.py` for builders,
  previous-route validation, duplicate-response prevention, and notifier
  payload shape.
- Parser/runtime VDR handoff now has typed fakeable TEL and ACDC dispatch
  surfaces, preserving KERIpy's last-source-seal selection while deferring the
  concrete `Reger`/`Tevery`/`Verifier` implementations.

### 2026-06-06 - Registry-Backed Verifier Core Landed

- `vdr/eventing.ts` now owns the first concrete `Tever`/`Tevery` port for TEL
  registry inception, rotation, issue, revoke, accepted-state persistence, and
  anchorless/out-of-order escrow replay.
- `app/verifying.ts` now owns the KERIpy-compatible verifier core for cached
  schema validation, credential save indexes, missing registry/schema/chain
  escrows, direct-revoked save behavior, revoked-chain rejection, and
  `I2I`/`NI2I`/explicit-`DI2I` chain policy.
- This is still below the Sally-like verifier-agent layer: grant artifact
  extraction, verifier-specific webhook state, business validators, revocation
  webhook delivery, and `tufa verifier` remain follow-up work.
