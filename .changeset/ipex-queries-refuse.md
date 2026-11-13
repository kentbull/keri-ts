---
"keri-ts": minor
---

`AgentRuntimeOptions.ipexQueries: "refuse"` makes a runtime drop DH and Unblind peer queries before KRAM records them, for a command that only drains a mailbox and never consents (`tufa ipex poll` uses it). Without it such a command took the Issuee's DH query into the owner's in-memory retention and exited, and KRAM then dropped the issuer's identical resend as a replay, so the later `tufa ipex setup` never saw a query and a Tufa-custodian group DH issuance stalled. The protocol escrow loop also rests for a multiple of a costly pass instead of re-verifying a still-waiting Grant on every turn, which starved delivery in a runtime with such a Grant.
