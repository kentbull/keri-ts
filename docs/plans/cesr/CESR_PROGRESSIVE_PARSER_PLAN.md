# Progressive CESR parser plan

Owner: follow-on phases 1–2 of the [parity roadmap](../PARITY_ROADMAP.md).
The single progressive engine, frozen-reference table/semantic changes,
parent-owned trees, serialization and annotation are delivered. The
[delivery report](../../reports/parity/DELIVERED_THROUGH_168.md) links the evidence.

## Remaining parser-specific work

- The current-reference accessor audit and #330/#332 UUID/sequence corrections
  record supported, absent and narrower projections. Retain its typed/mutability/
  number-width limits; final execution does not establish full Python object-API parity.
- Keep structural guards on child kinds, ilks and contexts without completed
  consumers. Table membership alone never enables a runtime route.
- Parser reservations and deterministic work checkpoints are integrated with
  [shared policy](../runtime/RESOURCE_POLICY_PLAN.md). Final maintained execution
  must confirm their lifecycle; no second engine or cross-major retry path is needed.

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
