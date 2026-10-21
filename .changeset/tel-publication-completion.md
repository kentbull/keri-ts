---
"keri-ts": patch
---

Separate accepted legacy TEL evidence from completed publication. Regery's TelPublication owner persists anchor, witness and dissemination progress through the existing tmse/tpwe/tede tables, and ordinary host workers collect/fan out receipts before sending accepted TEL replay to the historical witness cohort. Interrupted work remains pending across reopen. Registry.complete and ctel now reflect completed local publication; ctel stores the issuer anchor SAID, matching KERIpy, without claiming remote observer acceptance. RegistryOptions now requires the shared publication owner.
