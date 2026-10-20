---
"keri-ts": major
"@keri-ts/tufa": major
---

Replace query key-state Channels with an explicitly supplied command-owned cue Deck and one KeyStateNoticer consumer. Remove AgentRuntime.keyStateUpdates and its subscription contract; pass queryCues to runAgentRuntime before I/O. A matching notice selects one accepted catch-up target without broadcast or moving-target task replacement.
