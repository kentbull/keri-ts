---
"cesr-ts": patch
"keri-ts": patch
"@keri-ts/tufa": patch
---

Make CESR frame completion independent of network chunk boundaries. Open
attachment sets now wait for a following body, a complete enclosure, or explicit
flush. Terminal partial attachments report shortage without emitting an
incomplete frame; flush drains all complete frames in either emission mode.

Remove the frameBoundaryPolicy option, policy exports, and deferred-frame
wrapper. Update complete-record runtime consumers to finish parsing explicitly
and keep multisig attachment sets open while appending peer signatures.
