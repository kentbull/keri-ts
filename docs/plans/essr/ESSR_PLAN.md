# ESSR plan

The recipient and outcome extraction exist (#133/#163). Apply
[ADR-0013](../../adr/adr-0013-simple-component-flows.md) before final qualification;
older recipient accounting requirements are superseded.

## Removal and correctness

- Message/concurrency quotas, decryption slots, eightfold copy estimates,
  policy constructors, reservations and capacity-refusal branches are removed.
  Parser-internal ESSR quotas and frame credit are removed as well.
- Keep envelope/key/digest/authentication/framing validation and exact payload
  size consistency. Crypto minimum lengths are format facts, not quotas.
- Keep original qualified ciphertext as protocol evidence; authenticated plaintext
  is separate. No unsuccessful cryptographic outcome publishes plaintext.
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
