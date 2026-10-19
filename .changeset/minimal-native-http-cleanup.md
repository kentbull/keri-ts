---
"keri-ts": patch
---

Simplify native HTTP response cleanup around Fetch cancellation, pending I/O joining and reader release. Remove redundant closing paths and error-history state. Status-only callers close ordinary request scopes before publishing results. Qualify native EOF, truncation, unread/blocked-body cancellation, early return and external abort reasons on Deno and Node 20.3; normalize Node 20 replacement body AbortErrors at the native boundary.
