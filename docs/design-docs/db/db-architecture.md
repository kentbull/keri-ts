# KERI DB Architecture and Parity Contract (KERIpy -> keri-ts)

`LMDBer` pins lmdb-js 3.5.3. The compatibility rebuild retains
`LMDB_DATA_V1=true` and uses the official `ENABLE_V8_FUNCTIONS=false` option. Node-header V8 symbols are
not portable to Deno: the V8 mapped-buffer path for rows above 16 MiB can terminate
the process despite successful small reads. Deno must load the rebuilt NAPI addon; native Node may use the pinned official
V8 build only when its compiled Node major matches the actual runtime. This changes native call selection, not database
layout or the addon ABI. Ordinary reads still copy whole rows; fixed shared
scratch, mapped residency and admission before row allocation remain separate
[storage work](../../plans/db/STORAGE_RECOVERY_PLAN.md).

`LMDBer.getValBounded` (also exposed by Baser) admits one row byte extent before
owned copies using a per-call prototype; it never changes the shared DB object
or global read buffer. Its explicit `npm:lmdb@3.5.3` pin, native metadata,
compression/version modes, hook shapes and environment ownership are checked
before reading. A V8 build requires actual Node >=20, matching compiled/runtime
major and active LMDB V8 acceleration; Deno/Bun and mismatched metadata fail closed.
The NAPI build has no `nodeCompiledVersion`. V8 preflight may create an LMDB mapped
view before admission; it does not copy the row's backing bytes. The admitted
`getBinary` read owns its copy. Mapped residency/view metadata and fixed native
scratch remain outside the caller's row-copy reservation. Two reads share an active
writer or one acquired read transaction, released on refusal/failure. Upgrade
qualification must inspect `read.js#getBinaryFast/_returnLargeBuffer` and native
`dbi.cpp#doGetByBinary`/`misc.cpp#valToBinaryFast`; generic hook presence alone is
not proof for a future package. Existing unbounded read APIs remain unchanged.

## Purpose

This document is the DB architecture contract for `keri-ts` parity work against
KERIpy.

It captures:

1. The layered DB model used by KERIpy.
2. The equivalent target model in `keri-ts`.
3. Where behavior differs today.
4. The invariants we must preserve as features are implemented.

## Keyspace model

Effective keys are caller-visible; physical keys may include insertion-order
suffixes or proems. Dup sorts duplicate values lexically, IoDup encodes insertion
order in compact values, and IoSet encodes it in synthetic keys. See the
[keyspace examples and family guide](../../reference/db/KEYSPACE_AND_FAMILIES.md)
for worked records and 2D ordinal/set rationale.

## Scope

In scope:

1. KERIpy DB architecture in `dbing.py`/`subing.py`/`koming.py`/`basing.py`.
2. `keri-ts` DB architecture targets and parity constraints.
3. Duplicate/index models (`dupsort`, `Dup*`, `IoDup*`, `IoSet*`, `On*`).
4. Serialization model boundaries (`Cesr*`, `CatCesr*`, `B64*`, `Komer`).
5. DB invariants contract and test obligations.

Out of scope:

1. Provider abstraction implementation details (post LMDB parity phase).
2. Full per-symbol backlog status (tracked in DB parity plans/matrices).

## Reference Priority

When deciding behavior, use this priority order:

1. KERIpy observed behavior and source semantics (gold standard for parity).
2. This architecture contract.
3. DB reconciliation plan/matrix artifacts for scheduling and status.

Primary source files:

1. `keripy/src/keri/db/dbing.py`
2. `keripy/src/keri/db/subing.py`
3. `keripy/src/keri/db/koming.py`
4. `keripy/src/keri/db/basing.py`
5. `keripy/src/keri/db/escrowing.py`

## Architecture Layers

### Layer 0: LMDB Core Primitives

KERIpy:

1. `LMDBer` in `dbing.py` wraps env lifecycle, key helpers, top-branch
   iteration/delete/count, duplicate-set primitives, and ordered duplicate
   helpers.

`keri-ts` target:

1. `LMDBer` in `packages/keri/src/db/core/lmdber.ts` must provide behavioral
   parity for core operations used by higher abstractions.

### Layer 1: Keyspace and Value-Shape Adapters (Suber/Komer Families)

KERIpy:

