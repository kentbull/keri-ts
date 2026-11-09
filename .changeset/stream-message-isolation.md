---
"keri-ts": patch
---

Skip a message that fails validation after extraction instead of aborting its whole input stream, matching KERIpy's parser. Unknown reply routes no longer fail OOBI resolution or close a TCP connection, and infrastructure failures still propagate.
