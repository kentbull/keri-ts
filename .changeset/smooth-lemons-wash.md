---
"cesr-ts": major
"keri-ts": major
---

Return ordinary authenticated ESSR bytes from accepted LMDB evidence. Remove unused file staging, payload ownership/sink APIs and ESSR content-reader adapters while preserving shared framing and transport sources.

Construct `EssrRecipient(hab)` and call synchronous `decrypt(said)`; consume the accepted message body as a caller-owned Uint8Array. Use ordinary Texter raw or qualified bytes instead of removed ESSR reader adapters. See `docs/reference/compatibility/MIGRATING_TO_2_0.md` for removed public APIs.
