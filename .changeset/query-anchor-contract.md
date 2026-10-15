---
"keri-ts": minor
---

Require the existing CESR event-seal shape for anchor queriers. Validate anchor-file JSON and CESR fields before opening controller state or scheduling queries; preserve valid supplied seal values and owned snapshots while emitting the i/s/d key order required by KERIpy anchor lookup.

Ask each eligible anchor-query attester once through the existing queue, preserving unqueued alternatives on capacity refusal. A stale retired witness no longer strands anchor recovery; ordinary query selection is unchanged.

Run command-local query and mailbox workers concurrently through the existing runtime runner, then halt and join before displaying state and closing stores. Empty mailbox polls no longer consume the query window before query transmission and other endpoints progress.
