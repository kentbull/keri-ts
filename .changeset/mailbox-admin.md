---
"keri-ts": minor
---

Add `addMailbox`, `removeMailbox`, `mailboxStatus`, `waitForMailboxState`, `completeMailboxAdmin`, `requireMailboxEndpointUrl` and `mailboxAdminUrl` to `keri-ts/runtime`. They own single-signature mailbox administration, signing the end-role reply, posting it to the provider as `application/cesr` (falling back to the legacy multipart form on 406 or 415) and confirming local acceptance, over a fetch-only `HttpClient`. `waitForMailboxState` only observes and returns a timed-out value. `tufa mailbox add` and `remove` now call them with unchanged behavior.
