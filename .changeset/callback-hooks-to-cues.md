---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Runtime components no longer call each other through callback hooks; they exchange records on decks or read state on their own tock. An accepted `/end/role` reply now emits an `endRoleSaved` cue (`EndRoleSavedCue`) after its commit, and the runtime cue pass (and the witness cue drain) prompts the KEL publisher and mailbox poller for a mailbox role. The mailbox poller pushes a `MailboxPollCue` (`polled` or `unauthorized`) onto the KEL publisher's new `polls` deck, which the publisher drains on its tock to re-arm a timed-out post or post the KEL again after a 403. The TCP witness host re-reads a retained query's `QueryReply.ready` each runtime tock instead of registering an observer.

Breaking changes: `Revery.onEndRole` is removed. The `MailboxPoller` options `onPolled` and `onUnauthorized`, and the `MailboxPoller.onPolled` and `MailboxPoller.onUnauthorized` fields, are removed; pass `polls` (a `Deck<MailboxPollCue>`, normally `KelPublisher.polls`) instead. `KelPublisher.repair` is now private; push an `unauthorized` record onto `KelPublisher.polls`. `QueryReply.observeReady` is removed; read `QueryReply.ready`.
