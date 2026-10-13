# Progressive CESR parser plan

Owner: follow-on phases 1–2 of the [parity roadmap](../PARITY_ROADMAP.md).
The single progressive engine, frozen-reference table/semantic changes,
parent-owned trees, serialization and annotation are delivered. The
[delivery report](../../reports/parity/DELIVERED_THROUGH_168.md) links the evidence.

## Remaining parser-specific work

- Complete the current-reference Serder accessor audit (`uuid`, sender/recipient,
  registry fields and other semantic projections); record implemented, absent,
  or intentionally narrower behavior against frozen upstream.
- Keep structural guards on child kinds, ilks and contexts without completed
  consumers. Table membership alone never enables a runtime route.
- Integrate parser reservations/work checkpoints through the existing
  [resource-policy phase](../runtime/RESOURCE_POLICY_PLAN.md). Do not create a
  second engine, strategy framework or cross-major retry path.

## Regression floor

Retain early independent GenericGroup delivery, exact enclosure exhaustion,
terminal truncation, split invariance, local genus scopes, both wire domains,
v1 item/v2 byte counts, unsupported-version rejection and cleanup. Chunk
exhaustion does not complete attachments. A failed owned tree releases all
undelivered descendants; earlier independent siblings remain delivered.

Parser correctness follows the [state-machine contract][state] and
[progressive ownership contract][contract]. Full runtime qualification belongs
to [phase 7](../qualification/QUALIFICATION_PLAN.md), and stale claimed-SAID
verification belongs to the separate [Mapper repair](MAPPER_PLAN.md).

[state]: ../../design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md
[contract]: ../../design-docs/cesr/CESR_PROGRESSIVE_PARSER_CONTRACT.md
