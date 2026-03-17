# DB Layer Parity Matrix (D0 v1)

## Purpose

D0 parity workbook for KERIpy DB layer reconciliation against `keri-ts`. This
version upgrades the initial skeleton by adding owner lanes and concrete
proposed TypeScript symbol targets.

## Sources

- `keripy/src/keri/db/dbing.py`
- `keripy/src/keri/db/subing.py`
- `keripy/src/keri/db/koming.py`
- `keripy/src/keri/db/basing.py`
- `keripy/src/keri/db/escrowing.py`
- `docs/design-docs/db/lmdb-dumper.md`

## Status Legend

- `Missing`: not implemented in `keri-ts` yet.
- `Partial`: implemented in some form but not parity-validated.
- `Equivalent`: implemented and parity-validated.
- `Deferred`: intentionally moved to a later approved phase.

## Owner Lanes

- `DB-CORE`: LMDB env, key helpers, path/open/close/lifecycle behavior.
- `DB-SUBER`: Suber and CESR-typed sub-database abstractions.
- `DB-KOMER`: Komer typed-object mapping abstractions.
- `DB-BASER`: Baser records/databaser composition and named subdb setup.
- `DB-ESCROW`: escrow brokers/process-loop primitives.

## Module Symbol Summary

| Module         | Classes | Top-Level Functions | Total Symbols |
| -------------- | ------: | ------------------: | ------------: |
| `dbing.py`     |       1 |                  12 |            13 |
| `subing.py`    |      30 |                   0 |            30 |
| `koming.py`    |       4 |                   0 |             4 |
| `basing.py`    |      17 |                   2 |            19 |
| `escrowing.py` |       1 |                   0 |             1 |

## Module Symbol Parity Matrix

