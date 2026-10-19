---
"keri-ts": major
"@keri-ts/tufa": major
---

Extract ProtocolProcessor from Reactor. Reactor owns byte input and an independent Kevery; protocol dispatch, cue publication, correlation and escrow scheduling belong to their actual shared owners. Require explicit shared protocol dependencies for Poster/TCP replies, expose composed exchange and reply owners, and remove Reactor dispatch/escrow/handler proxy APIs.
