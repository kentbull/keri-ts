---
"keri-ts": minor
---

A DH query that reaches an Issuee before its consent is now persisted (`Baser.heldq`, keyed by exchange id) as well as held in memory, so it survives a restart of the receiving runtime: a wallet reload, or a CLI process such as `tufa ipex poll` that exits before `tufa ipex setup` consents. KRAM records the query as seen when it is first accepted, so a resend of the same bytes is dropped as a replay, and a group issuer cannot re-date its query; the held copy is what consent replays. `AgentRuntimeOptions.ipexQueries: "refuse"` now concerns Unblind queries only (the discloser's owed reply is still memory-only), and `tufa ipex poll` keeps using it.
