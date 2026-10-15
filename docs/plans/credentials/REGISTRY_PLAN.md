# V1/V2 registry qualification plan

Planning constraint: [ADR-0013](../../adr/adr-0013-simple-component-flows.md) requires removal of
application accounting and unsupported delivery durability, without old-version
keri-ts API/data compatibility. Protocol correctness and real cleanup remain.

Owner: roadmap **3e registry**, alongside [IPEX][ipex]. R1–R12 are implemented:
separate v2 storage, event engine, issuer services, public observer intake,
bounded IPEX chain assembly, presentation cutoffs and explicit runtime ownership.
Keep the delivered v1 VDR stack and existing #168 stores operational. The
[current contract][contract] owns behavior; this plan owns remaining evidence.

Pinned reference: `7143832813cac6a394ab1faf9be83bb3372be87c`.
Inspect `acdc/regbasing.py`, `registering.py`, `regeventing.py`, `registraring.py`,
`ipexing.py` and legacy VDR owners when resolving parity questions. Its schema
validation and missing-schema escrow changes are the implemented S1–S3 profile.
Earlier `927c0cb8` fixture results retain their historical provenance.

## Implemented ownership

| Responsibility                    | Owner                      |
| --------------------------------- | -------------------------- |
| Layout/lifecycle                  | RegBaser                   |
| Storage/aliases/ordered chains    | RegistryStore              |
| Pure vetting                      | vet/vetBinds               |
| Atomic decisions/escrows          | Registry engine            |
| Local create/blind/present/vacate | Regery/Registry/Registrar  |
| Public parsed intake              | RegistryObserver           |
| Child and presentation proofs     | IPEX                       |
| Scoped runtime installation       | acdc.rgy; separate vdr.rgy |

RegistryStore reads do not authenticate evidence. Body presence does not establish
accepted sequence/head state. Local engine acceptance requires full witnessed
KEL tuples; observer digest-only vetting remains a separate proof boundary.
Named services support reopen, earliest-anchor retention, deterministic retry,
protected accepted slots/heads and an unambiguous staged frontier. Pure constructors
remain synchronous. Runtime-owned stores close on failure, cancellation and explicit
shutdown; injected services remain borrowed and readonly Haberies acquire no
implicit writable store.

The custom bulk import was removed after [preserving its exact design][import-record].
Public observer intake delegates to the ported engine with per-event atomic
acceptance. Frozen and inspected current KERIpy lack the equivalent production
receiver path; this is an approved TypeScript integration, not an invented upstream
port. The [gap review][gaps] records source and Discussions evidence. Do not restore
bulk accepted-row writes to bypass the workflow's verification.

## Schema boundary

| Unit | Implemented responsibility                             |
| ---- | ------------------------------------------------------ |
| S1   | Local verified schemas before blind derivation/staging |
| S2   | Durable missing-schema escrow and shared deadlines     |
| S3   | Offer schemas; issuer-first grant node/edge schemas    |

S1 validates decoded credential data with bounded local resource closure; legacy
Schemer remains separate. S2/S3 retain typed missing dependencies while invalid
schemas reject and infrastructure/resource failures propagate. NOT/DI2I remain
unsatisfied as in inspected 714; hidden aggregates and deeper nests stay guarded.
The [Mapper correction][mapper] owns bundled-schema construction and encoding
qualification. Cached/override validation alone does not qualify that builder.
Explicit schema OOBIs work; automatic discovery from a bare SAID lacks an upstream
host-resolution path and is not an indefinitely blocking port requirement.

## Remaining qualification

1. Exercise composed issuer creation, blind/present/vacate, observer intake,
   accepted-chain assembly and IPEX receipt cutoffs through actual runtime owners.
   Include missing/out-of-order events, duplicate/competing successors, reseals,
   earliest anchors, dependency retry, close/reopen and durable replay.
2. Qualify legacy v1, v2 and #168 store readback without path/table/owner collisions.
   Preserve `evts/ancs/tels/heads/maes/ooes`, physical `heds.`, local `regs.`,
   ordinal widths, insertion/deduplication order, markers and aliases. Reads must
   not rewrite, migrate or discard records. A migration needs separate review.
3. Preserve `LMDB_DATA_V1=true`; LMDB format, body protocol and attachment genus
   are independent. Use disposable stores and one live V1 owner per path/process.
   Compare Python→TS and TS→Python where the reference actually supports the path.
4. Prove default/injected/readonly runtime ownership and joined construction,
   cancellation and explicit-close cleanup. Keep parent EXN, child issuer and
   registry-binding proofs separate. Conversation acceptance is not wallet acceptance.
5. Run affected maintained workflows after the final Mapper/schema change, then
   the [full qualification inventory][qualification]. Identify historical v1,
   unmodified upstream and mailbox-fork evidence separately, including imports.

Safe-integer storage ordinals remain an explicit unsupported range; protocol
NumberPrimitive precision does not extend the physical store API. Shared scan/copy
admission, other native row allocation and crash recovery retain phases 4–5.
TEL/TSN query processors, production transport and final resource measurements have
their existing owners. None is closed by isolated registry tests.

Use the roadmap's 300–500-line-or-smaller review units for discovered fixes.
Preserve participant topology and independent oracle assertions; reuse existing
scenarios and keep exploratory probes uncommitted unless a maintained regression
has clear value. Hosted long qualification remains maintainer-only with its
15-minute cap.

[contract]: ../../design-docs/credentials/ACDC_TEL_VERIFIER.md
[ipex]: ../exchange/IPEX_PLAN.md
[import-record]: ../../reference/credentials/VERIFIED_IMPORT_SNAPSHOT.md
[gaps]: ../../reference/credentials/UPSTREAM_REGISTRY_GAPS.md
[mapper]: ../cesr/MAPPER_PLAN.md
[qualification]: ../qualification/QUALIFICATION_PLAN.md