| Module         | Symbol Type | Symbol              | KERIpy Line | Owner       | KERIpy Path                       | Proposed `keri-ts` File                         | Proposed `keri-ts` Symbol | Phase | Status    | Notes                                                                                                                                                                                                                           |
| -------------- | ----------- | ------------------- | ----------: | ----------- | --------------------------------- | ----------------------------------------------- | ------------------------- | ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dbing.py`     | `def`       | `onKey`             |          71 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `onKey`                   | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `snKey`             |          88 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `snKey`                   | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `fnKey`             |         102 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `fnKey`                   | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `dgKey`             |         116 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `dgKey`                   | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `dtKey`             |         129 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `dtKey`                   | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `splitKey`          |         146 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `splitKey`                | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `splitOnKey`        |         171 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `splitOnKey`              | `D1`  | `Partial` | Added alias + right-split behavior; parity tests added in `test/unit/db/core/keys.test.ts`                                                                                                                                      |
| `dbing.py`     | `def`       | `splitKeyDT`        |         192 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `splitKeyDT`              | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `suffix`            |         208 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `suffix`                  | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `unsuffix`          |         229 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/keys.ts`             | `unsuffix`                | `D1`  | `Partial` | Exists in TS key helpers; parity validation pending                                                                                                                                                                             |
| `dbing.py`     | `def`       | `clearDatabaserDir` |         252 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts`           | `clearDatabaserDir`       | `D1`  | `Partial` | Added helper + idempotency test in `test/unit/db/core/lmdber-helpers.test.ts`                                                                                                                                                   |
| `dbing.py`     | `def`       | `openLMDB`          |         261 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts`           | `openLMDB`                | `D1`  | `Partial` | Added parity alias to opened LMDBer factory; test in `test/unit/db/core/lmdber-helpers.test.ts`                                                                                                                                 |
| `dbing.py`     | `class`     | `LMDBer`            |         296 | `DB-CORE`   | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts`           | `LMDBer`                  | `D1`  | `Partial` | Core family surface now includes `On*`, `OnAll*`, `IoSet*`, `OnIoSet*`, `dup*`, `IoDup*`, and `OnIoDup*`; parity edge-cases still pending. Post `kli init/incept/rotate` usage review: confirm `cntTop`/`cntAll` keep-vs-remove |
| `subing.py`    | `class`     | `SuberBase`         |         109 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`                | `SuberBase`               | `D2`  | `Partial` | Thin KERIpy-style bootstrap wrapper landed; separator-aware keying and iteration are covered by `test/unit/db/subing.test.ts`, but most `subing.py` family semantics remain open                                                |
| `subing.py`    | `class`     | `Suber`             |         365 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`                | `Suber`                   | `D2`  | `Partial` | Put/pin/get/rem plus prefix iteration landed and now back current `Baser` / `Keeper` visibility stores; full parity validation pending                                                                                          |
| `subing.py`    | `class`     | `OnSuberBase`       |         460 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `OnSuberBase`             | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `OnSuber`           |         771 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `OnSuber`                 | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `B64SuberBase`      |         797 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `B64SuberBase`            | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `B64Suber`          |         923 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `B64Suber`                | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CesrSuberBase`     |         953 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `CesrSuberBase`           | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CesrSuber`         |        1020 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`                | `CesrSuber`               | `D2`  | `Partial` | Current implementation is a string pass-through seam used by `Keeper.pres` / `prxs` / `nxts`; true CESR-object parity and richer subclass behavior remain open                                                                  |
| `subing.py`    | `class`     | `CesrOnSuber`       |        1049 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `CesrOnSuber`             | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CatCesrSuberBase`  |        1076 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `CatCesrSuberBase`        | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CatCesrSuber`      |        1174 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `CatCesrSuber`            | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `IoSetSuber`        |        1212 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `IoSetSuber`              | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `B64IoSetSuber`     |        1559 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `B64IoSetSuber`           | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CesrIoSetSuber`    |        1587 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `CesrIoSetSuber`          | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CatCesrIoSetSuber` |        1638 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `CatCesrIoSetSuber`       | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `SignerSuber`       |        1693 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `SignerSuber`             | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CryptSignerSuber`  |        1781 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts`                | `CryptSignerSuber`        | `D2`  | `Partial` | Current implementation is a storage-contract seam for `Keeper.pris`; Gate D still needs real encrypt/decrypt semantics to reach parity                                                                                          |
| `subing.py`    | `class`     | `SerderSuberBase`   |        1916 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `SerderSuberBase`         | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `SerderSuber`       |        1967 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `SerderSuber`             | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `SerderIoSetSuber`  |        1991 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `SerderIoSetSuber`        | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `SchemerSuber`      |        2046 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `SchemerSuber`            | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `DupSuber`          |        2080 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `DupSuber`                | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CesrDupSuber`      |        2261 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `CesrDupSuber`            | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `CatCesrDupSuber`   |        2281 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `CatCesrDupSuber`         | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `IoDupSuber`        |        2315 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `IoDupSuber`              | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `B64IoDupSuber`     |        2554 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `B64IoDupSuber`           | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `OnIoDupSuber`      |        2584 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `OnIoDupSuber`            | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `B64OnIoDupSuber`   |        2951 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `B64OnIoDupSuber`         | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `OnIoSetSuber`      |        2987 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `OnIoSetSuber`            | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `subing.py`    | `class`     | `B64OnIoSetSuber`   |        3631 | `DB-SUBER`  | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts (planned)`      | `B64OnIoSetSuber`         | `D2`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `koming.py`    | `class`     | `KomerBase`         |          27 | `DB-KOMER`  | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts (planned)`      | `KomerBase`               | `D3`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `koming.py`    | `class`     | `Komer`             |         260 | `DB-KOMER`  | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts`                | `Komer`                   | `D3`  | `Partial` | Minimal JSON-backed object store landed and is now used for `Baser.habs` plus `Keeper.prms` / `sits` / `pubs`; iterator/query breadth and broader parity validation remain open                                                 |
| `koming.py`    | `class`     | `IoSetKomer`        |         396 | `DB-KOMER`  | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts (planned)`      | `IoSetKomer`              | `D3`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `koming.py`    | `class`     | `DupKomer`          |         632 | `DB-KOMER`  | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts (planned)`      | `DupKomer`                | `D3`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `komerdict`         |          62 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `komerdict`               | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `dbdict`            |          86 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `dbdict`                  | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `RawRecord`         |         144 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `RawRecord`               | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `StateEERecord`     |         185 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `StateEERecord`           | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `KeyStateRecord`    |         203 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `KeyStateRecord`          | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `EventSourceRecord` |         259 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `EventSourceRecord`       | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `HabitatRecord`     |         273 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `HabitatRecord`           | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `TopicsRecord`      |         297 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `TopicsRecord`            | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `OobiQueryRecord`   |         307 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `OobiQueryRecord`         | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `OobiRecord`        |         340 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `OobiRecord`              | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `EndpointRecord`    |         355 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `EndpointRecord`          | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `EndAuthRecord`     |         428 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `EndAuthRecord`           | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `LocationRecord`    |         451 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `LocationRecord`          | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `ObservedRecord`    |         506 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `ObservedRecord`          | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `WellKnownAuthN`    |         556 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/records.ts (planned)`     | `WellKnownAuthN`          | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `def`       | `openDB`            |         567 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                | `openDB`                  | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `def`       | `reopenDB`          |         577 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                | `reopenDB`                | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `basing.py`    | `class`     | `Baser`             |         603 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                | `Baser`                   | `D4`  | `Partial` | Bootstrap path now uses `Komer`/`Suber` for `habs`, `names`, and `hbys`, with compatibility-mode `.keri/db` support and `names.` `^` separator alignment; broad record/subdb parity remains open                                |
| `basing.py`    | `class`     | `BaserDoer`         |        2007 | `DB-BASER`  | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing-doer.ts (planned)` | `BaserDoer`               | `D4`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |
| `escrowing.py` | `class`     | `Broker`            |          22 | `DB-ESCROW` | `keripy/src/keri/db/escrowing.py` | `packages/keri/src/db/escrowing.ts (planned)`   | `Broker`                  | `D5`  | `Missing` | Top-level symbol inventory row                                                                                                                                                                                                  |

