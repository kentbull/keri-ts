# Complete implementation and qualification for 2.0.0

Status: **complete**. Implementation and preparation finished 2026-10-21.
2.0.0 was published on 2026-11-07, with 2.0.1 following on 2026-11-09. The
[2.0.0 release notes](../versioning/2.0.0-release-notes.md) own what shipped,
including the ACDC v2 registry, IPEX and service-package work completed after
this plan, and the post-publication qualification posture.

The [final qualification report](../reports/parity/V2_PREPARATION_2026-10-21.md)
owns source/artifact identities, executed checks, known limits and significant
uncertain decisions. Git/PRs own detailed implementation history. The
[prepared release notes](../versioning/2.0.0-release-notes.md) prominently list
breaking changes and link the source-pinned
[migration guide](../reference/compatibility/MIGRATING_TO_2_0.md), checked against
published 1.0.0 artifacts. Accumulated changesets are consumed; 1.0.0 history remains.

## Completed scope

- Logging/diagnostic correctness, strict configuration/CLI validation, configurable
  Tholder caps and exact pending-OOBI preview/apply through normal Baser loading.
- Synchronous semantic validation/commit, explicit protocol/HTTP/time dependencies,
  concrete transport owners and joined cleanup; no global protocol mutex.
- Consistent observable database close errors, refusal of unsafe reuse/reopen/delete,
  and final command success only after cleanup. Preview accepts ordinary Baser
  habitat reload, cleanup and table initialization; missing storage fails.
- Group CLI approval/fanout, legacy NoBackers VCP/ISS/REV and six-verb IPEX,
  exact-event resume, authenticated business preflight, historical lead selection,
  durable TEL publication and independent holder/verifier intake/replay.
- Exact legacy TEL framing/replay with v1 peers; incompatible conversion is refused,
  never disguised by rewriting signed bodies. External backed-TEL observer
  verification remains; autonomous backing and application authoring are retired.
- Tufa-owned verifier application, typed KERI workflows/Tufa presentation,
  query composition and cue ownership, finite initialization/OOBI bootstrap.
- Cohesive CESR/KERI/Tufa package directories and component subfiles, updated
  imports/test ownership/build discovery, without old-path shims or new packages.
- Patched Ajv 8.18.0, coordinated unpublished version metadata/changelogs/notes,
  full clean-source/peer/manual qualification and exact installed-artifact checks.

## Architectural decisions that remain binding

Apply the [ten constraints](/Users/kbull/enc/enctx/adrs/ten-constraints.md), SOLID
and [ADR-0013](../adr/adr-0013-simple-component-flows.md). Refactor responsibilities
before behavior; use explicit dependencies and cohesive concrete owners. No runtime
bags, generic execution/renderer frameworks or speculative policies.

Semantic owners validate current state and commit synchronously, then publish live
state/cues. Do not hold writers across yields. Separate processors/database writer
locks do not repair stale decisions; preserve causal children and proof unions.
ProtocolProcessor remains because it owns shared dispatch, exact reply capture and
composed escrow progression. It owns neither a mutex nor byte/network lifetime.
Removing it now would duplicate that boundary or recreate a forwarding facade.
Consumers needing only a semantic dependency receive it directly.

Human approval, child authentication, group acceptance, witness receipts, TEL
publication, saved credentials and completed destinations are distinct facts.
`exnSaid` is the outer coordination EXN; `payloadSaid` is the existing aggregation
key. `join --said` selects the outer EXN. Resume reuses original protocol evidence.
Poster outcomes identify an exact queue admission, not peer acceptance. A Deck has
one consumer unless composition explicitly fans out. Finite owners join workers
and I/O before store teardown. Observable operation and cleanup failures survive;
completed mutations are not rolled back by later shutdown failure.

<a id="essr-storage-correction--pr-12e"></a>

ESSR uses pinned-main Baser's ordinary `essrs.` LMDB Texter ordered set for
accepted/escrow evidence, retry and reconstruction. No filesystem archive,
private ownership/publication/recovery machinery, durable plaintext, custom staging
or replacement storage framework remains. Decryption returns authenticated owned
bytes; incoming and reconstructed digest checks remain separate. The inherited
repeated/alternate-fragment limitation is explicit. The
[storage supplement](essr/ESSR_STORAGE_PARITY_PLAN.md) and
[upstream issue report](../reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md)
retain the contract and conceptual correction. No upstream submission is authorized.

Autonomous legacy TEL backing is rejected by
[ADR-0014](../adr/adr-0014-legacy-tel-backer-retirement.md); the
[retirement report](../reports/credentials/LEGACY_TEL_BACKER_RETIREMENT.md) retains
its former design. Do not restore local backing services, collection/hosting,
backed-registry application authoring or private endorsement-choice storage.
Historical external observer verification/escrow/replay remains supported.

No compatibility with old keri-ts APIs/private formats is required: no aliases,
shims or migration readers. Protocol compatibility remains required. Tholder caps
are deployment settings fixed before concurrent processing, not wire maxima.

## Qualification boundaries

The [reference manifest](../../scripts/ci/keripy-reference.json) freezes WOT main
c7e74ad, GLEIF-IT 1.2.17 b8626e1d, WOT 1.3.x 4ce4cc79 and the separate mailbox
fork 331f32e4. Verify actual imported source/interpreters/dependencies; do not
advance pins mid-run or relabel fork/API evidence as upstream CLI qualification.
GLEIF 1.2.17 replaces failed upstream 1.2.14; no 1.2.14 success is claimed.

Preserve maintained participant topology, weighted/offline-member cases, restart,
historical authority, hostile ordering and failure assertions. The full suite
includes manual delegation and six real witnesses; ownership audits alone are not
execution. Keep tests focused on supported behavior, never absence of discarded
ideas. Native local LMDB tests use Docker named volumes, not host/bind-mounted stores.
Future repairs require relevant retesting; changed/rebuilt artifacts need identical
hashes or independent qualification. No hosted extended-job dispatch is authorized.

## Deferred work

2.0.0 shipped the v2 registry, IPEX and wallet work through `--acdc-v2` after
this plan's preparation. The release notes record that the full battery runs after
publication and that a regression it finds ships as a 2.0.x patch. Reciprocal peer
qualification (N1–N3) and the `upd` assessment remain with the
[v2 ACDC registry roadmap](credentials/V2_ACDC_REGISTRY_ROADMAP.md). Independent
KERI/CESR v2 remains supported. Pinned Python CLI URL/framing/protected-source
limits are separately [documented](../reports/interop/KERIPY_MULTISIG_VCP_GENUS.md).

Also deferred from 2.0.0: generic retries, durable outboxes, delivery
acknowledgements, generic database providers, broad Python porting and direct
legacy ESSR LMDB interchange. Ordinary protocol escrows/recovery and legacy wire
support remain. The pluggable store contract of ADR-0015 has since landed on
master for the next release.
