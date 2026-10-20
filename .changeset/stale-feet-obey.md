---
"keri-ts": major
---

Propagate database close failures, prevent uncertain handle reuse, and preserve operation and cleanup errors.

LMDBer no longer warns and reports success after an ordinary close failure.
Shutdown starts disabling the binding before completion, so failed wrappers cannot
be reused, reopened or cleared; `env` now exposes only a usable, read-only handle.
Keep `openExisting` for non-creating access. Await owned closure before reporting
success, and handle `AggregateError` when an operation and its cleanup both fail.
