---
"@keri-ts/wallet": patch
"keri-ts": patch
"@keri-ts/tufa": patch
---

A browser wallet delivers through its agent unless it opts out. **Breaking:** `OpenWebWalletOptions` now requires
`delivery: WebWalletDelivery`, either a relay `{ aid, oobi }` (the agent the wallet sends, queries, polls and resolves
OOBIs through, passed to the runtime as `relay`) or `"direct"`, which behaves exactly as the wallet did before. An open
without it does not compile; a relay with an empty AID or a non-HTTP(S) OOBI rejects with `ValidationError` before any
store opens. `recoverWebWallet` reopens with the same `delivery`.

`WebWallet.health()` reports `relay-unresolved` (the relay's OOBI has not resolved) and `relay-unauthorized` (with the
local identifiers that have not authorized it as their mailbox), after `faulted` and before `mailbox-unreachable`.
`WebWallet.relayStatus()` lists the onboarding steps still missing, in order. Both are read from accepted state by the
new `relayOnboarding(hby, relay)` in `keri-ts`, which also exports `assertRelay` and the `RelayStep` types.

`tufa agent --relay` and `tufa mailbox start --relay` turn on relay mode for the host (off by default).
