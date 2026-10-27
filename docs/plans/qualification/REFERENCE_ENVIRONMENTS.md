# Reference environment qualification inventory

Planning constraint: the [accepted simplification](../PARITY_ROADMAP.md) supersedes older
architecture requirements. Concrete owners, one worker model and complete-enclosure
buffering replace speculative frameworks; protocol correctness and real cleanup remain.

Owner: [phase 7](QUALIFICATION_PLAN.md). Pins below are the observed continuation
baseline, not proof of current execution. Re-verify each path and **actual imported
modules** before changing a pin or claiming qualification. Frozen vectors, current
upstream, the functional mailbox fork and embedded resolver dependencies are distinct
references; one result must not be attributed to another.

| Environment             | Declared target              | Owning entrypoint            |
| ----------------------- | ---------------------------- | ---------------------------- |
| Ordinary table CI       | Upstream 714                 | `pr-stage-gate.yml`          |
| Extended interop        | Mailbox fork                 | `keri-extended-interop.yml`  |
| Shared local CLI        | Mailbox fork                 | `interop-test-helpers.ts`    |
| ESSR storage            | Actual pinned-main Baser     | `interop-essr-storage` owner |
| CESR/live wire probes   | Upstream 714                 | CESR reference / qualifiers  |
| Historical KERI vectors | Upstream 927                 | Fixture generators           |
| macOS compatibility     | Mailbox fork                 | `macos-compatibility.yml`    |
| Sally CLI harness       | Historical 98                | `vlei-tufa-sally-interop.sh` |
| Embedded DID Webs       | Resolver 839 / KERIpy 1.2.14 | Separate Python environment  |

## Explicit 2.0.0 release peer profiles

`setup-keripy-main-peer` prepares a separate main checkout/venv for the
ESSR storage owner in PR, extended and macOS workflows. The suite
runner scopes it to those owners; it does not change other suites' mailbox-fork or explicitly selected wire
peer. Local direct storage runs require the explicit `main` profile/root/Python;
suite runs may instead supply `KERIPY_MAIN_ROOT` and
`KERIPY_MAIN_PYTHON`. No legacy Baser qualification is implied.

The same action's `profile: candidate` input prepares the ACDC v2 candidate for
`interop-native-registry` and `interop-ipex-disclosure` in PR and extended workflows. Local owner runs require
`KERIPY_CANDIDATE_ROOT` and `KERIPY_CANDIDATE_PYTHON`, or explicit
`KERIPY_INTEROP_PROFILE=candidate` with its root and interpreter. Main setup cannot
replace this selection; missing candidate configuration and mismatched source/imports
fail before protocol state. The native-registry owner covers reciprocal proof
intake, protected custody handoff with fresh-process reopen, and reciprocal
registrar/observer service boundaries. Its stores and service processes remain
owned by the test's temporary scope.

The `interop-kram` owner retains its mailbox-fork environment. Its pairwise IPEX
file separately verifies the candidate Python IPEX actor, while the provider and
witnesses still use the fork: the candidate has no mailbox host. PR and extended
workflows prepare the candidate for that composition too; the other KRAM files
keep their existing peer. No wire translation connects the two runtimes.

