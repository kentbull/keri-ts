# V1/V2 registry qualification plan

Planning constraint: the [accepted simplification](../PARITY_ROADMAP.md) supersedes older
architecture requirements. Concrete owners, one worker model and complete-enclosure
buffering replace speculative frameworks; protocol correctness and real cleanup remain.

Owner: roadmap **3e registry**, alongside [IPEX][ipex]. R1–R12 are implemented:
separate v2 storage, event engine, issuer services, public observer intake,
IPEX accepted-chain assembly, presentation cutoffs and explicit runtime ownership.
Keep the delivered v1 VDR protocol stack operational; old keri-ts data compatibility
is not required. The
[current contract][contract] owns behavior; the
[1.0.0 release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md) records
qualified evidence and reference gaps. This plan retains the regression boundary.

Pinned reference: `7143832813cac6a394ab1faf9be83bb3372be87c`.
Inspect `acdc/regbasing.py`, `registering.py`, `regeventing.py`, `registraring.py`,
`ipexing.py` and legacy VDR owners when resolving parity questions. Its schema
validation and missing-schema escrow changes are the implemented S1–S3 profile.
Earlier `927c0cb8` fixture results retain their historical provenance.

## Implemented ownership

| Responsibility                    | Owner                                              |
| --------------------------------- | -------------------------------------------------- |
| Layout/lifecycle                  | RegBaser                                           |
| Storage/aliases/ordered chains    | RegistryStore                                      |
| Pure vetting                      | vet/vetBinds                                       |
| Atomic decisions/escrows          | Registry engine                                    |
| Local create/blind/present/vacate | Regery/Registry; unused Registrar wrappers removed |
| Public parsed intake              | RegistryObserver                                   |
| Child and presentation proofs     | IPEX                                               |
| Scoped runtime installation       | acdc.rgy; separate vdr.rgy                         |

RegistryStore reads do not authenticate evidence. Body presence does not establish
accepted sequence/head state. Local engine acceptance requires full witnessed
KEL tuples; observer digest-only vetting remains a separate proof boundary.
Choose concrete Reger/Regery/Tevery/Verifier dependencies at construction. Do not
retain vague service bags or repeated runtime type checks. Both v2 and legacy VDR
Registrar wrappers are removed after caller review: neither had a production
consumer or independent responsibility. Regery/Registry/Credentialer retain the
actual version-specific workflows; no compatibility forwarding class remains.

Concrete owners support reopen, earliest-anchor retention, deterministic retry,
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
schemas reject and infrastructure/resource failures propagate. TS DI2I now checks
approved inception relationships, inception DND and typed missing KEL dependencies.
NOT evaluates authenticated far-node validity using the accepted issued/revoked
profile at each fresh validation; unknown/malformed evidence cannot satisfy it.
Neither operator is implemented by the selected Python IPEX reference. Follow the
[operator acceptance matrix](../qualification/GRADUATED_DISCLOSURE_INTEROP.md):
test these operators in keri-ts, excluding them from Python interop until the
selected reference supports them. Preserve the distinction between known
invalidity and missing evidence. Hidden aggregates and deeper nests stay guarded.
The [Mapper correction][mapper] owns bundled-schema construction and encoding
qualification. Cached/override validation alone does not qualify that builder.
Explicit schema OOBIs work; automatic discovery from a bare SAID lacks an upstream
host-resolution path and is not an indefinitely blocking port requirement.

## Remaining qualification

1. Exercise composed issuer creation, blind/present/vacate, observer intake,
   accepted-chain assembly and IPEX receipt cutoffs through actual runtime owners.
   Include missing/out-of-order events, duplicate/competing successors, reseals,
   earliest anchors, dependency retry, close/reopen and durable replay.
2. Qualify current v1/v2 protocol stores without path/table/owner collisions.
   Preserve current ordinal precision, insertion/deduplication order, accepted
   markers and aliases. Old-layout compatibility tests and lazy-table machinery
   are removed; add no migration or old-data reader.
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
NumberPrimitive precision does not extend the physical store API. Scan/copy
admission and native row billing are removed. Actual native buffer validity,
transaction/reopen correctness, TEL/TSN query processing and real transport
qualification retain their existing owners; isolated registry tests do not close them.

Use the roadmap's review units: cohesive deletion/refactoring may span
1,000–3,000 changed lines; keep individual discovered bug fixes narrowly scoped.
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
