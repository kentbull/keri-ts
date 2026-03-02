# DB Layer Parity Matrix Skeleton (D0)

## Purpose

Initial D0 parity workbook for KERIpy DB layer reconciliation against `keri-ts`.
This file tracks module-level function/class parity and links to the K/V matrix
seeded from `docs/design-docs/db/lmdb-dumper.md`.

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

## Module Symbol Summary

| Module         | Classes | Top-Level Functions | Total Symbols |
|----------------|--------:|--------------------:|--------------:|
| `dbing.py`     |       1 |                  12 |            13 |
| `subing.py`    |      30 |                   0 |            30 |
| `koming.py`    |       4 |                   0 |             4 |
| `basing.py`    |      17 |                   2 |            19 |
| `escrowing.py` |       1 |                   0 |             1 |

## Module Symbol Parity Matrix

| Module         | Symbol Type | Symbol              | KERIpy Line | KERIpy Path                       | Proposed `keri-ts` Target                                                   | Phase | Status    | Notes                                                   |
|----------------|-------------|---------------------|------------:|-----------------------------------|-----------------------------------------------------------------------------|-------|-----------|---------------------------------------------------------|
| `dbing.py`     | `def`       | `onKey`             |          71 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `snKey`             |          88 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `fnKey`             |         102 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `dgKey`             |         116 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `dtKey`             |         129 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `splitKey`          |         146 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `splitOnKey`        |         171 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Missing` | Top-level symbol inventory row                          |
| `dbing.py`     | `def`       | `splitKeyDT`        |         192 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `suffix`            |         208 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `unsuffix`          |         229 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `dbing.py`     | `def`       | `clearDatabaserDir` |         252 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Missing` | Top-level symbol inventory row                          |
| `dbing.py`     | `def`       | `openLMDB`          |         261 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Missing` | Top-level symbol inventory row                          |
| `dbing.py`     | `class`     | `LMDBer`            |         296 | `keripy/src/keri/db/dbing.py`     | `packages/keri/src/db/core/lmdber.ts` + `packages/keri/src/db/core/keys.ts` | `D1`  | `Partial` | Exists in current TS surface; parity validation pending |
| `subing.py`    | `class`     | `SuberBase`         |         109 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `Suber`             |         365 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `OnSuberBase`       |         460 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `OnSuber`           |         771 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `B64SuberBase`      |         797 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `B64Suber`          |         923 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CesrSuberBase`     |         953 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CesrSuber`         |        1020 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CesrOnSuber`       |        1049 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CatCesrSuberBase`  |        1076 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CatCesrSuber`      |        1174 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `IoSetSuber`        |        1212 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `B64IoSetSuber`     |        1559 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CesrIoSetSuber`    |        1587 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CatCesrIoSetSuber` |        1638 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `SignerSuber`       |        1693 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CryptSignerSuber`  |        1781 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `SerderSuberBase`   |        1916 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `SerderSuber`       |        1967 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `SerderIoSetSuber`  |        1991 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `SchemerSuber`      |        2046 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `DupSuber`          |        2080 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CesrDupSuber`      |        2261 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `CatCesrDupSuber`   |        2281 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `IoDupSuber`        |        2315 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `B64IoDupSuber`     |        2554 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `OnIoDupSuber`      |        2584 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `B64OnIoDupSuber`   |        2951 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `OnIoSetSuber`      |        2987 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `subing.py`    | `class`     | `B64OnIoSetSuber`   |        3631 | `keripy/src/keri/db/subing.py`    | `packages/keri/src/db/subing.ts` (planned)                                  | `D2`  | `Missing` | Top-level symbol inventory row                          |
| `koming.py`    | `class`     | `KomerBase`         |          27 | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts` (planned)                                  | `D3`  | `Missing` | Top-level symbol inventory row                          |
| `koming.py`    | `class`     | `Komer`             |         260 | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts` (planned)                                  | `D3`  | `Missing` | Top-level symbol inventory row                          |
| `koming.py`    | `class`     | `IoSetKomer`        |         396 | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts` (planned)                                  | `D3`  | `Missing` | Top-level symbol inventory row                          |
| `koming.py`    | `class`     | `DupKomer`          |         632 | `keripy/src/keri/db/koming.py`    | `packages/keri/src/db/koming.ts` (planned)                                  | `D3`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `komerdict`         |          62 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `dbdict`            |          86 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `RawRecord`         |         144 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `StateEERecord`     |         185 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `KeyStateRecord`    |         203 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `EventSourceRecord` |         259 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `HabitatRecord`     |         273 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `TopicsRecord`      |         297 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `OobiQueryRecord`   |         307 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `OobiRecord`        |         340 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `EndpointRecord`    |         355 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `EndAuthRecord`     |         428 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `LocationRecord`    |         451 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `ObservedRecord`    |         506 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `WellKnownAuthN`    |         556 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `def`       | `openDB`            |         567 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `def`       | `reopenDB`          |         577 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `basing.py`    | `class`     | `Baser`             |         603 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Partial` | Exists, currently minimal/raw-LMDB oriented             |
| `basing.py`    | `class`     | `BaserDoer`         |        2007 | `keripy/src/keri/db/basing.py`    | `packages/keri/src/db/basing.ts`                                            | `D4`  | `Missing` | Top-level symbol inventory row                          |
| `escrowing.py` | `class`     | `Broker`            |          22 | `keripy/src/keri/db/escrowing.py` | `packages/keri/src/db/escrowing.ts` (planned)                               | `D5`  | `Missing` | Top-level symbol inventory row                          |

## K/V Inventory Matrix (CSV)

- Full K/V skeleton:
  - `docs/plans/keri/DB_LAYER_KV_PARITY_MATRIX.csv`
- Source basis:
  - `docs/design-docs/db/lmdb-dumper.md`

## K/V Inventory Summary

| Domain      | K/V Rows |
|-------------|---------:|
| `Baser`     |       80 |
| `Reger`     |       35 |
| `Keeper`    |       10 |
| `Noter`     |        3 |
| `Mailboxer` |        2 |

Total K/V rows seeded: **130**.

## Next D0 Fill-In Tasks

1. Assign owner and target TS symbol for each module symbol row.
2. Validate `Partial` rows against KERIpy behavior and mark true parity only as `Equivalent`.
3. Split K/V CSV into gate-focused views (Gate A-G now, Gate H closure backlog).
4. Add evidence links (`tufa db dump` snapshots and interop test cases) per key domain.