The existing manifest records the six candidate source pins, the exact
[R/W register](https://github.com/kentbull/enctx/blob/aced46824ad3d5b142e2cb5e7755effb7fb1d6f7/plans/keri/acdc-v2/python-mvp-and-typescript-plan.md#wire-profile-posture-and-conceptual-provenance)
and [specification reference](https://github.com/kentbull/enctx/blob/ee9f9b861f256b02fb208d08e84fcd5594ce2079/plans/keri/acdc-v2/keri-acdc-v2-spec-v1.1-gap-closure-roadmap.md).
These are a selected interoperability target, not a conformance claim. The five IPEX
disclosure files use the candidate's flat-`dp` profile; the main and v1 frozen matrices
remain independent.

The integrated ACDC v2 target selects core `8f9734326314287a3dbd548b3e0cf4b8a6571add`.
Application merge pins select the declared consumer family. The editable-source
CI setup verifies the selected source/imports;
it does not establish that the applications' declared dependencies resolve to the
same installed family. Preserve that distinction in the final results.

`scripts/ci/keripy-reference.json` freezes independent release profiles selected
on 2026-10-20; main advanced to c7e74ad before final qualification. These supplement the mailbox-fork default; they do not relabel it.

| Profile | Source                                                   | Python | HIO    | LMDB  | Falcon |
| ------- | -------------------------------------------------------- | ------ | ------ | ----- | ------ |
| `main`  | `c7e74adc3129ba36302db32e58056560b0927424`               | 3.14   | 0.7.20 | 2.3.0 | 4.3.1  |
| `1.2`   | GLEIF 1.2.17, `b8626e1d58770a4a480ea72a01acc5580278a9f2` | 3.13   | 0.6.21 | 1.7.5 | 4.3.1  |
| `1.3`   | tag 1.3.6, `4ce4cc79e06653f77342be1bf604086b89b1f090`    | 3.13   | 0.6.19 | 1.7.5 | 4.3.1  |

The `1.2` target is GLEIF-IT/keripy with `gleif-keri`/`gleif-hio` distributions;
main and 1.3 retain WebOfTrust/keripy. It replaces the original 1.2.14 pin after
its Directant dropped queued input on EOF. `qualify-reference-profiles.py` prepares
these three isolated environments and the separately pinned candidate. Candidate-only
ACDC v2 group cases are skipped in the older profiles; those skips are not
qualification credit for the candidate.

Prepare each clean checkout with its own venv, install it editable with the
listed dependency pins, then set `KERIPY_INTEROP_PROFILE`,
`KERIPY_INTEROP_ROOT` and `KERIPY_INTEROP_PYTHON` before running
`deno run -A scripts/ci/run-keri-test-group.ts interop-reference-profiles`.
Missing environments, mismatched commits/interpreters/dependencies and changed
imported Git bytes fail before state creation. The probe records actual imports,
dependency paths/hashes and init/incept/export command discovery.

The focused owner proves CLI init/incept/export, signed KEL intake and real v1
witness startup/OOBI, ordinary POST and whole-stream PUT in both directions,
and real TCP intake on the GLEIF 1.2.17 target. It does not qualify credential lifecycles. Old CLIs omit
the unsupported protocol `--version` option. Their export genus is v1; current
main/fork exports use v2 attachments even for v1 bodies. Supply that known
context before the unchanged CLI stream, as the existing export-parity owner does.

## Immutable authorities

- Frozen upstream table/CESR baseline: `7143832813cac6a394ab1faf9be83bb3372be87c`.
  This is the reproducible fixture target, not a claim that upstream main stopped there.
- Mailbox-fork upstream base observed 2026-10-16: `c102367ea0b8416ffb3c01403d18b3fd4a6a38bf`.
  The mailbox branch is rebased on this main. Keep its results separate from
  unmodified-upstream probes and frozen-table comparisons.
- Historical upstream: `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
  Existing registry/IPEX/KRAM/replay fixtures retain their actual source labels
  and reproducibility pins; they do not alone qualify later upstream behavior.
- Current mailbox fork: `kentbull/keripy` branch `mailbox-impl`, commit
  `331f32e4de13cc5cb699587c5b1f1e5bc4468035`. The shared local helper, extended
  interop and macOS workflow select `scripts/ci/keripy-reference.json`. The
  consolidated branch supplies mailbox commands and the tested KRAM configuration
  repair. The redundant `mailbox-main-interop` branch has been removed. Functional
  fork results qualify the selected fork, not unmodified upstream.
- Historical mailbox fork: `b08ddeb047fd865d60affe82a0dc77f5efaf4672`, based on
  upstream 927. Earlier import/protocol observations below retain that label;
  it is no longer the active shared CLI target.
- Historical 450: `450ae1c2a7eac61d92bc7b830cb6883c41e6a798`, retired from
  macOS selection. `test:quality` includes `interop-parity`, whose existing
  `interop-kli-tufa.test.ts` exercises mailbox operations in both directions.
  The workflow PATH and shared helper now select the same mailbox fork, with an
  explicit checkout and editable install. This does not qualify unmodified 927.
- Historical Sally peer: `98b88cf73a746813a8719f05264400467a474c05`. Retain
  this default for the existing Sally 0.9.0 / vLEI 1.0.3 / legacy-counter
  harness until that actual mailbox/IPEX/credential path qualifies a replacement.
  Its cached CLI import smoke is insufficient evidence to migrate the harness.
- DID Webs resolver: `8395277f32b37129fa6ef734c9f3902bb6cbbcbc`; its pinned
  `pyproject.toml` declares `keri>=1.2.13,<1.3`. KERIpy 1.2.14 is an intentional
  dependency-range selection, separate from the selected CLI source. The shared
  resolver helper pins HIO 0.6.14 and selects Python 3.13; CLI selects 3.14.

## Closure gates

1. Inventory ordinary CI, extended jobs, macOS, standalone/local harnesses,
   resolver caches and embedded dependencies. Changing KLI does not update DID Webs.
2. Verify interpreter, checkout revision and loaded module paths/bytes. Lazy imports
   count too. A source pin alone is insufficient; console launchers must preserve
   the CLI's exit status.
3. macOS checks out the fork and verifies imports before both PATH and shared
   helper use, including cache hits. Preserve the separate resolver interpreter.
4. Preserve fork branch/baselines. Do not chase moving upstream main mid-run.
5. Record per-environment success, failure, skip and retained historical rationale
   in the final report. Declared targets in this table are still unqualified
   unless supported by the corresponding actual-path run.

## Current qualification evidence

PR #701 merged as `f716a71996370ecedc8847548bbb077ed6194df2`, with the same tree
as tested `fda9bbe83b8e631b22a7926f0151d10452654153`.
[Full CI 40596875506](https://github.com/kentbull/keri-ts/actions/runs/40596875506)
passed on Deno 2.9.8: nine unit groups reported 1,538 passed, zero failed/ignored;
17 interop owners reported 193 passed, zero failed and three expected candidate-only
group skips on older main/1.2/1.3 profiles. All eight package smokes and strict
NodeNext declarations passed on Node 20.3.0 Bookworm, 26.12.1 Alpine and
26.10.0 NodeCaged. Earlier Deno 2.8 results are not the final qualification credit.

The coherent Python family at core `8f973432` passed its 46 installed consumer
owners: Dolly 2, Locksmith 32, Registrar 3, Observer 7 and Witness 2. All five
consumer declarations and installed `Requires-Dist` selected that exact core;
`pip check` passed. All 449 Python files matched committed source, normal wheels
and actual installed imports before and after testing. Seven adapter source files
also matched their installed wheel (456 Python/adapter files total). All 1,429
installed npm files matched the tarballs built from committed source. The installed
application runtime used Node 26.10.0 and Python 3.14.8.

All eight application paths passed with three witnesses/quorum two, explicit
consent, immutable-view checks and two accepted Dolly hooks per path:

| Existing scenario                         | Installed application path                                               | Result |
| ----------------------------------------- | ------------------------------------------------------------------------ | ------ |
| `holder-full-then-graduated`              | Tufa issuer → Locksmith Qt holder → Dolly                                | Passed |
| `locksmith-issuer-through-holder`         | Locksmith issuer → Tufa holder → Dolly                                   | Passed |
| `holder-partial-then-onward`              | Tufa issuer → Locksmith holder → Dolly                                   | Passed |
| `holder-supplied-state-opening`           | Python KLI issuer → Tufa holder, including actual unblind → Dolly        | Passed |
| `holder-provisioned-state-derivation`     | Python KLI issuer → Tufa holder, including custody/reopen/derive → Dolly | Passed |
| `holder-selected-discloser-openings` (S5) | Tufa issuer → Locksmith Qt holder and designated presenter → Dolly       | Passed |
| `holder-selected-discloser-derivation`    | Tufa issuer → Locksmith Qt holder and designated presenter → Dolly       | Passed |
| `holder-selected-discloser-derivation`    | Python KLI issuer → Tufa holder and distinct Tufa presenter → Dolly      | Passed |

Seven paths used TS
`2f6e74be990d88672b8d9674c5177a28b2ce327e` with harness
`631f9c7c3216f491125b476a68eaa9e843406071`. Final S5 used a core tarball built from
`7adf86791c736b26860003173654eeeb60d91255`, the other seven unchanged tarballs,
and harness `0221d2df7e6279bf27455291c0ce6eb99ed47de2`. The seven earlier paths
were not rerun with that core artifact: its only production delta was the witness
inspector, which they do not invoke; an installed public Node HTTP control verified
both genus 1 and 2 separately. Changes after `7adf8679` were tests, runtime pinning
and docs; product bytes remained identical. These are the credited sources and
limits, not a claim that all eight paths ran at the final merge SHA.

Product artifact SHA-256 values recorded for these installed runs follow. These
are qualified local builds, not published releases. The five consumer wheel build
heads were tree-identical to the application merge pins in the reference manifest.

| Artifact                                      | SHA-256                                                            |
| --------------------------------------------- | ------------------------------------------------------------------ |
| `cesr-ts-2.0.0.tgz`                           | `fc042321eb08eccf4b2eab32a7a7bc5775e17712e3de3edc653a5bf994d66cc1` |
| `keri-ts-2.0.0.tgz`                           | `523463dc8616e9962f4738c953a9a18ac3406458b7bcc7e14e6f7b5d5cbf1292` |
| `keri-ts-hosting-2.0.0.tgz`                   | `44265ddf292e1609434500a56967ed9a1dbdef9d8abcaf97a0035c553fc957f2` |
| `keri-ts-observer-2.0.0.tgz`                  | `9a0d53297d2b7b6f0be8dbde2ba1d09a1272c4c6fad738db0f440d4c37f27567` |
| `keri-ts-registrar-2.0.0.tgz`                 | `c50d2e28a0f7a757852f3bdfc504b363575bfadf1683501e447b4a6ab9b14046` |
| `keri-ts-tufa-2.0.0.tgz`                      | `50067ff5ed53fefc73f53d952641221d94d96622c470ddd3546c93645f947970` |
| `keri-ts-verifier-2.0.0.tgz`                  | `102632b2b011a6d0f6d95ba0db451cb302d7d308ab6de804a1b18433baa6e4f6` |
| `keri-ts-wallet-2.0.0.tgz`                    | `6759304ab259cc3ab95a556cc79367bd17ac0653adcfbf75b68732701e8d7fc3` |
| `dolly-0.1.0.dev0-py3-none-any.whl`           | `2152d6ee50171815d926c814393baa791a30b0ba55799d0b7e03a98fd679dcb6` |
| `keri-2.1.0.dev1-py3-none-any.whl`            | `5487adc00c186e55ff6f789cd9c1d4bca62e352a15af2908257ad26ca0536d41` |
| `kf_observer-0.0.1-py3-none-any.whl`          | `b49bbbd44e22e4d306e3b0b312fc324c6a0b4393a844ab9d075c8786f8041e90` |
| `kf_registrar-0.0.1-py3-none-any.whl`         | `a22e192609a4879b6e4945365c2a990888a4eae6ad44daabbeb3bf514f825722` |
| `locksmith-0.0.1-py3-none-any.whl`            | `814014ad6e7e415dee4933a90a088d604942d5ade461a945ca3c207ac747dfee` |
| `witopnet-0.0.1-py3-none-any.whl`             | `fa84fd34757bcbdf87c08fca19241baf4ece9cb158052b3dd303015d08197a94` |
| `keri-ts-2.0.0.tgz` (earlier `2f6e74be` core) | `6874ab833e491c4d7f41730cb273fe7db8189030b2a57e294e25581ff56ea1c9` |

The following 1.0.0 results are historical evidence for their recorded sources.

The 2026-10-16 clean source candidate `7217902a` completed all 25 KERI owners:
943 cases over 142 files, including pairwise graduated disclosure, KRAM, composed
mailbox, DID resolution and the local manual delegation/witness owners. Together
with CESR, Tufa and tooling, 1,509 cases passed with none ignored. Package
implementation/test inputs were unchanged through merged #519 (`b1b3d8dc`).

The shared mailbox CLI imported the selected `331f32e4` source with verified Git
bytes under Python 3.14.6. The separate four-case embedded resolver matrix passed
with Python 3.13.16, resolver `8395277f`, site-packages KERIpy 1.2.14 and HIO 0.6.14.
Its import probe records actual paths and SHA-256 hashes as `installed-record`;
it does not establish KERI Git-byte equivalence. CLI PYTHONPATH must not override
that separate resolver environment. Ignore generated fixture bytecode as test output.

The first copied-workspace invocation refused stale/dirty Git labels before KERI
execution. A clean exact-source retry passed all other owners but found that the
resolver cannot run on Python 3.14. Installing its supported interpreter and
rerunning the same four cases resolved those environment failures. Raw failures,
771-file source proofs, actual-import records and the transparent aggregate are
retained in the dated cleanup qualification artifacts. The original count omitted
a 158-passed summary containing child-step notation; the corrected count does
not change execution or source evidence. This is an aggregate after
environment repair, not a claim that the first command succeeded. Final 1.0.0
artifacts, dependencies, CI and publication are qualified in the
[release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md). Future runs
need their own source/import/artifact evidence.

## Historical import observations (2026-10-13)

Local continuation checks on 2026-10-13 used the existing provenance probe and
uncommitted actual-command probes. No hosted workflow was dispatched.

| Env                | Start | CLI | Evidence                  |
| ------------------ | ----: | --: | ------------------------- |
| macOS 714          |    98 |   — | Git bytes; current source |
| macOS 927          |    98 | 193 | Historical Git bytes      |
| macOS b08          |    99 | 195 | Git bytes; temp source    |
| Linux 927          |    98 | 193 | Git bytes; fork deps      |
| Linux b08          |    99 | 195 | Git bytes; own venv       |
| macOS Sally 98     |    99 | 195 | Installed pin + Git bytes |
| macOS resolver 839 |    37 |   — | Installed hashes only     |

Start/CLI count loaded KERI modules at startup and actual command discovery.
The clean local 714 checkout and all 98 startup imports matched Git bytes. Ten
CESR corpora were regenerated with their actual source guards at 714; all wire
and semantic values matched their 927 predecessors. Generated tables also matched.
The local probe uses Python 3.14.2; full runtime qualification remains separate.
Linux Python 3.14.6 with actual 714 source and fork-environment dependencies also
accepted 12 stored nested rows, 15 proof-factor exchanges/replays and 12 multisig
wrappers/child replays through the maintained live qualifiers. Their imported
KERI source checks matched 714. The native default EXN builder still fails its
independent decoder and remains an explicit reference limitation.
927 used `kli --help`; b08 and Sally 98 used `kli mailbox start --help`.
Every source/command comparison matched the selected pin's Git bytes. macOS
used Python 3.14.2; Linux used 3.14.6. macOS b08 used a temporary clean checkout
with existing interpreter dependencies; Linux 927 used explicit source with
fork venv dependencies. Linux b08 used its clean checkout and own venv.

Sally 98 startup recorded its installed direct-url commit; the independent
command probe additionally verified all imported KERI bytes against Git. Resolver
839 used Python 3.13 and its actual checkout with site-packages KERIpy 1.2.14 and
HIO 0.6.14, without KERI Git provenance; resolver command discovery was not run.

`scripts/ci/probe-keripy.py` imports KLI startup before recording module paths
and SHA-256 hashes. With `--root`, every loaded KERI file must stay inside the
selected package and match the pinned Git bytes. Installed mode records hashes
and direct-url metadata, labeled `installed-record`; that alone does not prove
Git equivalence. The CLI wrapper preserved help success and invalid-argument
exit status 2. Lazy command imports require independent actual-command checks,
not extrapolation from startup counts.

Hosted macOS quality/packaging and the full Sally workflow remain unqualified by
these historical import smoke checks. Current Linux extended-interop and embedded
resolver execution are recorded separately above. Sally
`KLI_CMD`/`KERIPY_DIR` overrides and runnable-cache markers still need actual-import
verification before a full harness result can establish its selected peer.
