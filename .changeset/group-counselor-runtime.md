---
"keri-ts": minor
---

Add `runtime.counselor` to `AgentRuntime` and run its loop in `runAgentRuntime`, beside the delegating loop; the runtime pending state gains `groupPending`. The Counselor acts only on events registered with `start` or `supply`, so a runtime with nothing counseled does no extra work beyond three row counts per turn. A delegated group event now proceeds with the local group member hab when no proxy is supplied, as in KERIpy, so the `proxy` block kind is removed; an explicit proxy still wins.
