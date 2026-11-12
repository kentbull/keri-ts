---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Align the library OOBI, query and event-completion workflows to one contract. Functions take small declared collaborator interfaces instead of an `AgentRuntime`. Waits (`waitForOobi`, `resolveOobi`, `queryKeyState`, `queryAnchor`, `waitForDelegation`) only observe and never start runtime workers; an expired wait is returned as `{ status: "timed-out", timeoutMs }` rather than thrown. Adds `eventStatus`, `waitForOobi`, `observeUntil`, and the `ChangeSink` interface with `MemoryChangeSink` and `signalerChangeSink`. Query status now says whether it is process-local or durable. The CLI commands keep their output and errors.
