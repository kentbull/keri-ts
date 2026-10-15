---
"keri-ts": minor
---

Move TCP reply parsing and dispatch into an application conversation flow. The TCP engine now exposes a bounded byte stream instead of depending on AgentRuntime. Use converseCesrTcp or streamCesrTcpConversation for parsed same-socket replies; lower send adapters retain transmit-only results.
