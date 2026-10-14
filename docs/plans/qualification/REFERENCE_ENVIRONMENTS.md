# Reference environment qualification inventory

Owner: [phase 7](QUALIFICATION_PLAN.md). Pins below are the observed continuation
baseline, not proof of current execution. Re-verify each path and **actual imported
modules** before changing a pin or claiming qualification. Upgrade applicable
paths to the approved 714 target, or document why historical compatibility is retained.

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

## Immutable authorities

- Active upstream: `7143832813cac6a394ab1faf9be83bb3372be87c`.
- Historical upstream: `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
  Existing KERI registry/IPEX/KRAM/replay fixtures retain their actual source
  labels and reproducibility pins. They do not alone qualify changed 714 behavior.
- Mailbox fork: `kentbull/keripy` `b08ddeb047fd865d60affe82a0dc77f5efaf4672`,
  based on upstream 927. Ports mailbox commits `1faba4f2`/`9924fffa`, adapts
  nested messages, and adds explicit mailbox/credential protocol selection,
  receipt lookup repair, export genus selection, JSON slash-topic queries and
  protocol-specific admit rehydration. Keep this **fork-on-main** evidence
  separate from unmodified-upstream evidence.
  Retain this compatibility target because unmodified 714 lacks the required
  mailbox commands/extensions. Its 927 ancestry does not qualify 714 schema logic;
  current-upstream probes and composed qualification supply that evidence separately.
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

## Observed import qualification

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

Hosted macOS quality/packaging, extended interop, full Sally workflows and the
embedded resolver matrix remain unqualified by these import smoke checks. Sally
`KLI_CMD`/`KERIPY_DIR` overrides and runnable-cache markers still need actual-import
verification before a full harness result can establish its selected peer.
