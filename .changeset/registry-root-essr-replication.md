---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Replicate existing ACDC v2 registry roots to group members as KERIpy's local-profile `/registry/root` ESSR `exn`, replacing the `RegistrySalt` `/registry/salt` reply profile. `RegistryRoot` authorizes copies from the accepted KEL/TEL, stores copies that only lack local state as pending instead of dropping them, ignores duplicate SAIDs and retains a root only once it verifies against local state. KRAM exempts `exn` `/registry/root` by default. Tufa's `vc registry root send|receive|newcomers` match `kli`: mailbox delivery on the `credential` topic, `--out`/`--message` file fallback and `receive --listen`; the `prepare` and `contribute` file commands are removed.