## D0 Snapshot

- Module symbols inventoried: **67**
- Current `Partial`: **19**
- Current `Missing`: **48**
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
   opens, matching KERIpy temp-db versioning intent.
3. `LMDBer` now includes the remaining core `dbing.py` method families needed
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

## D2/D3 Bootstrap Foundation Snapshot (2026-03-16)

1. `subing.ts` now carries the full planned `Suber` family surface used by the
   current parity push, with KERIpy method names as the primary API.
2. `koming.ts` is now a single-generic `Komer<T>` for one persisted value shape
   rather than a schema/codec abstraction.
3. `Baser` now uses typed record storage for habitats and a separate signature
   store:
   - `habs.` -> `Komer<HabitatRecord>`
   - `sigs.` -> `CesrIoSetSuber<Siger>`
   - `names.` -> `Suber` with KERIpy-aligned `^` separator
   - `hbys.` -> `Suber`
4. `Keeper` active bootstrap stores now open through the fuller typed wrappers:
   - `gbls.` -> `Suber`
   - `pris.` -> `CryptSignerSuber`
   - `pres.` -> `CesrSuber<Prefixer>`
   - `prxs.` / `nxts.` -> `CesrSuber<Cipher>`
   - `prms.` / `sits.` / `pubs.` -> `Komer`
5. Habitat metadata no longer persists inline `sigs`; indexed signatures are
   stored separately in `.sigs`, matching the KERIpy split more closely.
6. Evidence tests:
   - `test/unit/db/subing.test.ts`
   - `test/unit/db/koming.test.ts`
   - `test/unit/app/habbing.test.ts`

Note: the row-by-row inventory above predates this parity pass and still needs
an explicit matrix refresh.

## K/V Inventory Artifacts

- Full K/V matrix:
  - `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
- Gate A-G worklist (explicit gate mapping columns `gate` and `gate_rationale`):
  - `docs/plans/keri/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
- Gate H backlog:
  - `docs/plans/keri/DB_LAYER_KV_GATE_H_BACKLOG.csv`

## Next D0 Fill-In Tasks

1. Replace owner-lane placeholders with named assignees if desired.
2. Add `Tested` and evidence-link columns per symbol and promote statuses only
   with proof.
3. Validate and adjust explicit gate tags (`A`..`G`) as implementation behavior
   is proven.
4. Use `tufa db dump` snapshots and KERIpy cross-checks as evidence for each
   promoted row.
