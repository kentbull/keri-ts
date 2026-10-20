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
| CESR/live wire probes   | Upstream 714                 | CESR reference / qualifiers  |
| Historical KERI vectors | Upstream 927                 | Fixture generators           |
| macOS compatibility     | Mailbox fork                 | `macos-compatibility.yml`    |
| Sally CLI harness       | Historical 98                | `vlei-tufa-sally-interop.sh` |
| Embedded DID Webs       | Resolver 839 / KERIpy 1.2.14 | Separate Python environment  |

## Explicit 2.0.0 release peer profiles

`scripts/ci/keripy-reference.json` freezes independent upstream profiles selected
on 2026-10-20. These supplement the mailbox-fork default; they do not relabel it.

| Profile | Upstream source                                        | Python | HIO    | LMDB  | Falcon |
| ------- | ------------------------------------------------------ | ------ | ------ | ----- | ------ |
| `main`  | `424a50c03421165c5f289e07a341bd57b8d8ab78`             | 3.14   | 0.7.20 | 2.3.0 | 4.3.1  |
| `1.2`   | tag 1.2.14, `bab95c16e949b61398129a3e41a8f68bad84c94f` | 3.13   | 0.6.14 | 1.7.5 | 4.3.1  |
| `1.3`   | tag 1.3.6, `4ce4cc79e06653f77342be1bf604086b89b1f090`  | 3.13   | 0.6.19 | 1.7.5 | 4.3.1  |

Prepare each clean checkout with its own venv, install it editable with the
listed dependency pins, then set `KERIPY_INTEROP_PROFILE`,
`KERIPY_INTEROP_ROOT` and `KERIPY_INTEROP_PYTHON` before running
`deno run -A scripts/ci/run-keri-test-group.ts interop-reference-profiles`.
Missing environments, mismatched commits/interpreters/dependencies and changed
imported Git bytes fail before state creation. The probe records actual imports,
dependency paths/hashes and init/incept/export command discovery.

The focused owner proves CLI init/incept/export, signed KEL intake and real v1
witness startup/OOBI. It does not qualify credential lifecycles. Old CLIs omit
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
