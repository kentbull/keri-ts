# KERI DB Architecture and Parity Contract (KERIpy -> keri-ts)

## Purpose

This document is the DB architecture contract for `keri-ts` parity work against
KERIpy.

It captures:

1. The layered DB model used by KERIpy.
2. The equivalent target model in `keri-ts`.
3. Where behavior differs today.
4. The invariants we must preserve as features are implemented.

## Core ideas

### Effective keys versus Physical keys

KERIpy and keri-ts use two distinct multiplicity models on top of LMDB.

1. In `dupsort=True` families, LMDB natively stores multiple values under one
   physical key.
2. In `dupsort=False` synthetic-set families, the application virtualizes
   multiplicity by creating multiple physical keys for one logical effective
   key.

Effective keys are what the caller means to store under a logical key. Physical
keys are what actually get written to the database. This distinction matters
because some families express multiplicity in native LMDB duplicate values,
while others express multiplicity by rewriting keys.

### Illustrative Dup Example (`dupsort=True`)

`Dup*` methods use native LMDB duplicate support. This is not keyspace
virtualization.

1. Caller provides one physical/logical key: `alpha`.
2. DB stores multiple values directly under that same key:
   - `alpha -> v1`
   - `alpha -> v2`
   - `alpha -> v3`
3. LMDB sorts those duplicate values lexicographically by their stored value
   bytes.

Common usage/access patterns:

1. Write duplicate members:
   - `putVals(db, key, vals)` stores unique values at the same key.
2. Read all duplicate members for one key:
   - `getVals(db, key)` or `getValsIter(db, key)` returns the duplicate values
     in LMDB duplicate-sort order.
3. Read the last duplicate member for one key:
   - `getValLast(db, key)` returns the lexicographically greatest stored
     duplicate value for that key.

### Illustrative IoDup Example (`dupsort=True`)

`IoDup*` methods still use native LMDB duplicate support, but they hide a
fixed-width insertion ordinal inside each stored value so LMDB duplicate-sort
order becomes insertion order.

1. Caller provides one physical/logical key: `alpha`.
2. DB stores duplicate values under that same key with a hidden value proem:
   - `alpha -> 00000000000000000000000000000000.v1`
   - `alpha -> 00000000000000000000000000000001.v2`
   - `alpha -> 00000000000000000000000000000002.v3`
3. LMDB still sorts duplicates lexicographically by stored value bytes.
4. Because the hidden proem is fixed-width and increasing, LMDB duplicate-sort
   order now matches insertion order for the logical values.

#### Illustrative IoSet Example (`dupsort=False`)

Both KERIpy `LMDBer` and `keri-ts` `LMDBer` use the same logical model for
`IoSet*` methods:

1. Caller provides an **effective key** (logical): `alpha`.
2. DB stores each member under a unique **physical key**:
   - `alpha.00000000000000000000000000000000 -> v1`
   - `alpha.00000000000000000000000000000001 -> v2`
   - `alpha.00000000000000000000000000000002 -> v3`
3. Distinct effective keys are computed by stripping the trailing ordinal suffix
   from physical keys (`unsuffix` behavior).

This is application-level keyspace virtualization, not native LMDB duplicate
support. The caller sees one logical key, but the DB actually contains multiple
physical keys.

Common usage/access patterns:

1. Write set members:
   - `putIoSetVals(db, key, vals)` appends new members at next ordinal suffix.
2. Read all members for one effective key:
   - `getIoSetItemIter(db, key)` yields `(effective_key, value)` pairs with
     suffix hidden from caller.
3. Read last member for one effective key:
   - `getIoSetLastItem(db, key)` returns one `(effective_key, value)` pair.
4. Read last member for each effective key in a branch:
   - `getIoSetLastItemIterAll(db, key=b"")` yields one last pair per effective
     key group.
5. Remove one logical member:
   - `remIoSetVal(db, key, val)` finds the matching physical key
     (`key + sep + ordinal`) and deletes it.
6. Remove all logical members for one effective key:
   - `remIoSet(db, key)` deletes the full physical-key run for that key.

## Why This Matters Across Topics

KEL, ACDC, and witness/watcher/observer flows all depend on DB-level ordering,
idempotence, and index semantics.

Incorrect DB semantics can silently corrupt:

1. event ordering and escrow processing,
2. credential and exchange indexing,
3. mailbox/topic and transport state resolution.

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

### Layer 2: Domain Databasers

KERIpy:

