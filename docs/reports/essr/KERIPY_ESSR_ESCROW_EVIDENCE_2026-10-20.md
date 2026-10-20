# KERIpy main drops ESSR evidence during unknown-sender escrow

Observed against frozen main `424a50c03421165c5f289e07a341bd57b8d8ab78`,
Python 3.14.6 and python-lmdb 2.3.0 in the same native-LMDB Docker environment
used for the release peer checks. Not submitted upstream.

A real signed TypeScript `/essr/req` with a valid ciphertext commitment was parsed
before its sender's KEL. KERIpy persisted `epse.` but no ESSR fragments. After the
KEL was parsed successfully, `Exchanger.processEscrow()` reconstructed an empty
fragment list and removed the pending exchange with:

```text
ValidationError: at least one essr attachment is required
```

This is separate from equal-fragment deduplication. The probe used one Texter,
so set semantics cannot explain the loss.

At this pin, the [unknown-sender branch](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/peer/exchanging.py#L222)
calls `escrowPSEvent` without ESSR. That method and the underlying escrow helper
have no ESSR argument. [Retry](https://github.com/WebOfTrust/keripy/blob/424a50c03421165c5f289e07a341bd57b8d8ab78/src/keri/peer/exchanging.py#L617)
correctly reads `essrs.`, but there is nothing to reconstruct. Accepted logging
does persist fragments; supplying the KEL before the same kind of exchange
therefore exercises a different, supported path.

To reproduce through actual processing:

1. Make a sender unknown to the receiving Habery and construct/sign `/essr/req`,
   with `a` committing to one sealed-box ciphertext Texter.
2. Parse the complete exchange into KERIpy before introducing its sender.
   Confirm partial-signature escrow exists and `db.essrs.get((said,))` is empty.
3. Parse the sender KEL through Kevery and confirm its accepted key state exists.
4. Call `exc.processEscrow()`: the pending exchange fails its missing-payload
   check instead of being accepted.

The maintained `interop-essr-exchange` fixture constructs this real exchange.
Its main happy path now introduces the sender first, and makes no claim that
main escrow retry passed. Legacy lanes exercise actual missing-sender retry.
TypeScript separately verifies restart/retry with its own persisted evidence.
No reference source was patched, and no failed peer result was credited as a pass.

A small upstream correction would carry ordered ESSR evidence through each
partial-proof/dependency escrow path, persist it with that escrow's evidence,
and add one missing-sender -> KEL introduction -> retry regression. Preserve
fragment positions while doing so; see the companion repeated-fragment report.
