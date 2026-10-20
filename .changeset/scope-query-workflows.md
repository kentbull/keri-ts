---
"keri-ts": major
"@keri-ts/tufa": major
---

Separate WitnessInquisitor query sending from scoped KeyStateNoticer, LogQuerier, SeqNoQuerier and AnchorQuerier operations. Await accepted-state completion instead of registering generic runtime continuations; composition routes live saved key-state facts through Effection's channel.

Move query command composition and final display into Tufa. Remove queryCommand from keri-ts/cli and make HTTPQuery an internal transport operation. Preserve current wire/framing, signer/attester selection, finite anchor recovery and joined transport cleanup during this ownership refactor.