1. `Baser`, `Keeper`, `Reger`, `Mailboxer`, `Noter` wire named sub-databases to
   concrete operational domains.

`keri-ts` target:

1. Domain databasers should depend on stabilized Layer 0/1 semantics and avoid
   custom one-off raw LMDB logic where a parity abstraction exists.

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

## Maintainer Mental Model For `LMDBer` Function Families

This section is the quickest way to reason about the `LMDBer` API surface
without reading it as a flat list of methods.

Most `LMDBer` methods are one of a small number of storage families. When
maintaining or testing a method, answer these four questions first:

1. Where is multiplicity represented: nowhere, native dupsort values, or
   synthetic key suffixes?
2. Where does ordering come from: plain (lexicographic) key order, duplicate-value sort order,
   exposed ordinal encoding in the key, or hidden ordering bytes in the value?
3. Is the ordinal exposed to the caller or hidden by the abstraction?
4. Is the hidden machinery stored in keys or in values?

### Family Cheat Sheet

1. `Plain`
   - Mental model: one physical key maps to one value.
   - Multiplicity: none.
   - Ordering source: plain LMDB key order.
   - Representative methods: `putVal`, `setVal`, `getVal`, `delVal`, `cnt`.
2. `Top`
   - Mental model: branch/prefix traversal over ordinary keys.
   - Multiplicity: whatever the underlying DB already has.
   - Ordering source: lexicographic key-prefix scan.
   - Representative methods: `cntTop`, `getTopItemIter`, `delTop`.
3. `On*`
   - Mental model: one logical key has many values because the ordinal is part
     of the physical key.
   - Physical form: `key.<32-hex-on> -> val`
   - Multiplicity: synthetic, in keyspace.
   - Ordering source: fixed-width ordinal encoding in the key, so lexicographic
     order equals numeric order.
   - Ordinal visibility: exposed to callers.
   - Representative methods: `putOnVal`, `pinOnVal`, `appendOnVal`, `getOnVal`,
     `getOnItem`, `remOn`, `remOnAll`, `cntOnAll`, `getOnAllItemIter`.
4. `Dup*`
   - Mental model: one physical key owns a sorted set of values using LMDB
     native dupsort support.
   - Physical form: `key -> {val1, val2, val3}`
   - Multiplicity: native LMDB duplicate values.
   - Ordering source: LMDB duplicate-value sort order, lexicographic by stored
     value bytes.
   - Ordinal visibility: none.
   - Representative methods: `putVals`, `addVal`, `getVals`, `getValsIter`,
     `getValLast`, `cntVals`, `delVals`.
5. `IoDup*`
   - Mental model: still native dupsort, but stored values are prefixed with a
     hidden fixed-width ordinal proem so duplicate sort order becomes insertion
     order.
   - Physical form: `key -> {"000...000.val1", "000...001.val2", ...}`
   - Multiplicity: native LMDB duplicate values.
   - Ordering source: LMDB duplicate-value sort order over hidden proem-prefixed
     values.
   - Ordinal visibility: hidden from callers.
   - Hidden machinery location: value bytes.
   - Representative methods: `putIoDupVals`, `addIoDupVal`, `getIoDupVals`,
     `getIoDupValsIter`, `getIoDupValLast`, `delIoDupVals`, `delIoDupVal`,
     `cntIoDups`.
6. `IoSet*`
   - Mental model: duplicate-like behavior without dupsort by creating many
     physical keys for one logical key.
   - Physical form: `key.<32-hex-ion> -> val`
   - Multiplicity: synthetic, in keyspace.
   - Ordering source: hidden insertion ordinal suffix in the key.
   - Ordinal visibility: hidden from callers.
   - Hidden machinery location: key bytes.
   - Representative methods: `putIoSetVals`, `pinIoSetVals`, `addIoSetVal`,
     `getIoSetItemIter`, `getIoSetLastItem`, `remIoSet`, `remIoSetVal`,
     `cntIoSet`, `getIoSetLastItemIterAll`.
7. `OnIoSet*`
   - Mental model: two-dimensional synthetic keyspace. The caller sees an
     exposed ordinal, and each ordinal group then contains a hidden
     insertion-ordered set.
   - Physical form: `key.<on>.<ion> -> val`
   - Multiplicity: synthetic, in keyspace.
   - Ordering source: key order first by exposed ordinal, then by hidden
     insertion ordinal.
   - Ordinal visibility: exposed `on`, hidden `ion`.
   - Hidden machinery location: key bytes.
   - Representative methods: `putOnIoSetVals`, `pinOnIoSetVals`,
     `appendOnIoSetVals`, `addOnIoSetVal`, `getOnIoSetItemIter`,
     `getOnIoSetLastItem`, `remOnAllIoSet`, `cntOnAllIoSet`,
     `getOnAllIoSetLastItemIter`, `getOnAllIoSetItemBackIter`.
