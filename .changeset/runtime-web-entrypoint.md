---
"keri-ts": minor
---

Add the browser-safe `keri-ts/runtime/web` entrypoint: `barrierHttpClient` holds every HTTP request until the persistence queue has flushed (ADR-0015 rule 6), `acquireStoreLock` takes a Web Locks single-writer lock per store identity and fails closed without `navigator.locks`, and `requestPersistentStorage` reports whether the browser granted persistent storage.
