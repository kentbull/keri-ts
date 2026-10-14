# Designs and contracts

These documents own behavior and responsibility boundaries. Execution and remaining
acceptance live in [plans](../plans/README.md); dated evidence lives in [reports](../reports/README.md).

## CESR and crypto

- [Parser lifecycle](cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md),
  [progressive ownership](cesr/CESR_PROGRESSIVE_PARSER_CONTRACT.md),
  [maintainer guide](cesr/CESR_PARSER_MAINTAINER_GUIDE.md).
- [Serialization](cesr/SERIALIZATION.md) and [attachment genus](cesr/ATTACHMENT_COUNTER_GVRSN.md).
- [Argon2 allocation ownership](crypto/ARGON2_OWNERSHIP.md).

## Exchange and credentials

- [V2 message admission](exchange/MESSAGE_ADMISSION.md), [EXN proofs](exchange/EXCHANGE_PROOFS.md), [multisig](exchange/MULTISIG.md),
  [IPEX](exchange/IPEX.md), [ESSR recipient](essr/RECIPIENT.md).
- [Disclosure](credentials/GRADUATED_DISCLOSURE.md),
  [ACDC/TEL verification](credentials/ACDC_TEL_VERIFIER.md).
- [Delegation/endpoints](kel/DELEGATION_AND_ENDPOINTS.md),
  [weighted thresholds](kel/WEIGHTED_THRESHOLDS.md).

## Runtime and storage

- [Resource reservations](runtime/RESOURCE_POLICY.md),
  [ingress/egress](runtime/INGRESS_AND_EGRESS.md), [cues](runtime/CUES.md),
  [query/reply](runtime/QUERY_REPLY.md), [witness HTTP](runtime/WITNESS_HTTP.md).
- [Mailbox](mailbox/MAILBOX.md), [read authorization](mailbox/READ_AUTHORIZATION.md),
  [durable admission](mailbox/DURABLE_ADMISSION.md).
- [DB invariants](db/db-architecture.md), [payload storage](db/PAYLOAD_STORAGE.md),
  [deferred provider proposal](db/PROVIDER_PROPOSAL.md).

## CLI and release

- [Effection/CLI](cli/EFFECTION_CLI_INTEGRATION.md),
  [sign/query/rotate](cli/SIGN_QUERY_ROTATE.md).
- [Versioning design](release/VERSIONING.md) and
  [release operations](../versioning/release-versioning.md).