1. `Suber*` families model CESR and index-heavy storage patterns.
2. `Komer*` families model dataclass/object mappings.
3. Multiple inheritance composes keyspace behaviors (`On*`, `Io*`, `Dup*`) with
   value-shape behaviors (`Cesr*`, `CatCesr*`, `B64*`, `Serder*`).

`keri-ts` target:

1. Provide equivalent behavior even if TypeScript composition differs from
   Python MRO mechanics.
2. Preserve externally-observable storage and retrieval semantics.

### `Komer` Public Mental Model

1. `Komer` is the object-mapper family for one persisted record class.
2. The public constructor seam is `recordClass`, which supplies the
   record-family rebuild logic through `RawRecord.fromDict(...)` and the stored
   projection through `RawRecord.asDict()`.
3. Callers should reason in one generic dimension: the hydrated record class.
4. Plain-object writes are still acceptable, but only as constructor-input
   convenience derived from that same record class. This is mapper-boundary
   ergonomics, not a second public type axis.
5. Public `hydrate` / `normalize` hooks and dual generic APIs such as `T` +
   `TInput` are migration leakage. They describe transitional TS wiring, not the
   durable DB-layer abstraction.
6. Future non-LMDB backends should preserve this record-class-centric contract
   so higher layers keep one mental model regardless of the underlying key/value
   provider.

### Layer 2: Domain Databasers

KERIpy:

1. `Baser`, `Keeper`, `Reger`, `Mailboxer`, `Noter` wire named sub-databases to
   concrete operational domains.

`keri-ts` target:

1. Domain databasers should depend on stabilized Layer 0/1 semantics and avoid
   custom one-off raw LMDB logic where a parity abstraction exists.
2. Local habitat/runtime state should be DB-derived at this layer: `Habery`
   caches `Hab` objects in memory, but current identifier state belongs in
   `Baser` stores such as `states.`, `kels.`, `fels.`, and related event
   indices, not in process-local app state alone.

## Core Storage Models

### `dupsort=True` Model (LMDB Native Duplicates)

Definition:

1. One key can hold multiple distinct values.
2. Duplicate values are sorted lexicographically per key.
3. This is native LMDB duplicate support, not synthetic key rewriting.

KERIpy usage:

1. `DupSuber`: duplicate set with lexicographic ordering.
2. `IoDupSuber`: insertion-ordered duplicate set via hidden value proem.
3. `OnIoDupSuber`: exposed ordinal tail in key + insertion-ordered duplicates.

### `dupsort=False` Synthetic-Set Model

Definition:

1. Multiplicity is represented by creating unique physical keys via hidden
   suffixing, while exposing a logical key-level set abstraction.
2. This is application-level keyspace virtualization, not native LMDB
   duplicates.

KERIpy usage:

1. `IoSetSuber`: insertion-ordered set without native dupsort duplicates.
2. `OnIoSetSuber`: exposed ordinal tail + hidden insertion-order suffix.

## Serialization Families and Intent

1. `Cesr*`: CESR primitive object serialization/deserialization.
2. `CatCesr*`: concatenated CESR primitive tuple payloads in one stored value.
3. `B64*`: qb64-focused tuple/value handling for identifier/index-heavy paths
   when full object rehydration is unnecessary.
4. `Komer`: key-to-structured-object mappings for non-CESR dataclass-like
   records.

Design intent:

1. If payload is CESR primitive domain data, use Suber-family semantics.
2. If payload is structured non-CESR record data, use Komer-family semantics.

Opaque wire values need a byte-preserving adapter: `BytesSuber` for single
values and `BytesIoSetSuber` for insertion-ordered sets. `Baser.ptds` uses the
latter for pathed evidence keyed by `(AID, MID)` in the existing `ptds.` table.
Distinct binary inputs such as `0xff` and `0xfe` must survive without UTF-8
replacement, retaining insertion order and deduplicating only exact bytes.
This honors frozen KERIpy `927c0cb8`'s documented raw-byte table contract while
correcting its inherited text-decoding read path. A byte-oriented type does not
establish zero-copy LMDB access; see the
[byte ownership reference](../../reference/db/MEMORYVIEW_UINT8ARRAY.md).

