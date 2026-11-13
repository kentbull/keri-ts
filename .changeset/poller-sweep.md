---
"keri-ts": patch
---

The mailbox poller sweeps every five seconds by default (`MAILBOX_POLLER_PACING`: the protocol tock, a sweep every 160 tocks), so an endpoint change other than an accepted mailbox end role (a witness rotated in, a location accepted after its role, another process writing the same store) starts polling within five seconds instead of the minute sweep.
