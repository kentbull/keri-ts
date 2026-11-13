---
"keri-ts": patch
---

An edge runtime queries and polls through its relay, and uses the relay only once it is authorized.
`WitnessInquisitor` takes the relay (or null) after the clock: with one, every query is addressed and sent to the
relay, which answers from its own store into the edge's mailbox it hosts, and `attestersFor` returns only the relay.
`MailboxPoller` takes the relay (or null) after the clock, and `mailboxPollEndpoints(hab, relay)` returns only the
relay, never witnesses or other mailboxes, once the subject has authorized it as mailbox. A delivery, query or poll
through the relay needs an accepted mailbox end role naming the relay: from the `/fwd` wrapper or query signer (a
group's local member) to send, from the polled subject to poll. Until then `Poster` fails the delivery with the new
`RelayUnauthorizedError` and sends nothing, and a query stays queued. `relayAuthorized` and `relayRefusal` expose the
decision. A message addressed to the relay itself, and the mailbox add posted to its `/mailboxes` resource, need no
authorization, so onboarding is unchanged. A runtime without `relay` behaves as before.
