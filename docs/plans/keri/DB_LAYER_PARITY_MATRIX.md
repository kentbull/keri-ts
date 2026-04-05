# DB Layer Parity Matrix (D0 audited)

## Purpose

D0 parity workbook for KERIpy DB-layer reconciliation against `keri-ts`. This
audited revision refreshes the symbol inventory, current KERIpy line
references, and per-row status values against the code actually present on
2026-04-03.

## Sources

- `keripy/src/keri/db/dbing.py`
- `keripy/src/keri/db/subing.py`
- `keripy/src/keri/db/koming.py`
- `keripy/src/keri/recording.py`
- `keripy/src/keri/db/basing.py`
- `keripy/src/keri/db/escrowing.py`
- `docs/design-docs/db/lmdb-dumper.md`

## Status Legend

- `Missing`: not implemented in `keri-ts` yet.
- `Partial`: implemented in some form but not parity-validated or not
  API-equivalent yet.
- `Equivalent`: implemented and backed by evidence strong enough to treat the
  current port as parity-complete for this row.
- `Deferred`: intentionally moved to a later approved phase.

## Owner Lanes

- `DB-CORE`: LMDB env, key helpers, path/open/close/lifecycle behavior.
- `DB-SUBER`: Suber and CESR-typed sub-database abstractions.
- `DB-KOMER`: Komer typed-object mapping abstractions.
- `DB-BASER`: Baser records/databaser composition and named subdb setup.
- `DB-ESCROW`: escrow brokers/process-loop primitives.

## Audit Notes

- KERIpy line numbers were refreshed against the current local `keripy`
  checkout on 2026-04-03.
- Record-contract rows belong to `keripy/src/keri/recording.py`; the earlier
  matrix mapping them to `basing.py` was inaccurate.
- The inventory is parity-relevant, not a blind dump of every private helper,
  comment-block TODO, or compatibility alias in KERIpy.
- Status is intentionally conservative: existing code stays `Partial` unless
  the current evidence is strong enough to call the row parity-complete.

## Module Symbol Summary

| Module         | Classes | Top-Level Functions | Total Symbols |
| -------------- | ------: | ------------------: | ------------: |
| `dbing.py`     |       1 |                  13 |            14 |
| `subing.py`    |      30 |                   0 |            30 |
| `koming.py`    |       4 |                   0 |             4 |
| `recording.py` |      16 |                   0 |            16 |
| `basing.py`    |       3 |                   2 |             5 |
| `escrowing.py` |       1 |                   0 |             1 |

## Module Symbol Parity Matrix

