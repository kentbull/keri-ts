---
"keri-ts": patch
"@keri-ts/tufa": patch
---

Preserve independent I/O failures reported while a cancelled operation joins its
cleanup. Abort the concrete source before child teardown, join its pending work
through the resource lifetime, and suppress only that operation's own abort reason.
