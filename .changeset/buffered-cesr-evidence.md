---
"cesr-ts": minor
"keri-ts": minor
"@keri-ts/tufa": patch
---

Replace progressive CESR traversal with one finite decoder that buffers complete
counted enclosures before delivery. Carry ESSR as ordinary ordered Texters through
dispatch, verification, persistence and replay; remove parser staging, Cursor,
FrameIntake and ordinary-frame disposal. Preserve framing, padding, genus scopes,
independent nested proofs and actual transport/storage cleanup.