8. `OnIoDup*`
   - Mental model: exposed ordinal in the key, plus native dupsort duplicates
     under each ordinal whose stored values are proem-prefixed for insertion
     order.
   - Physical form: `key.<on> -> {"000...000.val1", "000...001.val2"}`
   - Multiplicity: native LMDB duplicate values within each exposed ordinal.
   - Ordering source: key order across ordinals, duplicate-value order within
     each ordinal, with the hidden proem making that inner order insertion
     order.
   - Ordinal visibility: exposed `on`, hidden duplicate insertion ordinal.
   - Hidden machinery location: value bytes.
   - Representative methods: `putOnIoDupVals`, `addOnIoDupVal`,
     `appendOnIoDupVal`, `getOnIoDupVals`, `getOnIoDupLast`,
     `getOnIoDupLastItemIter`, `delOnIoDups`, `delOnIoDupVal`, `cntOnIoDups`,
     `getOnIoDupItemIterAll`, `getOnIoDupItemBackIter`.

### Maintainer Rules Of Thumb

1. `Dup*` and `IoDup*` both use native LMDB duplicate values. The difference is
   ordering semantics, not storage capability.
2. `IoSet*` and `OnIoSet*` emulate duplicate-like behavior in keyspace because
   they do not rely on native dupsort duplicates.
3. If a method name starts with `On`, expect an exposed ordinal in the logical
   caller contract.
4. If a method name starts with `Io`, expect insertion-order semantics driven by
   hidden suffix/proem machinery.
5. For `Dup*`, "last" means lexicographically greatest stored duplicate value.
6. For `IoDup*`, "last" means greatest hidden proem, which is also the most
   recently inserted logical value.
7. For `IoSet*`, "last" means the member stored under the greatest hidden key
   suffix for that logical key, not the lexicographically greatest value bytes.

## Design Rationale: Why The 2D Keyspace Exists

The `OnIoSet*` and `OnIoDup*` families can look like overengineering if read as
isolated method names. The clearer mental model is that they represent a
two-dimensional storage shape that recurs naturally in KERI:

1. one exposed ordered dimension for "which ordinal bucket is this?"
2. one hidden insertion-ordered dimension for "which member inside that bucket
   is this?"

In shorthand:

1. `On` means ordered rows.
2. `Io` means insertion-ordered members.
3. `OnIo*` means ordered rows where each row can itself contain multiple
   insertion-ordered members.

### Why This Is Not Just Cleverness

At first glance, a two-dimensional synthetic keyspace can feel like a lot of
machinery for maintainers to carry. That reaction is understandable. The key
question is whether the complexity is accidental or whether it is paying for a
real recurring pattern in upper-layer behavior.

In KERI-style data flows, the recurring pattern is:

1. values are processed in a stable ordinal sequence,
2. a given ordinal may have multiple associated values,
3. those associated values must preserve deterministic order,
4. callers often need forward scans, backward scans, per-ordinal grouping, and
   delete-from-here-forward behavior.

That is not a niche edge case. It is a general shape that appears in monotonic
by nature key event log creation and storage, CESR message streaming for 
event/attachment processing, escrow-style staging, receipt/signature material,
and other one-to-many indexed DB paths.

The design choice here is to pay that complexity once in the DB layer instead of
forcing each higher-level caller to reinvent:

1. composite key construction,
2. insertion-order tracking,
3. "last per ordinal" grouping,
4. reverse scans,
5. delete-from-ordinal-forward behavior,
6. idempotent add/replace semantics for multi-member buckets.

From that perspective, the design is not "make every case fancy." It is
"recognize a repeating pattern and encode it once at the lowest reusable layer."

### The Core 2D Table Mental Model

Think of `OnIo*` families as a table:

1. row = exposed ordinal `on`
2. column = insertion position within that ordinal

The caller addresses rows. The DB layer manages columns.

Examples:

1. `On*`
   - one ordered row dimension only
   - physical idea: `key.<on> -> val`
