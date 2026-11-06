---
"@keri-ts/tufa": minor
---

Add `tufa boot backend`, which runs the TypeScript KF boot service. Every flag overrides the `KF_BOOT_*` variable upstream kf-boot reads, so a launcher can switch implementations by changing only the executable. An end-to-end test runs every provider role as a `tufa` subprocess and proves `tufa infra kf onboard --session` recovery after rotation with a lost or partial credentials file.