`db/kram-factors.ts` stages and rehydrates partial evidence keyed by `(AID, MID)`.
Callers authenticate and stage the sender body, `pmks` pool and `pmsk` seal; foreign
proofs remain independent. Call `storeKramFactors` and `validateKramFactors` inside
the same transaction before commit so `ResourceLimitError` rolls back the union.
Rehydration merges exact qualified members with shared 4096-item/8 MiB credits.
Known foreign last groups freeze receipt-time coordinates; `ulgs.` retains unknown
prefixes without old signatures, and `cigs.` retains foreign cigar verifier context.
`unresolvedLast` remains missing evidence for Exchanger even after KEL recovery.
`removeKramFactors` removes body, sender pool/seal and factors only. Nested/ESSR
snapshots, cache transitions, authentication and complete handoff remain later units.
Blind/bound/media `d` fields reopen as `Noncer`, matching their current typed
record domain (including nonce/empty/digest encodings). This deliberately corrects
frozen KERIpy's narrower `Diger` constructors without changing qualified row bytes.
Sender seal couples/triples remain authentication inputs and are excluded from
factor staging, as in frozen `_storeNonAuthData`.
These finite limits do not bound whole-row LMDB allocation or the shared runtime.

`db/kram-snapshots.ts` serializes bounded whole-tree wire while borrowing incoming
owners; `storeKramSnapshot` stages raw `kpnd.` bytes in the caller's transaction.
Missing replacement wire preserves an existing snapshot. Consume-scoped `withKramHydration`
composes scalar factors with matching-body child/ESSR hydration, preferring fresh
borrowed owners. It never reconstructs parent signature groups from saved wire.
Its callback cannot retain reopened owners. Direct `finally` propagates disposal
failures before returning. Cancellation joins reads/writes before disposal; downstream failure and
corrupt-row failure release every temporary reopened owner. Ordinary metadata,
nodes, ESSR bytes/items and the 24 MiB wire copy all retain finite limits.
Invalid ESSR size/count declarations are `RangeError` contract failures; valid
extents over configured ceilings are `ResourceLimitError`.
Private snapshots do not accept parent/child messages or replace public `enst.`
publication. `removeKramSnapshot` removes only private wire; full pending cleanup
must compose it with factor and later handoff owners.

## Key Ordering Conventions

1. Use fixed-width hex ordinals where lexicographic order must match numeric
   order (`onKey`, `snh`-style conventions).
2. Avoid variable-width encodings for ordinal key segments when order semantics
   are relied on by replay/escrow logic.
3. Treat key-order semantics as protocol behavior, not implementation detail.
   This is critically important since KERI and ACDC data structures depend on
   insertion ordering for consistent self addressing identifier (SAID) and
   digest computation.

## KERIpy vs `keri-ts`: Current Architectural Differences

### API Shape

1. KERIpy LMDB Python API uses explicit cursor objects (`txn.cursor()` loops).
2. `keri-ts` uses `lmdb-js` range iterables (`getRange`, `getValues`, `getKeys`)
   that are cursor-backed but API-distinct.
3. Required parity is behavior-level, not cursor-method-level.

### Composition Model

1. KERIpy relies heavily on Python MRO/multiple inheritance in `subing.py`.
2. `keri-ts` should use TypeScript composition/inheritance patterns that keep
   semantics explicit and testable.

### Storage Path Defaults

1. KERIpy defaults to `.keri` path conventions.
2. `keri-ts` defaults to `.tufa` with explicit compatibility mode for `.keri`.
3. Path-mode differences are acceptable only when compatibility mode preserves
   behavior expectations.

### `dupsort` Practical Constraints

1. KERIpy architecture treats dupsort-backed values as compact/index-oriented.
2. `keri-ts` must preserve this design intent even if backend bindings are more
   permissive in some environments.

## DB Invariants Contract (Normative)

These invariants are mandatory for parity-compatible DB behavior in `keri-ts`.

### A. Ordering Invariants

1. `Dup*` retrieval order is lexicographic duplicate order per key.
2. `IoDup*` retrieval order is insertion order per key.
3. `On*` families preserve numeric ordering of exposed ordinals through
   lexicographically sortable key encoding.
4. Iteration by key prefix must terminate exactly at branch boundary.

### B. Set and Idempotence Invariants

1. Duplicate-set operations are idempotent: writing an existing `(key,value)`
   does not create another logical member.
