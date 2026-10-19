---
"keri-ts": major
"@keri-ts/tufa": major
---

Replace RuntimeHttpClient.fetch with scoped request ownership. The composed FetchHttpClient validates Request before fetch and owns upload, response-body transport failures and joined cleanup. HttpResponse exposes status, headers and a cancellable byte source instead of a native Response. CESR helpers require an explicit HTTP client, and obsolete raw response-handle APIs are removed without compatibility aliases. Migrate HTTPMessenger, mailbox/SSE, OOBI, receipt, DID-webs, webhook and Tufa callers to the shared error contract, eliminating client identity checks.