| Module         | Symbol Type | Symbol              | KERIpy Line | Owner       | KERIpy Path                       | Proposed `keri-ts` File               | Proposed `keri-ts` Symbol | Phase | Status       | Notes                                                                                                                                                                                            |
| -------------- | ----------- | ------------------- | ----------: | ----------- | --------------------------------- | ------------------------------------- | ------------------------- | ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dbing.py`     | `def`       | `fetchTsgs`         |          70 | `DB-BASER`  | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/core/routing.ts`   | `fetchReplyTsgs`          | `D4`  | `Partial`    | Reply-specific equivalents exist in `routing.ts` and `habbing.ts`, but there is no shared generic DB helper yet.                                                                                 |
| `dbing.py`     | `def`       | `onKey`             |         110 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `onKey`                   | `D1`  | `Partial`    | Implemented in `keys.ts`; return-type parity still differs from KERIpy's str/bytes passthrough model.                                                                                            |
| `dbing.py`     | `def`       | `snKey`             |         127 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `snKey`                   | `D1`  | `Partial`    | Implemented as an alias to `onKey`; shares the same return-type caveat.                                                                                                                          |
| `dbing.py`     | `def`       | `fnKey`             |         141 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `fnKey`                   | `D1`  | `Partial`    | Implemented as an alias to `onKey`; shares the same return-type caveat.                                                                                                                          |
| `dbing.py`     | `def`       | `dgKey`             |         155 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `dgKey`                   | `D1`  | `Partial`    | Implemented in `keys.ts` and exercised transitively through DB wrapper tests, but not promoted by a dedicated parity proof.                                                                      |
| `dbing.py`     | `def`       | `dtKey`             |         168 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `dtKey`                   | `D1`  | `Partial`    | Implemented in `keys.ts`; current TS helper returns bytes only and does not mirror KERIpy's broader input-type passthrough.                                                                      |
| `dbing.py`     | `def`       | `splitKey`          |         185 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `splitKey`                | `D1`  | `Partial`    | Right-split behavior is directly tested in `test/unit/db/core/keys.test.ts`, but TS always returns byte tuples instead of preserving input type.                                                 |
| `dbing.py`     | `def`       | `splitOnKey`        |         210 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `splitOnKey`              | `D1`  | `Partial`    | Alias exists and is directly tested, but TS still normalizes outputs to byte-prefix + number instead of KERIpy's input-type-preserving behavior.                                                 |
| `dbing.py`     | `def`       | `splitKeyDT`        |         231 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `splitKeyDT`              | `D1`  | `Partial`    | Implemented, but TS returns the datetime string instead of KERIpy's parsed datetime object.                                                                                                      |
| `dbing.py`     | `def`       | `suffix`            |         247 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `suffix`                  | `D1`  | `Partial`    | Implemented and exercised indirectly by `LMDBer` io-set helpers; standalone parity evidence is still indirect.                                                                                   |
| `dbing.py`     | `def`       | `unsuffix`          |         268 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`   | `unsuffix`                | `D1`  | `Partial`    | Implemented and exercised indirectly by `LMDBer` io-set helpers; standalone parity evidence is still indirect.                                                                                   |
| `dbing.py`     | `def`       | `clearDatabaserDir` |         291 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` | `clearDatabaserDir`       | `D1`  | `Partial`    | Helper exists with idempotency coverage in `test/unit/db/core/lmdber-helpers.test.ts`; permission-edge parity remains unreviewed.                                                                |
| `dbing.py`     | `def`       | `openLMDB`          |         300 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` | `openLMDB`                | `D1`  | `Partial`    | Effection factory exists and is tested, but it is not a direct contextmanager-style alias of KERIpy's helper.                                                                                    |
| `dbing.py`     | `class`     | `LMDBer`            |         335 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` | `LMDBer`                  | `D1`  | `Partial`    | Core `LMDBer` method families are landed with broad unit coverage and oracle vectors, but the overall class still has API-shape and lifecycle differences from KERIpy.                           |
| `subing.py`    | `class`     | `SuberBase`         |         113 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `SuberBase`               | `D2`  | `Partial`    | Base wrapper exists in `subing.ts` and underpins the landed family surface, but parity evidence is mostly indirect through subclass tests.                                                       |
| `subing.py`    | `class`     | `Suber`             |         391 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `Suber`                   | `D2`  | `Partial`    | Implemented and directly exercised in `test/unit/db/subing.test.ts`; broader parity promotion still needs more than the current CRUD/iteration coverage.                                         |
| `subing.py`    | `class`     | `OnSuberBase`       |         499 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `OnSuberBase`             | `D2`  | `Partial`    | Implemented in `subing.ts`; current evidence is indirect through `OnSuber` and databaser call sites.                                                                                             |
| `subing.py`    | `class`     | `OnSuber`           |         804 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `OnSuber`                 | `D2`  | `Partial`    | Implemented and directly exercised in `test/unit/db/subing.test.ts`; still conservative `Partial` until wider parity vectors are reviewed.                                                       |
| `subing.py`    | `class`     | `B64SuberBase`      |         830 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `B64SuberBase`            | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `B64Suber`          |         956 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `B64Suber`                | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `CesrSuberBase`     |         985 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CesrSuberBase`           | `D2`  | `Partial`    | Implemented in `subing.ts`; direct evidence comes through CESR-typed subclasses rather than the base class itself.                                                                               |
| `subing.py`    | `class`     | `CesrSuber`         |        1056 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CesrSuber`               | `D2`  | `Partial`    | Typed CESR hydration is directly exercised in `test/unit/db/subing.test.ts`, but the full KERIpy family surface is not yet parity-signed off.                                                    |
| `subing.py`    | `class`     | `CesrOnSuber`       |        1085 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CesrOnSuber`             | `D2`  | `Partial`    | Implemented in `subing.ts` and used by `Baser.cdel`, but does not yet have dedicated parity coverage.                                                                                            |
| `subing.py`    | `class`     | `CatCesrSuberBase`  |        1112 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CatCesrSuberBase`        | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `CatCesrSuber`      |        1211 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CatCesrSuber`            | `D2`  | `Partial`    | Implemented and used across `Baser`, but currently lacks dedicated parity tests.                                                                                                                 |
| `subing.py`    | `class`     | `IoSetSuber`        |        1249 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `IoSetSuber`              | `D2`  | `Partial`    | Implemented and directly exercised in `test/unit/db/subing.test.ts`; still conservative `Partial` pending broader parity review.                                                                 |
| `subing.py`    | `class`     | `B64IoSetSuber`     |        1645 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `B64IoSetSuber`           | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `CesrIoSetSuber`    |        1673 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CesrIoSetSuber`          | `D2`  | `Partial`    | Implemented and directly exercised in `test/unit/db/subing.test.ts`; still conservative `Partial` pending broader parity review.                                                                 |
| `subing.py`    | `class`     | `CatCesrIoSetSuber` |        1723 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CatCesrIoSetSuber`       | `D2`  | `Partial`    | Implemented and used across `Baser`, but currently lacks dedicated parity tests.                                                                                                                 |
| `subing.py`    | `class`     | `SignerSuber`       |        1777 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `SignerSuber`             | `D2`  | `Partial`    | Implemented and directly exercised in `test/unit/db/subing.test.ts`; wider key-management parity is still tracked separately.                                                                    |
| `subing.py`    | `class`     | `CryptSignerSuber`  |        1870 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CryptSignerSuber`        | `D2`  | `Equivalent` | Encrypted-at-rest semantics, reopen flows, and keeper integration are directly covered; this is the one subing row with evidence strong enough for `Equivalent`.                                 |
| `subing.py`    | `class`     | `SerderSuberBase`   |        2007 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `SerderSuberBase`         | `D2`  | `Partial`    | Implemented in `subing.ts`; direct evidence comes through `SerderSuber`/`SchemerSuber` rather than the base class itself.                                                                        |
| `subing.py`    | `class`     | `SerderSuber`       |        2062 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `SerderSuber`             | `D2`  | `Partial`    | Implemented and directly exercised in `test/unit/db/subing.test.ts`; broader family parity still remains open.                                                                                   |
| `subing.py`    | `class`     | `SerderIoSetSuber`  |        2086 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `SerderIoSetSuber`        | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `SchemerSuber`      |        2139 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `SchemerSuber`            | `D2`  | `Partial`    | Implemented in `subing.ts`; schema-oriented behavior is not yet directly parity-tested.                                                                                                          |
| `subing.py`    | `class`     | `DupSuber`          |        2176 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `DupSuber`                | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `CesrDupSuber`      |        2360 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CesrDupSuber`            | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `CatCesrDupSuber`   |        2380 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `CatCesrDupSuber`         | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `IoDupSuber`        |        2414 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `IoDupSuber`              | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests apart from transitive `LMDBer`/wrapper behavior.                                                                          |
| `subing.py`    | `class`     | `B64IoDupSuber`     |        2678 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `B64IoDupSuber`           | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `OnIoDupSuber`      |        2707 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `OnIoDupSuber`            | `D2`  | `Partial`    | Implemented and directly exercised in `test/unit/db/subing.test.ts`; still conservative `Partial` pending broader parity review.                                                                 |
| `subing.py`    | `class`     | `B64OnIoDupSuber`   |        3135 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `B64OnIoDupSuber`         | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `subing.py`    | `class`     | `OnIoSetSuber`      |        3171 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `OnIoSetSuber`            | `D2`  | `Partial`    | Implemented and directly exercised in `test/unit/db/subing.test.ts`; still conservative `Partial` pending broader parity review.                                                                 |
| `subing.py`    | `class`     | `B64OnIoSetSuber`   |        3823 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`      | `B64OnIoSetSuber`         | `D2`  | `Partial`    | Implemented in `subing.ts`, but currently lacks dedicated parity tests.                                                                                                                          |
| `koming.py`    | `class`     | `KomerBase`         |          22 | `DB-KOMER`  | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts`      | `KomerBase`               | `D3`  | `Partial`    | Implemented with JSON/CBOR/MGPK codec selection, but it intentionally differs from KERIpy's dataclass-schema contract and runtime type enforcement.                                              |
| `koming.py`    | `class`     | `Komer`             |         305 | `DB-KOMER`  | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts`      | `Komer`                   | `D3`  | `Partial`    | Implemented and directly exercised in `test/unit/db/koming.test.ts`; still conservative `Partial` until broader query/iterator parity is reviewed.                                               |
| `koming.py`    | `class`     | `IoSetKomer`        |         429 | `DB-KOMER`  | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts`      | `IoSetKomer`              | `D3`  | `Partial`    | Implemented in `koming.ts` and exercised indirectly by `Baser.wkas`, but it still lacks a dedicated parity suite.                                                                                |
| `koming.py`    | `class`     | `DupKomer`          |         660 | `DB-KOMER`  | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts`      | `DupKomer`                | `D3`  | `Partial`    | Native dupsort-backed mapper is implemented with direct CRUD/iteration/count/removal coverage, but broader parity review against the full `koming.py` behavior is still pending.                 |
| `recording.py` | `class`     | `RawRecord`         |          18 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `RawRecord`               | `D4`  | `Partial`    | TS now has a shared record base with `fromDict`, `asDict`, `asJSON`, `asCBOR`, and `asMGPK`, but it intentionally preserves TS-native runtime class/shape separation and omitted-field behavior. |
| `recording.py` | `class`     | `StateEERecord`     |          59 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `StateEERecord`           | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and exercised through direct record tests plus nested `KeyStateRecord` hydration, but broader parity sign-off is still conservative.                            |
| `recording.py` | `class`     | `KeyStateRecord`    |          77 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `KeyStateRecord`          | `D4`  | `Partial`    | Ported as a `RawRecord` subclass with nested `StateEERecord` hydration and active `Baser`/`Kever` use, but wider contract parity still needs explicit row-level review.                          |
| `recording.py` | `class`     | `EventSourceRecord` |         133 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `EventSourceRecord`       | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and bound through `Baser.esrs`, but parity evidence is still mostly indirect.                                                                                   |
| `recording.py` | `class`     | `HabitatRecord`     |         147 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `HabitatRecord`           | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and exercised through `Baser.habs`/reload tests, but broader contract parity is still indirect.                                                                 |
| `recording.py` | `class`     | `TopicsRecord`      |         171 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `TopicsRecord`            | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and bound through `Baser.tops`, but parity evidence remains indirect.                                                                                           |
| `recording.py` | `class`     | `OobiQueryRecord`   |         181 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `OobiQueryRecord`         | `D4`  | `Partial`    | The record contract is now ported and directly tested; no `Baser` binding was added because current KERIpy does not actively wire an `oobiq` store.                                              |
| `recording.py` | `class`     | `OobiRecord`        |         214 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `OobiRecord`              | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and backs the active OOBI stores, but broader contract parity is still indirect.                                                                                |
| `recording.py` | `class`     | `EndpointRecord`    |         229 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `EndpointRecord`          | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and backs `Baser.ends`, but broader contract parity is still indirect.                                                                                          |
| `recording.py` | `class`     | `EndAuthRecord`     |         302 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `EndAuthRecord`           | `D4`  | `Partial`    | Ported as a `RawRecord` subclass, but the richer embedded-record behavior is not yet directly parity-tested.                                                                                     |
| `recording.py` | `class`     | `LocationRecord`    |         325 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `LocationRecord`          | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and backs `Baser.locs`, but broader contract parity is still indirect.                                                                                          |
| `recording.py` | `class`     | `ObservedRecord`    |         380 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `ObservedRecord`          | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and backs `Baser.obvs`, but broader contract parity is still indirect.                                                                                          |
| `recording.py` | `class`     | `CacheTypeRecord`   |         430 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `CacheTypeRecord`         | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and bound through `Baser.ctyp`, but there is no dedicated KRAM record parity suite yet.                                                                         |
| `recording.py` | `class`     | `MsgCacheRecord`    |         470 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `MsgCacheRecord`          | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and bound through `Baser.msgc`, but there is no dedicated KRAM record parity suite yet.                                                                         |
| `recording.py` | `class`     | `TxnMsgCacheRecord` |         496 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `TxnMsgCacheRecord`       | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and bound through `Baser.tmsc`, but there is no dedicated KRAM record parity suite yet.                                                                         |
| `recording.py` | `class`     | `WellKnownAuthN`    |         524 | `DB-BASER`  | `keripy/src/keri/recording.py`    | `packages/keri/src/core/records.ts`   | `WellKnownAuthN`          | `D4`  | `Partial`    | Ported as a `RawRecord` subclass and exercised through `Baser.wkas`, but it still lacks dedicated parity validation.                                                                             |
| `basing.py`    | `class`     | `statedict`         |          75 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`      | `reloadKevers/getKever`   | `D4`  | `Partial`    | TS uses explicit `reloadKevers()` and `getKever()` helpers instead of Python's read-through dict subclass; local-hab reload semantics are present, but the transparent mapping behavior is not.  |
| `basing.py`    | `def`       | `openDB`            |         130 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`      | `createBaser`             | `D4`  | `Partial`    | `createBaser()` provides the constructor-safe open factory, but there is no exact contextmanager-style `openDB` alias.                                                                           |
| `basing.py`    | `def`       | `reopenDB`          |         140 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`      | `Baser.reopen`            | `D4`  | `Partial`    | `Baser.reopen()` exists, but there is no top-level wrapper matching KERIpy's contextmanager helper.                                                                                              |
| `basing.py`    | `class`     | `Baser`             |         166 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`      | `Baser`                   | `D4`  | `Partial`    | `Baser` now binds a broad named-subdb surface and is exercised by unit tests plus live interop, but escrow/process-loop closure and row-by-row behavioral parity remain open.                    |
| `basing.py`    | `class`     | `BaserDoer`         |        2006 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`      | `BaserDoer`               | `D4`  | `Partial`    | Effection-native lifecycle wrapper now exists with reopen-on-enter and temp-clear-on-exit tests, but it is intentionally not yet wired into `Habery` or CLI ownership flows.                     |
| `escrowing.py` | `class`     | `Broker`            |          23 | `DB-ESCROW` | `keripy/src/keri/db/escrowing.py` | `packages/keri/src/db/escrowing.ts`   | `Broker`                  | `D5`  | `Partial`    | DB substrate exists with direct escrow/update/current/remove tests, but it remains unwired to TEL/Reger runtime ownership and the generic `fetchTsgs` helper row is still tracked separately.    |

## D0 Snapshot

- Module symbols inventoried: **70**
- Current `Equivalent`: **1**
- Current `Partial`: **69**
- Current `Missing`: **0**
- K/V rows inventoried: **130**
- K/V Gate A-G worklist rows: **33**
  (`docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`)
- K/V Gate H backlog rows: **97**
  (`docs/plans/keri/DB_LAYER_KV_GATE_H_BACKLOG.csv`)

## D1 Progress Snapshot (2026-03-03)

1. `LMDBer` gained KERIpy-aligned branch primitives:
   - `cntTop` (branch count),
   - `cntAll` (full-db alias),
   - `delTop` (branch delete).
2. Reopen/version behavior now stamps `__version__` for temp/new writeable DB
   opens, matching KERIpy temp-db versioning intent more closely.
3. `LMDBer` now includes the remaining `dbing.py` core method families needed
   before Suber migration:
   - `On*`/`OnAll*` ordinal-key methods,
   - `IoSet*` + `OnIoSet*` insertion-ordered keyspace-set methods,
   - `dup*` native duplicate methods,
   - `IoDup*` + `OnIoDup*` insertion-ordered duplicate methods.
4. Strict oracle parity vectors were added from direct KERIpy runs for
   backward-iterator + mixed-key edge scenarios in:
   - `getOnAllIoSetItemBackIter`
   - `getOnAllIoSetLastItemBackIter`
   - `getOnIoDupItemBackIter`
   - `getOnIoDupValBackIter`
5. Every current `LMDBer` method now has at least one unit-test representation.
6. Evidence tests:
   - `test/unit/db/core/lmdber-core-parity.test.ts`
   - `test/unit/db/core/lmdber-helpers.test.ts`
   - `test/unit/db/core/keys.test.ts`

## Row Audit Update (2026-04-03)

1. The row inventory now matches the actual current KERIpy locations and
   removes stale placeholder mappings such as `basing.py` -> record-contract
   rows.
2. All 30 inventoried `subing.py` classes now have concrete `subing.ts`
   targets; the previous wall of `Missing` rows was document drift, not code
   reality.
3. `koming.ts` now has `KomerBase`, `Komer`, `IoSetKomer`, and `DupKomer`; no
   inventoried `koming.py` row is currently `Missing`.
4. `basing.ts` now binds the broad named-subdb surface, and KERIpy's
   `statedict` read-through behavior is approximated by explicit
   `reloadKevers()` / `getKever()` helpers rather than a Python dict subclass.
5. The previous row-level `Missing` surface (`RawRecord`, `OobiQueryRecord`,
   `DupKomer`, `BaserDoer`, `Broker`) is now implemented and directly tested,
   but all five remain conservatively `Partial` until broader parity review is
   complete.
6. The TS record-layer naming model is now `FooRecord` plus `FooRecordShape`;
   exported `*Like` aliases were removed because they were a type-system crutch
   rather than a KERIpy concept.
7. `fetchTsgs` is still only partially ported: `Broker` now has a private local
   TSG reconstruction helper, but there is still no shared generic DB helper.

## K/V Inventory Artifacts

- Full K/V matrix:
  - `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
- Gate A-G worklist (explicit gate mapping columns `gate` and `gate_rationale`):
  - `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
- Gate H backlog:
  - `docs/plans/keri/DB_LAYER_KV_GATE_H_BACKLOG.csv`

## Next D0 Fill-In Tasks

1. Promote `Partial` rows to `Equivalent` only when there is row-specific
   evidence, not just symbol existence.
2. Promote the newly landed `RawRecord`, `OobiQueryRecord`, `DupKomer`,
   `BaserDoer`, and `Broker` rows from `Partial` to `Equivalent` only with
   row-specific evidence beyond symbol existence and smoke tests.
3. Decide whether the generic `fetchTsgs` helper should remain a separate
   shared DB utility or stay intentionally embedded in row-specific callers.
4. Decide whether factory/contextmanager helper differences (`openLMDB`,
   `openDB`, `reopenDB`) should stay intentionally TS-native or gain exact
   KERIpy aliases.
5. Use `tufa db dump` snapshots and KERIpy cross-checks to keep the K/V
   artifacts aligned with the now-refreshed symbol matrix.
