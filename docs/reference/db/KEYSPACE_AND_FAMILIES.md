# Database keyspace and family reference

Companion to the [normative DB contract](../../design-docs/db/db-architecture.md).

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

## Maintainer Mental Model For `LMDBer` Function Families

This section is the quickest way to reason about the `LMDBer` API surface
without reading it as a flat list of methods.

Most `LMDBer` methods are one of a small number of storage families. When
maintaining or testing a method, answer these four questions first:

1. Where is multiplicity represented: nowhere, native dupsort values, or
   synthetic key suffixes?
2. Where does ordering come from: plain (lexicographic) key order,
   duplicate-value sort order, exposed ordinal encoding in the key, or hidden
   ordering bytes in the value?
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
   - Parity status: `keri-ts` extension family. KERIpy exposes `IoSet*` and
     `OnIoDup*`, but not `OnIoSet*`.
   - Usage status: currently maintained as extension surface; not a current
     KERIpy parity requirement and not known to have production callers in
     `keri-ts`.
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
   they do not rely on native dupsort duplicates. `OnIoSet*` is a `keri-ts`
   extension family, not a KERIpy parity family.
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

That is not a niche edge case. It is a general shape that appears in key event
log creation and storage, CESR message streaming for event/attachment
processing, escrow-style staging, receipt/signature material, and other
one-to-many indexed DB paths.

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
   - in `keri-ts` today, this is an extension family rather than a KERIpy parity
     obligation

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
