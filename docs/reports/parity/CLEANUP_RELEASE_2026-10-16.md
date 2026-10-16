# Cleanup release qualification — 2026-10-16

Release baseline: `c7c2750c14e0bae1e85a3c762391006c53b85d66`, delivered by
[#347](https://github.com/kentbull/keri-ts/pull/347). CESR, KERI and Tufa are
**1.0.0**, explicitly selected by the maintainer. The documented breaking removals
define this API/CLI baseline; old keri-ts APIs/data have no compatibility or
migration promise. This report supersedes the October 14 checkpoint for current
readiness without rewriting its historical measurements or failures.

## Publication and physical artifacts

| Package       | Version | Release                                                                     | Verified SHA-256                                                   |
| ------------- | ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| cesr-ts       | 1.0.0   | [cesr-v1.0.0](https://github.com/kentbull/keri-ts/releases/tag/cesr-v1.0.0) | `3d58128c5674ca37bd13e7d46c5e271f480fe3031106f3a74eef15d0733ee5b9` |
| keri-ts       | 1.0.0   | [keri-v1.0.0](https://github.com/kentbull/keri-ts/releases/tag/keri-v1.0.0) | `6f2f530a7f3210db266d1c9ecaa4627f7c8a49d5c5717ce790dad3a205fe966a` |
| @keri-ts/tufa | 1.0.0   | [tufa-v1.0.0](https://github.com/kentbull/keri-ts/releases/tag/tufa-v1.0.0) | `6e0e0839154373ca9d6fc3597334adb00d1dc5c4e603aff4eef1c2176ce4a513` |

For each package, the successful release workflow's uploaded tarball, npm registry
archive and GitHub release asset are byte-identical. Registry SHA-512 integrity
and SHA-1 metadata independently match; every annotated tag resolves to the
release commit. KERI uses CESR >=1.0.0 <1.1.0; Tufa pins CESR and KERI 1.0.0.
Build provenance differs from provisional local tarballs and is not assumed equal.
Tufa's first tag workflow stopped before publication because its global-install
fixture required the removed CESR Effection adapter peer. [#521](https://github.com/kentbull/keri-ts/pull/521) deletes that
obsolete check/install; actual global CLI/HTTP smoke passes at minimum/current
Node. The recovery workflow runs at `765bd730a4e6bfe1173db5817af2ae81728eb284`, with no package,
manifest or build-input changes from the release tag. Its actual provenance is
recorded separately; the existing tag remains at the qualified baseline.

## Executed gates and source identity

[Full CI 38924471212](https://github.com/kentbull/keri-ts/actions/runs/38924471212)
passes all **19 jobs, 1,508 cases, zero ignored** at `7b64f3b1`. The checkout merge
`67ba05c7` has the same tree. A final documentation-only count correction at
`0cec0d9b` has identical package/script/config inputs, seven passing local tooling
cases and green [scoped CI](https://github.com/kentbull/keri-ts/actions/runs/38925671114).
The merged release tree matches that final head exactly.

The separate clean source/manual aggregate at `7217902a` passes **1,509 cases**:
943 KERI cases across all 25 owners/142 files, Tufa 73, CESR 487 and tooling 6.
It includes the weighted delegated group with 64 events and six-witness,
threshold-six inception/two rotations. All 771 copied inputs match committed
source; local LMDB runs use named Docker volumes without macOS binds. Source
qualification uses Deno 2.8.2, LMDB-js 3.5.3 and its verified data-v1/NAPI addon.
The subsequent #520 fixture-only change is separately qualified by all four
witness CLI cases and then the full final CI. The inventories differ: hosted full
CI excludes two manual cases and includes one additional package-tool regression.

Initial environment failures remain recorded: stale copied-tree Git labels were
rejected before execution; four embedded DID cases refused Python 3.14 and passed
on identical source under supported Python 3.13. Generated Python bytecode was
inspected/removed and is now ignored. The original aggregate tally omitted a
158-passed summary containing child-step notation; the corrected count changes
no execution evidence. One final-CI witness startup failure led to #520's
bind-checked, distinct-port fixture setup and retained child diagnostics; its
original cause was unproven because the old fixture discarded process output.
No acceptance assertion, deadline or participant count was weakened.

Fresh versioned candidates and final **registry-only** installations pass on
Node **20.3.0** and **26.12.0 Alpine**. Both exercise >16 MiB native LMDB read/reopen,
owned bytes after replacement, public signing/tamper refusal, actual TCP send and
joined close, encrypted CLI/HTTP startup, and strict NodeNext declarations without
skipLibCheck. Runtime checks precede compiler-tool installation. The advertised
Node floor remains >=20.3. Release workflows repeat package-owned checks and smoke
the exact publish artifact before publishing.

## Supported scenarios and limits

| Classification                       | Qualified behavior or explicit boundary                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Supported                            | Complete-enclosure v1/v2, qb64/qb2 and nested/ESSR decoding; independent child proofs; actual HTTP/TCP verification, persistence/reopen/replay, half-close, directional failures and joined cancellation.                                                                                                                                                                                                                              |
| Supported                            | Sixty-two pairwise TS/Python disclosure cases: apply/offer through admit, legal/illegal spurn, I2I/NI2I/E1E, nested AND/OR, chained/shared ancestors, schema/proof/conversation refusals, replay and progressive multi-attribute disclosure. Eight focused cases reveal nested city/email and role in increasing then reduced subsets on the same two-node signed chain, preserving SAIDs, hidden values and older per-grant evidence. |
| Supported                            | TS DI2I approved delegation chains (17 dedicated cases) and NOT (15) over authenticated node validity and receiver-accepted issued/revoked facts. Missing, malformed, forged or unknown evidence never satisfies negation.                                                                                                                                                                                                             |
| Supported                            | Twenty-two KRAM/composed cases distinguish single/group admission, replay/timeliness/refusal, provider restart, three-witness controllers, pairwise credential conversations through a real Python mailbox and TS mailbox presentation cutoffs. Delayed observer evidence, reopen and replay preserve immutable threshold-completion receipt time.                                                                                     |
| Intentional difference               | TS public RegistryObserver intake extends the inspected Python receiving integration. TS DI2I/NOT are excluded from Python interop while unsupported there. Framed POST, supported v1/v2 differences and supplied bound JSON schema resources retain their explicit profiles.                                                                                                                                                          |
| Reference stub/gap                   | xip/pro/bar and the inspected public foreign-v2 registry receiver are not certified by KRAM authentication or seeded accepted rows. Native default EXN builder/self-decoder and generated nonJSON default-schema limitations remain distinct.                                                                                                                                                                                          |
| Unfinished outside this release goal | Global TEL freshness, arbitrary recursive nesting depth, every topology/crash cross-product, legacy V1 REV peer fanout and automatic bare-schema host discovery are not claimed. Broader parity backlog remains separate.                                                                                                                                                                                                              |
| Unqualified                          | Hosted macOS/full Sally workflows, physical KERIpy LMDB cross-opening, universal memory bounds and exactly-once business delivery are not established by these results.                                                                                                                                                                                                                                                                |

## Retained architectural constraints

Concrete KERIpy-shaped owners exchange data records and Deck/cue flows wired by
composition. Reactor orders protocol intake/escrows; lower transport has no
AgentRuntime dependency. CLI and long-lived hosts share workers; actual consumers
own cancellation and joined I/O/store cleanup. Accepted state and cues publish
after the owning transaction commits; independent stores are not one transaction.

Application budgeting, estimates, quotas, outboxes, unsupported consumer/business
acknowledgements, progressive parser cursors/staging, forwarding-only delivery
layers and serial whole-runtime pumps remain removed. Native backpressure and
protocol escrows/caches/cursors remain. Complete buffering permits memory/latency
proportional to enclosure size; no early incomplete-enclosure child delivery,
constant-memory giant-group or all-group rollback promise survives. ADR-0013 and
ADR-0012 govern future changes; historical experiments do not authorize restoration.

## Reference provenance and bug boundaries

Frozen tables/CESR use upstream `7143832813cac6a394ab1faf9be83bb3372be87c`.
Functional CLI/mailbox interop uses kentbull/keripy mailbox-impl
`331f32e4de13cc5cb699587c5b1f1e5bc4468035`, rebased on observed upstream main
`c102367ea0b8416ffb3c01403d18b3fd4a6a38bf`. Actual Python 3.14.6 imports match
fork Git bytes; mailbox-main-interop is retired. Embedded resolver `8395277f`
uses separate Python 3.13.16, installed KERIpy 1.2.14/HIO 0.6.14 and recorded
module paths/hashes (`installed-record`, not Git equivalence). Historical
927/b08/Sally references retain their own labels.

The release fixes v2 nested mailbox forwarding, historical witness cohort/threshold
selection through accepted event ancestry, missing DI2I/NOT behavior and issuer/
registry authentication boundaries. The narrowly authorized Python mailbox fix
passes cf=hby.cf and enableKram=True into Kevery, matching setupWitness; otherwise
configured KRAM was bypassed. Python was not widened to manufacture operator or
foreign-registry parity. Python attachment regrouping preserves signed bodies,
signatures, ordered state proofs and source seals; wrapper byte identity is not
required. The workspace-lock mirror defect has a red/green actual-CLI regression.
The expanded installed smoke found a coverage gap, not an additional native defect.
