# Documentation

Start with the [architecture map](ARCHITECTURE_MAP.md) for package/source ownership
or the [parity roadmap](plans/PARITY_ROADMAP.md) for remaining approved work.
The [v1/v2 compatibility inventory](reference/compatibility/KERI_V1_V2_COMPATIBILITY.md)
maps implemented bridges, supported version boundaries and remaining gaps; its
[KERIpy porting backlog](plans/compatibility/KERIPY_COMPATIBILITY_PORTS.md) tracks
future 1.x/2.x branch assessments and acceptance work.
The [cue delivery refactor](plans/runtime/cue-delivery-refactor.md) records the
implemented boundaries and qualification;
its [reliability roadmap](plans/runtime/cue-reliability-roadmap.md) records
deferred capabilities, not additional implementation authorization.
The [messenger and protocol refactor](plans/runtime/messenger-protocol-refactor.md)
tracks the phased separation of input/transport lifetimes from shared protocol processing.
The [HTTP request ownership refactor](plans/runtime/http-request-ownership-refactor.md)
consolidates Request validation, execution and body transport failures into the composed HTTP implementation.
The [HTTP client simplification](plans/runtime/http-client-simplification.md)
narrows that owner to prepared bodies, finite results and a small scoped streaming path.
The [explicit dependency plan](plans/runtime/explicit-runtime-dependencies.md)
tracks explicit HTTP/clock composition and removal of RuntimeServices, followed by a separate verifier clock correction.

The [local mailbox consumption removal](plans/runtime/remove-local-mailbox-consumption.md)
keeps provider storage independent from direct protocol intake and remote mailbox polling.

The [maintainer documentation pass](plans/runtime/runtime-maintainer-documentation.md)
records source coverage and the five cross-component reading paths. Current contracts
remain in the [runtime design](design-docs/runtime/INGRESS_AND_EGRESS.md).

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
