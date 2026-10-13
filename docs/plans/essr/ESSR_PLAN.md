# ESSR plan

The recipient and outcome extraction are delivered (#133/#163); the
[recipient contract](../../design-docs/essr/RECIPIENT.md) owns behavior.
This subject plan routes remaining ESSR obligations into the existing phases.

- **Phase 4:** share admission across streams and recipient instances, with one
  runtime decryption slot and charged native/ciphertext/plaintext copies.
- **Phase 5:** preserve original qualified ciphertext in interoperable wire rows;
  store authenticated plaintext separately and reconcile crash/reopen ownership.
- **Phase 6:** carry the recipient through real ingress, verification, storage,
  forwarding/replay and egress under slow consumers and cancellation.
- **Phase 7:** qualify fragmented logical ciphertext and many bounded messages
  in the repeated aggregate-transfer matrix.

## Acceptance invariants

`accept` transfers the authenticated message and plaintext owner. `refuse`
identifies busy capacity, configured size policy or unmet durable exchange
acceptance; `reject` identifies envelope, digest, authentication or framing
failure. No automatic queue or retry is added by this API.

Oversize refusal and undersized sealed-box rejection occur before reads or
allocation. Invalid size metadata is a caller contract exception. Cancellation,
storage/I/O failures, invariants and programming errors propagate, with joined
cleanup and exactly-once release. No unsuccessful outcome publishes plaintext.

Retain independent cryptographic fixtures, successful ownership transfer,
busy-then-admitted behavior and cancellation during I/O. Per-recipient guards
are not a runtime-wide memory bound. [Shared policy](../runtime/RESOURCE_POLICY_PLAN.md)
owns their integration; [qualification](../qualification/QUALIFICATION_PLAN.md)
owns the final claim.
