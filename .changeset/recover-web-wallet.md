---
"@keri-ts/wallet": patch
---

Recover a browser wallet in one call. `recoverWebWallet(wallet, { open, group?, attempts? })` closes the given
handle (a latched or closed one included), opens the wallet again with `open`, retrying a failed open up to
`attempts` times (default 3), and returns a new `WebWallet` holding the durable prefix. With `group` and no local
record of that group, it resolves the co-members' OOBIs and calls `groups.rejoin`; otherwise `skipped` says why no
rejoin ran (`no-group`, `group-recorded`, or `member-missing` for a wiped store, where the host re-adopts its member
and rejoins itself). A reopen that fails every attempt throws `WalletRecoveryError` with the last failure as its
cause. `readPersisted` on a closed or stopped wallet now rejects with `WalletStoppedError` instead of running.
