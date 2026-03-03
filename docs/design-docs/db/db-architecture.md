# KERI DB Architecture and Parity Contract (KERIpy -> keri-ts)

## Purpose

This document is the DB architecture contract for `keri-ts` parity work against
KERIpy.

It captures:

1. The layered DB model used by KERIpy.
2. The equivalent target model in `keri-ts`.
3. Where behavior differs today.
4. The invariants we must preserve as features are implemented.

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

KERIpy usage:

1. `DupSuber`: duplicate set with lexicographic ordering.
2. `IoDupSuber`: insertion-ordered duplicate set via hidden value proem.
3. `OnIoDupSuber`: exposed ordinal tail in key + insertion-ordered duplicates.

### `dupsort=False` Synthetic-Set Model

Definition:

1. Multiplicity is represented by creating unique physical keys via hidden
   suffixing, while exposing a logical key-level set abstraction.

KERIpy usage:

1. `IoSetSuber`: insertion-ordered set without native dupsort duplicates.
2. `OnIoSetSuber`: exposed ordinal tail + hidden insertion-order suffix.

## Serialization Families and Intent

1. `Cesr*`:
   CESR primitive object serialization/deserialization.
2. `CatCesr*`:
   concatenated CESR primitive tuple payloads in one stored value.
3. `B64*`:
   qb64-focused tuple/value handling for identifier/index-heavy paths when full
   object rehydration is unnecessary.
4. `Komer`:
   key-to-structured-object mappings for non-CESR dataclass-like records.

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

1. Parity-first:
   complete LMDB parity behavior before provider abstraction implementation.
2. Abstraction correctness over convenience:
   do not collapse distinct families (`IoDup` vs `IoSet`) if semantics differ.
3. Backend API translation:
   when using `lmdb-js` range APIs, preserve KERIpy cursor behavior contracts by
   explicit boundary conditions and mutation discipline.
4. Performance decisions:
   optimize only after parity tests prove no behavioral regressions.

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