2. `add*` methods must report whether a write actually occurred.
3. `pin`/overwrite paths replace according to family semantics without producing
   duplicate logical members.

### C. Serialization Invariants

1. `Cesr*` paths round-trip CESR payloads without semantic mutation.
2. `CatCesr*` paths preserve tuple arity and slot order across round-trip.
3. `B64*` paths preserve delimiter/field semantics and reject invalid
   separator-containing value components where required by design.
4. `Komer` paths round-trip structured object records without keyspace drift.
5. Event-seal discovery selects full tuples from raw accepted KEL `a` entries;
   other data shapes are skipped without forcing strict Serder projection.

### D. Keyspace Invariants

1. Hidden suffix/proem machinery in `Io*` families is transparent to callers and
   never leaked as user-facing value content.
2. Synthetic-key strategies in `IoSet*` remain stable across process restarts.
3. Key helper functions (`onKey`, `splitOnKey`, etc.) remain deterministic and
   parity-compatible with KERIpy formatting.

### E. Lifecycle Invariants

LMDB V1 permits one environment handle per database path in a process. A second
read-only Habery does not provide isolation: concurrent handles can invalidate
reader slots (`MDB_BAD_RSLOT`, sometimes surfaced as `Invalid argument`). Reuse
the owning Habery or inspect a live host from a separate process. The live-agent
mailbox test uses the actual CLI child and retains HTTP and stored endpoint-role
assertions while that host remains running. This test correction adds no shared
handle pool or runtime admission guarantee; handle accounting remains in the
progressive storage/resource follow-ons.

1. DB open/close/reopen flows are safe and idempotent.
   `createBaser` and `createKeeper` retain ownership until
   returning the opened store; failed or cancelled acquisition closes the
   unreturned handle without clearing durable data. `createHabery` similarly
   closes already-acquired owned resources if later setup fails. Supplied
   configuration remains caller-owned on failure; successful Habery ownership
   and explicit close behavior remain unchanged.
2. Version metadata behavior on new/temp writeable stores matches parity policy.
3. No command-level feature may bypass required DB-layer behavior with hidden
   in-memory substitutions in parity-gated flows.

### F. Interop Invariants

1. Behavior must be validated against KERIpy for representative vectors.
2. Gate A-G and Gate H parity evidence must map to concrete DB behaviors, not
   only CLI smoke outputs.

## Implementation Policy for `keri-ts`

1. Parity-first: complete LMDB parity behavior before provider abstraction
   implementation.
2. Abstraction correctness over convenience: do not collapse distinct families
   (`IoDup` vs `IoSet`) if semantics differ.
3. Backend API translation: when using `lmdb-js` range APIs, preserve KERIpy
   cursor behavior contracts by explicit boundary conditions and mutation
   discipline.
4. Performance decisions: optimize only after parity tests prove no behavioral
   regressions.

## Decision Matrix for New DB Mappings

Use this sequence when adding or revising a DB mapping:

1. Is this primarily an index mapping with compact values?
   - Prefer `Dup*` or `IoDup*`.
2. Is insertion order required?
   - Prefer `IoDup*` for compact/index style, `IoSet*` when payload flexibility
     is needed.
3. Is payload purely qb64 identifier material?
   - Prefer `B64*` variants.
4. Is payload CESR primitive tuple material?
   - Use `CatCesr*` only when tuple semantics are required.
5. Is payload non-CESR structured object state?
   - Use `Komer` mappings.

## Verification Expectations

Every DB feature promotion from `Missing`/`Partial` to parity-validated should
include:

1. unit tests for invariants affected by the change,
2. integration evidence for workflow impact where relevant,
3. KERIpy cross-check vectors for ordering/idempotence/shape behaviors.

## Alignment with Active Plans

This architecture contract is normative for:

1. `docs/plans/db/DB_PARITY_PLAN.md`
2. `docs/reference/db/DB_PARITY_AUDIT_2026-04-03.md`
3. Gate A-G and Gate H DB parity closure artifacts.

## Document Maintenance Rule

When DB-level behavior decisions are made in either KERIpy analysis or `keri-ts`
implementation:

1. update this document with concise architectural rationale,
2. record the decision delta in relevant learnings docs,
3. attach test evidence references where available.
