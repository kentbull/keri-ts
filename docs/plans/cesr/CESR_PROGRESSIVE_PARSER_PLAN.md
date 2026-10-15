# Progressive CESR parser plan

Planning constraint: [ADR-0013](../../adr/adr-0013-simple-component-flows.md) requires removal of
application accounting and unsupported delivery durability, without old-version
keri-ts API/data compatibility. Protocol correctness and real cleanup remain.

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
- Codec allocation estimators, DecodedBodyBudget and speculative CBOR extension
  refusals are removed. Preserve native decoding, exact body ownership, syntax
  provenance and proven CBOR state reset.
- Remove remaining parser quota options, tree/frame credits,
  side tables and capacity refusal hooks. Preserve declared lengths, enclosure
  state, syntax/error provenance, actual payload disposal and source cancellation.
  No second engine, no-op policy or cross-major retry path. Review synthetic work
  scheduling without turning it into a renamed budget.

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
