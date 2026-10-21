# Complete implementation and qualification for 2.0.0

Status: active; merged baseline `a816f5ee` (#662), 2026-10-21.
Complete implementation, release preparation and fresh qualification for
**cesr-ts 2.0.0, keri-ts 2.0.0 and @keri-ts/tufa 2.0.0**.
**Publication is excluded** pending the side-chat native ACDC/registry work.
This goal may finish after all other required work and qualification pass.

## Current state

Feature implementation is complete: operator/configuration/logging/OOBI fixes,
synchronous protocol ownership, ESSR LMDB storage, database close correctness,
CLI multisig approval/fanout, legacy NoBackers VCP/ISS/REV and six-verb IPEX,
legacy TEL replay and Tufa verifier separation. Autonomous legacy TEL backing
is retired; external observer verification remains supported.

Bounded peer evidence is implemented through #662, including weighted CLI quorum
with an offline non-required member and native-v2 KEL acceptance/refusal boundaries.
The independent-holder main KLI audit found separately documented upstream URL
and framing-context limits. Fresh independent Python wallet grant/admit/revocation
evidence uses unmodified public APIs, separately from the maintained mailbox-fork
CLI workflow. These checks do not replace fresh final qualification after organization.
The last broad checkpoint is #650; Git/PRs own detailed delivery history.

| Review cut    | Disposition                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 01–12         | Design, protocol/transport ownership and operator fixes merged #576–596.                                                                                   |
| 12a–12e       | ESSR/database lifecycle merged #598–601 and #608.                                                                                                          |
| 13–16, 19     | Reporting, selection/resume, query/bootstrap, CLI validation, group VCP/ISS and six-verb IPEX merged through #649.                                         |
| 17–18, R3, 20 | TEL replay #651; autonomous backing retired #652; group revocation #653–654.                                                                               |
| 30a–30c       | Public dependencies, Tufa verifier ownership and refusal counts #655–657.                                                                                  |
| 31            | Reciprocal TEL, mixed CLI roles and legacy group credential/IPEX API evidence #658–661; profile boundaries #662 and independent Python recipient evidence. |
| 31a           | Ownership review: retain ProtocolProcessor's cohesive dispatch/publication boundary; see below.                                                            |
| 31b–31d       | **Next:** organize CESR, KERI and Tufa, separate human-reviewable package cuts.                                                                            |
| 32            | Exact 2.0.0 metadata/changelogs/breaking guide, dependency review and fresh full qualification.                                                            |
| Preparation   | Qualify and retain unpublished artifacts; no npm/tag/GitHub publication.                                                                                   |

## Scope and architectural constraints

- Preserve supported **KERI/ACDC/CESR protocol interoperability**. Old keri-ts
  APIs/private storage formats require no compatibility: remove obsolete designs
  and document breaks; add no aliases, shims or migration readers.
- Apply the [ten constraints](/Users/kbull/enc/enctx/adrs/ten-constraints.md),
  SOLID and [ADR-0013](../adr/adr-0013-simple-component-flows.md). Refactor
  responsibility/contracts before behavior. Prefer concrete owners and explicit
  dependencies; no runtime-shaped bags or speculative frameworks.
- Semantic owners synchronously validate current state, commit and publish live
  state/cues. Do not hold writers across yields or restore whole-protocol
  exclusion. Separate processor instances/database writer locks do not repair
  stale decisions. Preserve causal child processing and proof unions.
- Keep human approval, child authentication, group acceptance, witness receipts,
  TEL publication and completed transport destinations distinct. Parent signatures
  never authenticate children. `messages.exnSaid` names the outer coordination
  EXN; `payloadSaid` is its existing aggregation key. `join --said` selects the
  outer EXN. Explicit resume reuses the original protocol event/proof/anchor.
- Finite commands own/join their host workers and resources. Unexpected close
  failures propagate; no reopen/delete after failed close and no final success
  before owned cleanup. Preserve operation and independent cleanup failures.
  Completed deletions are not rolled back by a later close failure.
- OOBI cleanup uses ordinary Baser loading and canonical pending `oobis` keys,
  including its separator convention. Missing databases fail. Habitat reload,
  cleanup and other normal Baser startup effects are accepted, including preview.
- Tholder `maxWeights`/`maxSithLength` are configurable deployment caps set before
  concurrent processing, not wire maxima or permission for application budgeting.
- Poster waits observe the exact admission's transport outcome, not peer
  acceptance. Keep clocks at actual time owners and preserve joined cancellation.
- Simplify policy-bearing nested/async ternaries in changed owners; no blanket
  ternary ban or unrelated codec cleanup.

<a id="essr-storage-correction--pr-12e"></a>

ESSR follows pinned-main `Baser.essrs` ordered-set LMDB storage. Incoming and
reconstructed digest checks remain separate; repeated/alternate-fragment limits
are explicit. No archive, file ownership/publication/recovery machinery, durable
plaintext storage or replacement content framework. The
[storage supplement](essr/ESSR_STORAGE_PARITY_PLAN.md) owns the accepted scope;
the [repeated-fragment report](../reports/essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md)
remains available for Kent to upstream. No upstream submission is authorized.

Legacy TEL backing retirement is recorded in the
[report](../reports/credentials/LEGACY_TEL_BACKER_RETIREMENT.md) and
[ADR-0014](../adr/adr-0014-legacy-tel-backer-retirement.md). Do not restore autonomous
signing/collection/hosting, backed-registry application authoring or their private
storage. Retain external backed-TEL verification, historical cohorts, escrows and
replay. Former cuts 21–24 and new group-backer/VRT/BIS/BRV authoring are cancelled.
Issuer multisig approval and KEL witnessing remain independent supported features.

Tufa owns verifier policy, webhook formatting/delivery, workflow records and its
command. KERI owns protocol Verifier, IPEX and accepted evidence. The public
Tufa runtime/cue-store lifecycle and installed `verifier run --once` webhook path
are tested. Local delivery markers are application records, not protocol acks.
The [separation supplement](credentials/TUFA_VERIFIER_SEPARATION_PLAN.md) describes
the completed boundary, not an additional implementation queue.

## Deferred scope

All remaining work depending on native-v2 ACDC/registry `rip`/`bup`/`upd` is in the
[native roadmap](credentials/NATIVE_V2_ACDC_REGISTRY_ROADMAP.md): native CLI
registry/credential authoring, disclosure custody, native IPEX/wallet completion,
presentation and N1–N3 lifecycle qualification. Keep merged partial APIs and useful
regressions honestly documented/tested; do not advertise a complete native
lifecycle or count unsupported lanes as passed. Independent KERI/CESR v2 remains
in scope. Deferral does not authorize hiding failures in maintained tests.

Also deferred: generic delivery retries, durable outboxes, delivery acknowledgements,
generic database providers, broad Python porting and direct legacy ESSR LMDB
interchange. Ordinary protocol escrows/recovery and legacy wire interoperability
remain required. Publication and post-publication verification are outside this goal.

## Reference profiles and evidence boundaries

[`scripts/ci/keripy-reference.json`](../../scripts/ci/keripy-reference.json) owns
source/dependency pins. Verify actual interpreters/imports and freeze them per run.

| Lane                  | Repository               | Commit                                     |
| --------------------- | ------------------------ | ------------------------------------------ |
| Main                  | WebOfTrust/keripy        | `c7e74adc3129ba36302db32e58056560b0927424` |
| Legacy 1.2.17         | GLEIF-IT/keripy          | `b8626e1d58770a4a480ea72a01acc5580278a9f2` |
| Legacy 1.3.x          | WebOfTrust/keripy        | `4ce4cc79e06653f77342be1bf604086b89b1f090` |
| Separate mailbox fork | Existing mailbox harness | `331f32e4de13cc5cb699587c5b1f1e5bc4468035` |

GLEIF 1.2.17 replaces the failing upstream 1.2.14 gate; never claim 1.2.14 passed.
Main `c7e74ad` supersedes old-pin results. Historical fixtures/reports are not fresh
qualification. The mailbox fork remains separately identified; main has no
`keri.app.mailboxing` host. Distinguish CLI, protocol/API, fixtures and database
interchange; missing environments/reference defects are not passing evidence.

The maintained scenario set supplies the following evidence, to be rerun from the
final source after organization. Preserve its topology and assertions:

| Boundary            | Maintained evidence                                                                                                                                                                                                                                                                                  |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Wire/profile        | Verified CLI/KEL/OOBI intake on all three pins; v1 control accepted everywhere, native-v2 KEL accepted on main and unaccepted on legacy. Actual TCP TEL replay covers v1/v1 and main v1-body/v2-genus. Unsupported downgrade is explicitly refused.                                                  |
| Replay/restart      | TS-to-Python and Python-to-TS issuance/revocation; fresh observer intake, reopen and stale issuance cannot revive revocation. External indexed backed-TEL observer validation remains.                                                                                                               |
| Mixed CLI roles     | Tufa proposes witnessed inception/Python approves; Python proposes interaction/Tufa approves. Independent stores reopen at the same coordinate. Preserve 2-of-2 and weighted three-half quorum with a non-signing offline member.                                                                    |
| Mixed legacy APIs   | VCP/ISS/REV, reciprocal issuance, apply/offer/agree/grant/admit and separate spurn cross actual HTTP between independent TS/Python member stores; a fresh third Python wallet accepts grant/admit and later revocation. Actual signatures and verifier/TEL acceptance; TS reopen retains revocation. |
| Holder/observer     | Existing CLI group workflow retains independent member, holder and verifier stores; grant/admit wallet settlement, actual revocation delivery and verifier reopen/stale replay. The mixed API scenario does not replace this topology; main CLI wallet URL/context limits are recorded separately.   |
| Transport/ownership | Real HTTP/TCP and old witness-mailbox polling, separate mailbox/KRAM cases, scoped cancellation/cleanup, witnessed/delegated setups and ordinary/establishment-only anchors.                                                                                                                         |
| Negative/recovery   | Existing wrong signer/issuer/anchor, duplicate indices, missing/tampered proof, partial signatures, hostile ordering, consumed-notification restart and exact-event resume. Add negatives only for a demonstrated uncovered risk.                                                                    |
| Operator/storage    | Strict no-write input refusal, initialization/encryption intent, canonical OOBI cleanup and Python reopen, database shutdown and simultaneous operation/cleanup failures.                                                                                                                            |

Python apply/offer/agree CLI files and wrapped-IPEX join paths are stubs at the
inspected references. Registry/credential join also has the separately reproduced
[framing and protected-source limitations](../reports/interop/KERIPY_MULTISIG_VCP_GENUS.md).
Use unmodified public APIs with valid framing/protected explicit approval to
qualify protocol capability separately. Do not weaken remote intake, patch peers,
seed accepted rows or claim full Python CLI parity. Retain exact source/reproducers
for blocked CLI gates and report them as limits. No upstream submission is authorized.

The [parity roadmap](PARITY_ROADMAP.md),
[compatibility inventory](../reference/compatibility/KERI_V1_V2_COMPATIBILITY.md)
and [qualification standard](qualification/QUALIFICATION_PLAN.md) retain their
own roles. Historical unchecked boxes are not new implementation scope.

## Final ownership assessment and package organization — cuts 31a–31d

Source/caller review supports retaining ProtocolProcessor: it registers semantic
routes once, creates input-specific Kevery instances, captures exact request replies
before ordinary cue publication, and coordinates the composed escrow owners.
It owns neither a mutex nor byte/network lifetime. Removing it would distribute
this shared boundary among inputs or recreate a forwarding facade. Components
needing only a concrete semantic dependency should receive it directly; do not
retain this owner solely as a dependency bag or for the moved verifier application.

Organize each package by change-together responsibilities, especially crowded
app/CLI modules. Use recognizable KERIpy categories where useful; actual
responsibility/dependencies and human navigation decide the layout. Split large
files only at demonstrated responsibility boundaries. No file quotas, new published
packages, wildcard barrels or old-path shims. Keep behavior changes separate.

Review CESR, KERI and Tufa in separate cohesive cuts; split further when human
review benefits. Preserve public entrypoints and update actual imports, test
ownership, build/DNT discovery and maintained source links together. Give each PR
a concise category map. Run affected existing tests, packed-entrypoint/strict
NodeNext checks and relevant peer paths; do not add file-layout/retired-idea absence
tests. Full qualification follows all moves and any necessary fixes.

## Review and validation discipline

- One human-reviewable implementation PR at a time, with an appropriate changeset,
  concrete result, relevant source and honest limits. Maintain useful docstrings;
  no routine per-PR reports or exhaustive documentation/play-by-play updates.
- Test supported behavior at its actual boundary. Preserve independent crypto,
  stores and semantic oracles; no tests/lint blacklists for discarded designs.
- Follow [PR scope](../reference/PR_TEST_SCOPE.md): exact-commit local credit only
  for checks actually run; applicable interop/package CI; static/changeset gates.
  Broad checkpoint roughly every 20 implementation PRs; fresh final suite required.
- Native LMDB execution uses Docker named volumes, not host/bind-mounted stores.
  Follow the workspace KERIpy test skill. Repair environment failures; never mask
  them by changing behavior or count an unexecuted assertion as passed.
- Preserve thresholds, proof/ordering, cancellation and restart coverage without
  a Cartesian matrix. Maintainer-only hosted dispatch retains its authorization rule.
- After final workspace/Git mutations, run prescribed ENCTX maintenance; require
  healthy/no stale sources without changing source admission/selection.

## Final qualification and release preparation — cut 32

1. **Review runtime advisories.** Inspect pinned Ajv 8.17.1 /
   GHSA-2g4f-4pwh-qvx6 (`$data` ReDoS), configured options and the actual dependency
   graph. Update to a verified patched pin with focused schema/package checks.
   Transitive npm counts do not establish distinct vulnerabilities or exposure.
2. **Prepare exactly 2.0.0 for all three packages.** Consume accumulated changesets
   into changelogs before clearing notes. Reconcile manifests, Deno mirrors, npm
   lock entries, generated versions and internal dependencies with existing checks.
   Preserve 1.0.0 history. Recheck workflows before merging version preparation:
   no publish, release tags or publish-enabled dispatch. Keep bot PR #527 gated.
3. **Complete breaking-change documentation.** Compare supported exports/APIs,
   CLI/configuration, runtime ownership, storage/encryption and import contracts
   against published 1.0.0 artifacts. Finish
   [MIGRATING_TO_2_0.md](../reference/compatibility/MIGRATING_TO_2_0.md) by package
   with replacements/actions and concise examples. Cover removed ESSR APIs,
   verifier relocation and actual public changes; invent none merely for coordinated
   versioning. Put concrete **Breaking changes** prominently in changelogs and
   prepared release notes, linked to the version-pinned guide.
4. **Qualify the final clean source.** Run the complete maintained CESR/KERI/Tufa
   suites and in-scope actual-peer matrix after every feature/ownership/organization
   change. Include required manual delegation/witness endurance. Prior qualification
   exclusions do not carry forward. Document native ACDC/registry partial API limits
   and deferred completion; do not advertise native CLI lifecycle parity.
5. **Qualify exact coordinated tarballs.** Test declared Node minimum (currently
   20.3; verify final metadata), selected current Node, established platform profiles
   and source Deno. Prove strict NodeNext without skipLibCheck, crypto/tamper refusal,
   CLI/HTTP, actual TCP and >16 MiB LMDB read/reopen/caller-owned bytes. Install
   compiler tools after runtime smoke; record digests. Rebuilt artifacts must be
   identical or independently qualified. Repairs require relevant retesting.
6. **Prepare the distribution handoff.** Verify clean synchronized master, exact
   source commit, reviewed version preparation, current npm versions/dist-tags/
   dependencies and GitHub tag/release/asset identities. Do not unpublish or replace
   1.0.0 packages, releases, tags or assets. Any later withdrawal is a separate
   explicit decision. Record unpublished artifact identities and prepared notes.
7. **Report completion with evidence.** Identify source/artifact hashes, actual
   peer pins, checks, limits/skips/failures, breaking guide, clean Git and healthy
   ENCTX. List significant uncertain decisions for Kent's review. Complete this
   goal only after all remaining in-scope work passes; explicitly state that
   publication and post-publication checks are deferred.

## Deferred publication — outside this goal

After the side-chat plan is complete and publication is separately resumed,
reconcile its changes and rerun affected qualification. Do not publish npm packages,
push release tags, create GitHub releases or ungate release PR #527 in this goal.

Later publication must proceed CESR → KERI → Tufa from the same qualified commit,
verify registry availability/dependencies/dist-tags and release notes/assets,
compare qualified/workflow/npm/GitHub artifact identities, and run registry-only
installed runtime/CLI/declaration checks. Preserve 1.0.0 history; never replace
published bytes under an existing version. These publication-dependent checks
are not completion gates here.
