---
"keri-ts": patch
---

Trim reply signature groups from older establishment events once a newer group for the same reply is accepted, matching KERIpy `Revery.acceptReply`. Stored `/loc/scheme` and `/end/role` replies served through OOBIs now carry only the signer's current signatures after a rotation.
