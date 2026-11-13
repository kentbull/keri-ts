---
"keri-ts": patch
"@keri-ts/hosting": patch
---

A relaying agent now refreshes its own view of a subject its edges ask about. When a runtime with `relaying` receives a `logs` or `ksn` query from a sender it serves (the same served-sender rule as `/fwd` relaying) about a subject that is not one of its own, it also queues its own ordinary `logs` query for that subject, signed by the serving host and sent directly to the subject's controller, agent or witness endpoint. The requester must be authenticated: its KEL is held and its current keys signed the query to threshold. The refresh is skipped when the agent can address no attester for the subject (none with an accepted location). It is on demand only; nothing is watched or stored. The edge's first answer is what the agent held, unless its query named a sequence number or anchor the agent lacked, in which case the agent escrows it and answers after the refresh lands; a later query returns the refreshed state. A `tels` query is not refreshed.

A relaying runtime's cue router no longer queues a query identical to one already queued, so repeated edge queries about one subject leave one request queued.

The query sender no longer throws when the eligible attesters have no accepted location. It chooses at random among the eligible attesters that have one, still never promoting another role, and when none has one the request waits as unresolved work does. Before, a missing location threw a `ValidationError` that ended the sender's loop and, through hosted ingress, failed the HTTP request that caused the query.

`@keri-ts/hosting`: `drainRuntimeCues` only routes cues; it no longer runs a query-sender pass inside the HTTP request. Queries a request causes (a relaying agent's refresh, a KRAM recovery query) are sent by the runtime's query-sender worker on its tock, so the request never waits on or fails from them.

New: `WitnessInquisitor.enqueueCueOnce`, `addressableAttesters`, `relayRefreshCue`, and an optional trailing `relaying` argument to the `ProtocolProcessor` constructor.
