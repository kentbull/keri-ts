---
"@keri-ts/tufa": patch
---

`tufa boot backend` sends registry services the account's public KEL evidence without its own transferable validator receipts, so Python kf-registrar and kf-observer accept the enrollment instead of refusing the stream at the boot's unknown receipt.
