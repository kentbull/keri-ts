---
"keri-ts": major
"@keri-ts/tufa": major
---

Separate completed finite HTTP requests from scoped streaming responses. HttpClient.request now returns complete HttpResponse.body bytes after cleanup; HttpClient.open lends HttpStreamResponse.body(signal) for streaming and status-only consumers. Migrate CESR sends, queries, mailbox/OOBI/DID workflows, receipt endpoints, CLI callers and injected clients without compatibility aliases.
