---
"cesr-ts": minor
"keri-ts": patch
---

Align CESR tables with frozen KERIpy 927c0cb8: use nonce seals for v2 -N/--N,
preserve current GramHead special metadata and widths, and read valid counter
size rows with trailing commas. Keep historical v1 receipt and path-signature
protocol handling explicit, without reusing their meanings in v2.

Add qualified SealNonce records and bounded structing transport. Keep nonce
groups out of top-level attachments and native event seals, matching the actual
reference admission boundaries. Remove obsolete big receipt runtime dispatch.
