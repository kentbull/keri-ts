---
"keri-ts": patch
"@keri-ts/tufa": patch
"@keri-ts/hosting": patch
---

Route TCP egress through an optional `HttpClient.tcp` dialer, so browser hosts without sockets get a clear error and `NodeHttpClient` supplies the existing TCP behavior.
