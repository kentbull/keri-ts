---
"keri-ts": patch
"@keri-ts/wallet": patch
---

`retireIdentifier(runtime, pre)` retires a local, non-group identifier from a running agent. It calls `Habery.retireHab`, then releases the held signers of the identifier's current keys, deletes its mailbox poll cursors (`tops.`) and KEL publisher rows (`kpub.`), and prompts the mailbox poller and the KEL publisher, so its poll workers halt on the next tock and leave no signer condition. It returns a `RetiredIdentifier` naming the prefix, the name, the released public keys and the mailbox endpoints whose workers stop. Before any write it refuses what `retireHab` refuses and, in addition, a registry issuer, an identifier with a pending delegated event or pinned as a delegation proxy, the habitat of a live issuance or Unblind, the source of a queued Poster event, the signer of a queued query and the querier's configured signer. `retireIdentifierRefusal(runtime, pre)` returns that reason without throwing, and `Habery.retireRefusal(pre)` does the same for the store-level refusals. Everything reply acceptance and replay protection need stays: the KEL, key state, every accepted reply, transaction-state notices, KRAM rows, exchanges and credentials.

`replaceGroupMember` now retires the replaced member by default. When the runtime still needs it, the replacement succeeds and the old member is kept; the new `previousMember` field of `ReplacedGroupMember` says `retired` or `kept` with the reason. `keepPrevious: true` keeps it. `Manager.release` returns the public keys whose held signers it dropped. A mailbox poll that ends after its subject was retired no longer writes a cursor back.

`@keri-ts/wallet`: `identifiers.retire(pre)` retires a single-signature identifier, and `groups.replaceMember` takes `keepPrevious` (its options are now the named `ReplaceMemberOptions`) and returns the old member's outcome.
