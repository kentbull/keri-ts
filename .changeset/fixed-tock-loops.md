---
"keri-ts": patch
---

The remaining zero-delay background loops of `runAgentRuntime` (cue routing, OOBI resolution, authentication, signals, TEL publication, delegation, group counseling and the mailbox poller) are fixed-tock doers on `PROTOCOL_PACING` (`PROTOCOL_TOCK_MS` 31.25 ms, a sweep every `PROTOCOL_SWEEP_TOCKS`), reachable as the `protocolPacing` and `pollerPacing` runtime options; `oobiDo`, `authDo` and `signalDo` take a clock and pacing. The poller no longer walks every identifier each turn: it re-selects workers on tock 0 and every sweep, when the topics or the number of identifiers change, and for identifiers passed to the new `MailboxPoller.prompt`. `Revery.onEndRole` tells the runtime when an `/end/role` reply is accepted, and a mailbox role prompts the KEL publisher and the poller at once. The outgoing delivery workers (`Poster.deliverDo`, the query sender) keep their per-turn loop.
