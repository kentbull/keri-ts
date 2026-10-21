# Complete implementation and qualification for 2.0.0

Status: **complete, excluding publication**, 2026-10-21.
Prepared **cesr-ts 2.0.0, keri-ts 2.0.0 and @keri-ts/tufa 2.0.0**.
Publication remains deferred until the separate native ACDC/registry work is
complete and affected qualification is repeated. Do not publish under this goal.

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

## Deferred work and later publication

All remaining native-v2 rip/bup/upd-dependent authoring, CLI/wallet/disclosure,
presentation and N1–N3 lifecycle work belongs to the
[native roadmap](credentials/NATIVE_V2_ACDC_REGISTRY_ROADMAP.md). Keep retained
partial APIs/regressions honest; they do not establish a complete native lifecycle.
Independent KERI/CESR v2 remains supported. Pinned Python CLI URL/framing/protected-
source limits are separately [documented](../reports/interop/KERIPY_MULTISIG_VCP_GENUS.md).

Also deferred: generic retries, durable outboxes, delivery acknowledgements,
generic database providers, broad Python porting and direct legacy ESSR LMDB
interchange. Ordinary protocol escrows/recovery and legacy wire support remain.

After the side-chat work is complete and publication is separately authorized:

1. Reconcile its code, notes and breaking guide into the still-unpublished 2.0.0
   preparation. Recheck registry state; do not mechanically bump to 3.0.0 before
   2.0.0 has shipped. Preserve 1.0.0 packages/tags/releases/assets.
2. Repeat affected clean-source, actual-peer and installed-artifact qualification.
   Prior evidence is scoped to its recorded source/bytes, not moving master.
3. Publish CESR → KERI → Tufa from one qualified source, compare workflow/npm/GitHub
   artifact identities, and verify dependencies, dist-tags, release notes and assets.
4. Run registry-only installed runtime/CLI/declaration checks. Publication and these
   post-publication checks were excluded here. Do not ungate #527, push release
   tags, publish/unpublish npm packages or create GitHub releases under this goal.
