# PROJECT_LEARNINGS_KELS

## Purpose

Persistent learnings for KEL processing, event-state transitions, and
replay/verification semantics.

## Current Status

1. No dedicated KEL state-machine implementation milestone has landed yet; the
   active work is still the foundation layer around DB parity and practical
   `kli`/`tufa` interoperability planning.
2. Phase 2 planning is now parity-first: P0 command/output parity and D0
   inventory/parity artifacts are established, and D1 DB-core parity is the
   active workstream.
3. `docs/design-docs/db/db-architecture.md` is the current cross-topic DB
   invariants reference for ordering, idempotence, serialization, lifecycle, and
   interoperability semantics that later KEL logic will rely on.
4. Interop planning has expanded from init/incept-only work into a usable
   bootstrap arc covering list/aid visibility, service endpoints, OOBIs,
   direct+mailbox communication, and challenge flows.
5. DB parity scaffolding now includes the DB parity matrix, K/V inventory/work
   lists, and an interop harness tied to Gate A-G command parity tracking.
6. `LMDBer` D1 progress now covers core branch counting/deletion plus the `On*`,
   `IoSet*`, `dup*`, and `IoDup*` families needed by downstream
   Suber/Komer/Baser work.
7. Targeted DB-core parity/oracle suites were green at the latest recorded
   checkpoint, and representation coverage for the current `LMDBer` surface was
   explicitly audited.
8. `LMDBer.cntTop` and `LMDBer.cntAll` remain flagged for later keep-vs-remove
   review once the real `init/incept/rotate` call graph stabilizes.

## Scope Checklist

Use this doc for:

1. event validation and ordering rules,
2. replay behavior and state derivation,
3. key state transition constraints,
4. compatibility nuances with KERIpy KEL behavior.

## Cross-Topic Design References

1. `docs/design-docs/db/db-architecture.md`

## Current Follow-Ups

1. Keep KEL-state work parity-first on top of DB invariants rather than adding
   abstraction before behavior closure.
2. Validate planned command-level parity gates against real KERIpy behavior and
   output shape as those commands become executable.
3. Keep DB parity artifacts concise and execution-oriented; they should remain
   usable worklists, not archival dumps.

## Milestone Rollup

### 2026-03-14 - LMDBer Maintainer Taxonomy Added

- Added a maintainer-oriented `LMDBer` family taxonomy to the DB architecture
  contract so the DB layer can be reasoned about by storage model instead of as
  a flat method list.
- Captured the key distinctions between `Dup*`, `IoDup*`, `IoSet*`, `On*`,
  `OnIoSet*`, and `OnIoDup*`, including where multiplicity and ordering actually
  live.
- Added a design-rationale section explaining why the two-dimensional
  `OnIoSet*`/`OnIoDup*` model exists, what upper-layer operations it simplifies,
  when it is justified, and where the real overengineering risk sits for
  maintainers.

### 2026-03-14 - Dupsort And IoDup Semantics Clarified

- Tightened the DB architecture contract to distinguish native LMDB duplicate
  values from application-level keyspace virtualization.
- Added explicit `Dup*` and `IoDup*` examples showing that dupsort order is by
  stored value bytes, while `IoDup*` uses hidden value proems to turn that into
  logical insertion order.
- Strengthened `LMDBer` unit coverage with focused tests for duplicate
  lexicographic ordering, last-duplicate semantics, IoDup insertion order, and
  monotonic hidden ordinal advance after deletion/reinsertion.

### 2026-03-14 - Root Test Failures Traced To `lmdb@3.5.1` Drift

- The repo-root `deno task test` failures were caused primarily by
  `packages/keri` drifting from the intended `lmdb@3.4.4` baseline to
  `lmdb@3.5.1` via caret imports.
- Under Deno 2.7.4 on macOS arm64, `lmdb@3.5.1` reproducibly panicked with
  `Cannot remove cleanup hook which was not registered` during app-level DB
  startup, while `lmdb@3.4.4` opened and closed cleanly.
- Fix: pin `lmdb` exactly to `3.4.4` in package imports/source references and
  keep the lockfile aligned with that exact version.
- Secondary test-suite fixes were needed in interop harnesses to avoid treating
  `pyenv`'s `kli` shim error output as proof that `kli` is actually installed.
- Effection integration tests were also decoupled from real LMDB startup so they
  keep exercising Effection orchestration rather than native DB boot paths.

### 2026-03-02 - Planning and Parity Artifact Foundation

- Expanded the reconciliation plan from init/incept-only work to a practical
  controller bootstrap arc with parity gates for visibility, service endpoints,
  OOBIs, transport, and challenge flows.
- Added the dedicated DB reconciliation plan and made LMDB parity an explicit
  prerequisite before provider abstraction.
- Generated and then refined the DB parity matrix, K/V inventory, owner lanes,
  gate worklists, and explicit Gate A-G mappings.
- Added an initial command/output parity matrix and a matrix-driven interop
  harness so P0 closure was auditable rather than implicit.

### 2026-03-03 - D1 DB-Core Parity and DB Contract Hardening

- Advanced `LMDBer` parity with lifecycle/version behavior, branch helpers, and
  the broader ordinal/dup/io-dup families needed downstream.
- Added stricter KERIpy-oracle vectors for backward-iterator and mixed-key edge
  behavior, plus a representation sweep so every current `LMDBer` method has a
  direct unit-test reference.
- Published and then broadened the DB architecture doc into a true invariants
  contract rather than a narrow dupsort note.
- Added maintainer-oriented helper/test doc passes to keep DB parity work
  reviewable during the method-by-method closure phase.

### 2026-03-03 - API Surface Review Flags

- Recorded a deliberate follow-up to re-evaluate `cntTop` and `cntAll` after the
  real KEL/bootstrap command graph is stable, so temporary reconciliation APIs
  do not silently become permanent surface area.
