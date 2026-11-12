---
"keri-ts": patch
---

`FetchHttpClient` requests can now be cancelled in WebKit. WebKit loses the abort link of a pending `fetch` once its `Request`, or an `AbortSignal.any` composite, is garbage collected, so aborting never rejected the fetch or closed the connection, and halting an idle mailbox poll never finished (a web wallet's `close()` could hang and keep its store lock). The client now keeps both alive until the request scope ends, and treats the fresh `AbortError` WebKit and Node 20 reject with as the cancellation it is, instead of failing the halt with a `TransportError`. `mailbox-admin.ts` also exports its two request builders and submission collector.
