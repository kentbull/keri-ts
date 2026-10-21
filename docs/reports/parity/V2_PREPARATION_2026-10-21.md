# Unpublished 2.0.0 preparation qualification

Date: 2026-10-21. Publication is excluded from this goal.

## Source and artifacts

Qualified implementation/version source:
`f50fbf89e191f94c9cbe5233dec1b7ca45de62fa` (PR #671).
Later report/plan edits must be identified as documentation-only; source and
artifacts must not be described as tested at a different commit.

All three package/Deno/generated versions are 2.0.0; the private workspace
version remains 0.2.2. Changesets 3.0.3 consumed 148 pending notes into consolidated
final-state changelogs, preserving 1.0.0 history exactly. The migration guide
compares real published 1.0.0 npm declarations against the final installed 2.0.0
artifacts; it does not promote removed development-only APIs into release breaks.

| Tarball                | SHA-256                                                          |
| ---------------------- | ---------------------------------------------------------------- |
| cesr-ts-2.0.0.tgz      | c2e8af24d5502f8b14278bc9e9926b871e531ade1252e3dbbb60c4cc75f02443 |
| keri-ts-2.0.0.tgz      | 1a68f349b479fcd9fe45253c7f323fcc64a2cb54ede52dfa65a6a7dd7adeb193 |
| keri-ts-tufa-2.0.0.tgz | fe83246fc48a5f637cdae0698905f54ffb382c4761d74cae018056442ea2c6a8 |

Retained local evidence: repository `.cache/v2-qualified-f50fbf89/` contains
these tarballs, production dependency graph/audit, API inventory and runtime logs.
Native source execution used Docker's named `keri-ts-v2-execution` volume,
without host/bind-mounted databases. No native LMDB tests ran on Kent's Mac host.
Rebuilding or changing release source does not inherit these artifact identities.

## Checks

The [full PR gate](https://github.com/kentbull/keri-ts/actions/runs/39577695857)
passed all required unit/package and 16 extended interoperability owners, including
all three frozen profiles. The separate
[macOS workflow](https://github.com/kentbull/keri-ts/actions/runs/39577745817)
passed on macOS 26.6.2 arm64 (runner image 20261013.0424.1), Deno 2.8.2 and Node
25.9.0: quality, required source suites/parity, builds and installed native/runtime/
CLI/declaration probes. All three macOS-built tarballs match the Linux hashes above
exactly. Neither result replaces the local manual/endurance gates. The embedded DID Webs
resolver remains independently pinned to 8395277f (Python 3.13.16, KERIpy 1.2.14,
HIO 0.6.14, LMDB 3.0.0); that dependency-range qualification does not qualify
upstream 1.2.14 as a supported TCP release peer.

The clean Docker run `deno task test:qualification` passed **1,680 tests, zero
failed and zero ignored**: KERI 1,094; Tufa 97; CESR 484; CI scope tools 5.
KERI covered all 160 maintained files/27 owners (60 top-level commands, including
all three frozen-profile child runs). Its sequential phase took 24m47s on Deno
2.8.2, lmdb-js 3.5.3, LMDB data-v1/native 0.9.29 with NAPI enabled. Git was clean
before and after. Native-addon SHA-256:
`4d4ceb8039ac861be056a4916bdb951d471b754801c0a6f4238567acf885565f`.

Both manual gates ran: 64 delegated group events with changing membership, and
six actual Python witnesses/threshold six through inception and two rotations.
The separately run package-tool checks passed 2 tests. Quality/type/version,
format, lint and changeset checks passed. Raw logs, timing/source/native metadata,
profile provenance and exact counts are retained locally.

The two-signer direct/mailbox presentation fixtures logged auxiliary /receipt deliveries with
no advertised return end role; their actual presentation/witness assertions passed.
The diagnostic was retained, not suppressed or used as a semantic result.

The same Linux tarballs passed installed runtime/CLI/declaration checks on:

| Profile                 | Actual Node | Pointer compression |
| ----------------------- | ----------- | ------------------- |
| Declared floor / Debian | 20.3.0      | off                 |
| Current CI / Debian     | 25.9.0      | off                 |
| Alpine                  | 26.12.0     | off                 |
| Caged / Debian          | 26.10.0     | on                  |

Each fresh install used all three local tarballs. Runtime checks preceded compiler
tool installation: >16 MiB native LMDB read/reopen and owned bytes after writes,
AEID late-failure rollback and reopened signing, CESR tamper rejection, actual HTTP
POST/PUT and TCP close, Tufa credential authoring, once-mode verifier webhook and
accepted-anchor query, public embedding/cue-store lifecycle, Tufa HTTP startup,
strict TypeScript NodeNext without skipLibCheck, and Tephra validation/annotation.
Node floor/current, Alpine and caged image digests are retained in the local manifest.

Fresh installed production audit: 0 advisories (npm's recorded graph: 53 production,
23 optional, 75 total nodes). Ajv is 8.18.0, lmdb 3.5.3; both schema owners leave
$data disabled. This is an advisory snapshot, not proof of general security.

## Frozen peers

Actual imports and dependency records are retained in `reference-provenance.json`:

| Lane                  | Source commit                              | Python / HIO / LMDB      |
| --------------------- | ------------------------------------------ | ------------------------ |
| WOT main              | `c7e74adc3129ba36302db32e58056560b0927424` | 3.14.6 / 0.7.20 / 2.3.0  |
| GLEIF-IT 1.2.17       | `b8626e1d58770a4a480ea72a01acc5580278a9f2` | 3.13.16 / 0.6.21 / 1.7.5 |
| WOT 1.3.x             | `4ce4cc79e06653f77342be1bf604086b89b1f090` | 3.13.16 / 0.6.19 / 1.7.5 |
| Separate mailbox fork | `331f32e4de13cc5cb699587c5b1f1e5bc4468035` | 3.14.6 / 0.7.20 / 2.3.0  |

Main/legacy profile imports were checked against Git bytes. The local cached
mailbox fork records installed-distribution provenance/module hashes; macOS uses
an explicit fork checkout and verifies Git bytes. These evidence forms remain
labeled separately rather than claiming a local checkout comparison that did not run.

## Architecture and deliberate limits

ProtocolProcessor remains a cohesive shared dispatch/reply-capture/escrow owner.
It owns no global mutex or input/network lifetime. Concrete consumers take their
actual semantic dependencies; synchronous domain validation/commit prevents
suspended stale-state decisions. Removing this owner now would duplicate this
boundary or recreate it as another facade.

ESSR has no filesystem payload archive, ownership/recovery/publication machinery,
durable plaintext store or custom staging framework. Baser's ordinary `essrs.`
LMDB Texter set owns accepted/escrow evidence, retry and reconstruction, matching
pinned main. Authenticated decryption returns caller-owned bytes. Incoming and
reconstructed digest checks and recipient/envelope authentication remain.
The known repeated/alternate-fragment limitation is inherited deliberately from
main's ordered-set representation; it is not silently normalized or hidden by
stricter protocol acceptance. The existing
[upstream issue report](../essr/KERIPY_REPEATED_FRAGMENTS_2026-10-20.md) contains
the concise reproduction and ordered-sequence recommendation. Nothing was submitted
upstream. Direct legacy ESSR LMDB interchange remains deferred; legacy wire was
qualified independently.

Autonomous legacy TEL backing is removed; observer verification/replay remains.
The separate OOBI store/opener and duplicate table construction are removed.
CLI cleanup uses canonical Baser.oobis through normal writable startup, accepting
habitat reload, cleanup and table initialization even during preview. Missing
storage fails. Close errors remain failures, without implying mutation rollback.
The arbitrary timer drain is removed; close follows the binding callback rather
than elapsed time. The lmdb-js internal native-close catch limits what a wrapper can observe;
qualification establishes the explicit observable-error contract, not detection
of binding-suppressed failures.

## Significant uncertain decisions for Kent's review

- Pinned main's CLI mailbox multipart attachment context still needs upstream
  agreement. Do not infer a genus from fallback parsing or relax authentication.
  Keep those URL/framing-blocked CLI lanes unqualified, separately from passing
  public-API credential/wallet and mailbox-fork CLI evidence. The
  [CLI limitation report](../interop/KERIPY_MULTISIG_VCP_GENUS.md) retains exact
  pins/reproducers and protected-source approval boundaries.
- ESSR set semantics match main but cannot preserve every repeated/alternate
  fragmentation. A small upstream sequence-storage correction is worth proposing;
  do not submit or change this agreed storage contract without separate direction.

## Deferred publication

Native rip/bup/upd-dependent CLI/wallet/lifecycle completion remains with the
[side-chat roadmap](../../plans/credentials/NATIVE_V2_ACDC_REGISTRY_ROADMAP.md).
Retained partial native APIs/tests are not a complete native credential workflow.
Retries, durable outboxes, delivery acknowledgements, generic database providers
and broad Python porting remain deferred. No npm publish/unpublish, release tag,
GitHub Release or upstream submission occurred in this goal.

Registry readback before completion: all three npm latest tags remain 1.0.0;
no 2.0 release tags exist. Existing 1.0.0 GitHub release/asset identities are retained
in the local evidence manifest. PR #527 was not manually ungated or modified.
The closing cut changes documentation/learnings only, with no source/build inputs
changed from the qualified commit. Final synchronized-master identity, byte-identical
rebuild confirmation and healthy ENCTX readback belong in the local manifest and
completion response; this report does not pretend native tests ran at a later SHA.
