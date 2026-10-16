# ESSR plan

The [accepted simplification](../PARITY_ROADMAP.md) governs architecture and takes precedence
over conflicting older requirements here; existing protocol obligations remain.

The recipient and outcome extraction exist (#133/#163). Apply
[ADR-0013](../../adr/adr-0013-simple-component-flows.md) before final qualification;
older recipient accounting requirements are superseded. The accepted
[buffered parser](../cesr/CESR_PROGRESSIVE_PARSER_PLAN.md) also removes parser
staging and progressive extraction; ordinary Texter evidence and finite decoding now replace that parser lifecycle.
Transport bridge removal and composed/installed qualification are delivered for
1.0.0. The [release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md)
records exact scope and limits; retain the following regression floor.

## Removal and correctness

- Message/concurrency quotas, decryption slots, eightfold copy estimates,
  policy constructors, reservations and capacity-refusal branches are removed.
  Parser-internal ESSR quotas and frame credit are removed as well.
- Keep envelope/key/digest/authentication/framing validation and exact payload
  size consistency. Crypto minimum lengths are format facts, not quotas.
- Keep original qualified ciphertext as protocol evidence; authenticated plaintext
  is separate. No unsuccessful cryptographic outcome publishes plaintext.
- Parse ESSR as ordinary Texter values and qualified/raw bytes. Delete parser
  payloadSink factories, EssrWriter, pending-stage/owner registries and cursor
  reopening. Maintain one authoritative parsed representation. Ordinary parsed
  values need no disposal protocol; Texter fragments are not separate authenticated
  messages. Keep actual storage payloads only for current storage consumers.
- Relocate real ciphertext/plaintext/file disposal to its actual owner before
  deleting accounting wrappers. Cancellation and I/O/cleanup failures propagate.
- No migration or new-to-old keri-ts tests. Qualify current supported evidence.

## Final gate

Retain independent crypto fixtures, successful plaintext handoff, malformed and
truncated envelopes, actual I/O cancellation, accepted payload reopen and cleanup.
Delete busy/limit and formula-only tests. Exercise real ingress, verification,
storage, forwarding/replay and egress, including fragmented ciphertext and the
required graduated-disclosure/KRAM topology. The [qualification plan](../qualification/QUALIFICATION_PLAN.md)
owns final evidence; no runtime-wide accounting integration remains to complete.
