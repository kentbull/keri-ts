---
"keri-ts": patch
---

A relaying agent now refreshes its own view of a subject its edges ask about. When a runtime with `relaying` receives a `logs` or `ksn` query from a sender it serves (the same served-sender rule as `/fwd` relaying) about a subject that is not one of its own, it also queues its own ordinary `logs` query for that subject, signed by the serving host and sent directly to the subject's controller, agent or witness endpoint. The requester must be authenticated: its KEL is held and its current keys signed the query to threshold. The refresh is skipped when the agent can name no attester for the subject. It is on demand only; nothing is watched or stored. The edge's first answer is what the agent held, unless its query named a sequence number or anchor the agent lacked, in which case the agent escrows it and answers after the refresh lands; a later query returns the refreshed state. A `tels` query is not refreshed.

A relaying runtime's cue router no longer queues a query identical to one already queued, so repeated edge queries about one subject leave one request queued. A runtime without `relaying` is unchanged.

New: `WitnessInquisitor.enqueueCueOnce`, `queryAttesters`, `relayRefreshCue`, and an optional trailing `relaying` argument to the `ProtocolProcessor` constructor.
