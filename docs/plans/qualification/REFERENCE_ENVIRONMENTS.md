# Reference environment qualification inventory

Owner: [phase 7](QUALIFICATION_PLAN.md). Pins below are the observed continuation
baseline, not proof of current execution. Re-verify each path and **actual imported
modules** before changing a pin or claiming qualification. Upgrade applicable
paths to the frozen target, or document why historical compatibility is retained.

| Environment             | Declared target              | Owning entrypoint            |
| ----------------------- | ---------------------------- | ---------------------------- |
| Ordinary table CI       | Upstream 927                 | `pr-stage-gate.yml`          |
| Extended interop        | Mailbox fork                 | `keri-extended-interop.yml`  |
| Shared local CLI        | Mailbox fork                 | `interop-test-helpers.ts`    |
| Independent wire probes | Upstream 927                 | `scripts/reference-*.py`     |
| macOS compatibility     | Historical 450               | `macos-compatibility.yml`    |
| Sally CLI harness       | Historical 98                | `vlei-tufa-sally-interop.sh` |
| Embedded DID Webs       | Resolver 839 / KERIpy 1.2.14 | Separate Python environment  |

## Immutable authorities

- Upstream 927: `927c0cb8794d7c84fc17143c67df64aab9deda6c`.
- Mailbox fork: `kentbull/keripy` `b08ddeb047fd865d60affe82a0dc77f5efaf4672`,
  based on upstream 927. Ports mailbox commits `1faba4f2`/`9924fffa`, adapts
  nested messages, and adds explicit mailbox/credential protocol selection,
  receipt lookup repair, export genus selection, JSON slash-topic queries and
  protocol-specific admit rehydration. Keep this **fork-on-main** evidence
  separate from unmodified-upstream evidence.
- Historical 450: `450ae1c2a7eac61d92bc7b830cb6883c41e6a798`.
- Historical 98: `98b88cf7` (resolve full pinned revision from the harness).
- DID Webs resolver: `8395277f`; declared `keri>=1.2.13,<1.3`. The previously
  inspected isolated Python 3.13 environment imported KERIpy 1.2.14 and HIO
  0.6.14 from site-packages, without Git provenance. Reinspect independently.

## Closure gates

1. Inventory ordinary CI, extended jobs, macOS, standalone/local harnesses,
   resolver caches and embedded dependencies. Changing KLI does not update DID Webs.
2. Verify interpreter, checkout revision and loaded module paths/bytes. Lazy imports
   count too. A source pin alone is insufficient; console launchers must preserve
   the CLI's exit status.
3. macOS installs an older KLI on PATH while shared helpers select a separate
   runtime. Qualify both selections or remove/document the historical target.
4. Preserve fork branch/baselines. Do not chase moving upstream main mid-run.
5. Record per-environment success, failure, skip and retained historical rationale
   in the final report. Declared targets in this table are still unqualified
   unless supported by the corresponding actual-path run.
