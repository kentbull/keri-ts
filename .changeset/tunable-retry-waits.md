---
"keri-ts": minor
---

The fixed retry and backoff waits of the library are injectable through the runtime options, with the production values as documented defaults: `RetryPolicy` (`baseMs`, `maxMs`, `boundMs`; `DEFAULT_RETRY_POLICY`) for `operationRetry` (delivery retries of issuance, presentation and Unblind), `counselorReceiptRetry` (`DEFAULT_RECEIPT_RETRY`) and `kelPublishRetry` (`DEFAULT_KEL_PUBLISH_RETRY`); `issuanceQueryResendMs` for the individual issuer's query resend; and `mailboxPolling` gains `readIdleTimeoutMs`, `refusalInitialMs` and `refusalMaxMs`. `RetryBackoff` and `DeliveryOutbox` take a policy. Group issuance keeps the production delays.
