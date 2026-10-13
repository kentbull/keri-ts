# DB Layer Parity Matrix (D0 audited)

## Purpose

D0 parity workbook for KERIpy DB-layer reconciliation against `keri-ts`. This
audited revision refreshes the symbol inventory, current KERIpy line references,
and per-row status values against the code actually present on 2026-04-03.

## Sources

- `keripy/src/keri/db/dbing.py`
- `keripy/src/keri/db/subing.py`
- `keripy/src/keri/db/koming.py`
- `keripy/src/keri/recording.py`
- `keripy/src/keri/db/basing.py`
- `keripy/src/keri/db/escrowing.py`
- `docs/reference/db/KV_INVENTORY.md`

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

- KERIpy line numbers were refreshed against the current local `keripy` checkout
  on 2026-04-03.
- Record-contract rows belong to `keripy/src/keri/recording.py`; the earlier
  matrix mapping them to `basing.py` was inaccurate.
- The inventory is parity-relevant, not a blind dump of every private helper,
  comment-block TODO, or compatibility alias in KERIpy.
- Status is intentionally conservative: existing code stays `Partial` unless the
  current evidence is strong enough to call the row parity-complete.

## Module Symbol Summary

| Module         | Classes | Top-Level Functions | Total Symbols |
| -------------- | ------: | ------------------: | ------------: |
| `dbing.py`     |       1 |                  13 |            14 |
| `subing.py`    |      30 |                   0 |            30 |
| `koming.py`    |       4 |                   0 |             4 |
| `recording.py` |      16 |                   0 |            16 |
| `basing.py`    |       3 |                   2 |             5 |
| `escrowing.py` |       1 |                   0 |             1 |

## Symbol rows

The [70-row CSV](DB_SYMBOL_PARITY_AUDIT_2026-04-03.csv) preserves every original
field, including reference lines, owners, target symbols, phase, status and notes.
This audit is dated 2026-04-03, not a frozen-927 requalification. The
[DB plan](../../plans/db/DB_PARITY_PLAN.md) owns remaining row promotion.

## D0 Snapshot

- Module symbols inventoried: **70**
- Current `Equivalent`: **1**
- Current `Partial`: **69**
- Current `Missing`: **0**
- K/V rows inventoried: **130**
- K/V Gate A-G worklist rows: **33**
  (`docs/reference/db/DB_LAYER_KV_GATE_AG_WORKLIST.csv`)
- K/V Gate H backlog rows: **97**
  (`docs/reference/db/DB_LAYER_KV_GATE_H_BACKLOG.csv`)

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

1. The row inventory now matches the actual current KERIpy locations and removes
   stale placeholder mappings such as `basing.py` -> record-contract rows.
2. All 30 inventoried `subing.py` classes now have concrete `subing.ts` targets;
   the previous wall of `Missing` rows was document drift, not code reality.
3. `koming.ts` now has `KomerBase`, `Komer`, `IoSetKomer`, and `DupKomer`; no
   inventoried `koming.py` row is currently `Missing`.
4. `basing.ts` now binds the broad named-subdb surface, and KERIpy's `statedict`
   read-through behavior is approximated by explicit `reloadKevers()` /
   `getKever()` helpers rather than a Python dict subclass.
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
  - `docs/reference/db/DB_LAYER_KV_PARITY_MATRIX.csv`
- Gate A-G worklist (explicit gate mapping columns `gate` and `gate_rationale`):
  - `docs/reference/db/DB_LAYER_KV_GATE_AG_WORKLIST.csv`
- Gate H backlog:
  - `docs/reference/db/DB_LAYER_KV_GATE_H_BACKLOG.csv`
