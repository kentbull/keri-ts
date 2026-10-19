# Documentation

Start with the [architecture map](ARCHITECTURE_MAP.md) for package/source ownership
or the [parity roadmap](plans/PARITY_ROADMAP.md) for remaining approved work.
The [cue delivery refactor](plans/runtime/cue-delivery-refactor.md) records the
implemented boundaries and qualification;
its [reliability roadmap](plans/runtime/cue-reliability-roadmap.md) records
deferred capabilities, not additional implementation authorization.

| Area                                           | Purpose                                           |
| ---------------------------------------------- | ------------------------------------------------- |
| [Plans](plans/README.md)                       | Remaining work, dependencies and acceptance gates |
| [Designs](design-docs/README.md)               | Current behavior, ownership and contracts         |
| [ADRs](adr/adr-0013-simple-component-flows.md) | Accepted decisions and supersession               |
| [References](reference/README.md)              | Worked examples, schema/coverage inventories      |
| [Reports](reports/README.md)                   | Dated observations, evidence and limitations      |
| [Archives](archived-plan-docs/README.md)       | Superseded plans and historical proposals         |
| [Learnings](../.agents/PROJECT_LEARNINGS.md)   | Concise subject routing and durable traps         |

Keep one owner per obligation or contract. Plans summarize delivered work in a
line and link evidence; they are not session logs. Designs describe behavior,
with proposals explicitly marked unimplemented. Learnings link those owners and
retain only rules useful at the next task. Move valuable history to reports and
examples to references; use Git history for routine narrative.

Update inbound links when moving content. Historical dates, reference pins and
limitations must survive the move; a reorganization does not requalify behavior.
See the [reorganization audit](reports/docs/REORGANIZATION_2026-10-13.md).