2. `OnIoSet*`
   - ordered rows with multiple members per row, implemented in keyspace
   - physical idea: `key.<on>.<ion> -> val`
3. `OnIoDup*`
   - ordered rows with multiple members per row, implemented with native dupsort
   - physical idea: `key.<on> -> {"000...000.val1", "000...001.val2"}`

What this buys is not just storage. It buys a consistent set of operations over
that 2D shape:

1. append the next row,
2. add another member to an existing row,
3. iterate all rows from ordinal `N` onward,
4. iterate members inside each row in deterministic order,
5. get the last member per row,
6. walk rows backward from newest to oldest,
7. delete all rows from ordinal `N` onward.

These are exactly the operations that become awkward and error-prone if every
caller has to manually assemble composite keys and maintain side-index logic.

### Why There Are Two 2D Families

There are two `OnIo*` families because the project needs one logical contract
across two storage strategies:

1. `OnIoDup*`
   - uses native LMDB duplicate values within each ordinal bucket
   - best when the dupsort model is acceptable for the stored value shape
2. `OnIoSet*`
   - uses synthetic keyspace members within each ordinal bucket
   - best when the project wants the same logical behavior without relying on
     native dupsort constraints

This is the same broader design split used elsewhere:

1. `Dup*`/`IoDup*` = native LMDB multiplicity
2. `IoSet*`/`OnIoSet*` = synthetic keyspace multiplicity

The important point is that the two-dimensional model is the main abstraction.
The choice of dupsort-backed versus keyspace-backed storage is the
implementation strategy underneath it.

### What This Makes Easy

`OnIoSet*` and `OnIoDup*` are valuable when callers naturally think in terms
like:

1. "give me everything from ordinal `n` onward,"
2. "append a new ordinal bucket,"
3. "add another value to this existing ordinal bucket,"
4. "give me the newest member for each ordinal,"
5. "walk the newest ordinals backward,"
6. "drop all ordinals from this point forward."

These families make those operations small and deterministic. Without them,
higher layers must either:

1. flatten everything into one ad hoc key format and reimplement grouping, or
2. build and maintain parallel side indexes.

Both alternatives usually spread the same complexity across more code and make
correctness harder to review.

### When This Design Is Worth It

This design is worth it when all of the following are true:

1. one-to-many relationships under an ordinal bucket are common,
2. insertion order is semantically meaningful,
3. forward and backward range scans are operationally important,
4. deterministic restart/interoperability behavior matters,
5. multiple upper layers would otherwise replicate the same indexing logic.

This is why the design fits KERI DB work well. KEL, escrow, attachment, and
interoperability-sensitive flows all depend on stable ordering and reviewable
range semantics.

### When It Starts To Become Too Much

The overengineering risk is real, but it is usually not in the storage idea
itself. It appears when:

1. the method families exist but real call sites do not,
2. maintainers cannot tell which family to choose,
3. tests prove only shallow call coverage rather than behavior,
4. documentation explains the API names but not the storage shape,
5. temporary parity helpers silently become permanent surface area.

In other words, the danger is less "the 2D model should never exist" and more
"the 2D model must earn its keep and be documented clearly."

### Maintainer Verdict

The best way to read this design is:

1. the core idea is justified,
2. the API breadth needs discipline,
3. the documentation and tests must carry the cognitive load for non-original
   maintainers.

The mastery in the design is recognizing that ordered one-to-many buckets recur
often enough to deserve a first-class DB-layer abstraction. The maintenance
burden comes from making that abstraction legible to everyone else.

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

### D. Keyspace Invariants

1. Hidden suffix/proem machinery in `Io*` families is transparent to callers and
   never leaked as user-facing value content.
2. Synthetic-key strategies in `IoSet*` remain stable across process restarts.
3. Key helper functions (`onKey`, `splitOnKey`, etc.) remain deterministic and
   parity-compatible with KERIpy formatting.

### E. Lifecycle Invariants

1. DB open/close/reopen flows are safe and idempotent.
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

1. `docs/plans/keri/DB_LAYER_RECONCILIATION_PLAN.md`
2. `docs/plans/keri/DB_LAYER_PARITY_MATRIX.md`
3. Gate A-G and Gate H DB parity closure artifacts.

## Document Maintenance Rule

When DB-level behavior decisions are made in either KERIpy analysis or `keri-ts`
implementation:

1. update this document with concise architectural rationale,
2. record the decision delta in relevant learnings docs,
3. attach test evidence references where available.
