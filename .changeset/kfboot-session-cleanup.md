---
"@keri-ts/tufa": patch
---

Reclaim expired, failed and cancelled KF boot onboarding sessions. A periodic sweep (`KF_BOOT_CLEANUP_INTERVAL_SECONDS`, default 60; `KF_BOOT_CLEANUP_RUNNER_ENABLED`) expires lapsed sessions, deletes their witnesses and watcher through the backend admin APIs and then sets `resources_cleaned_at`, so the account AID can start onboarding again instead of receiving a permanent 409 "Session cleanup pending". A failed teardown stays pending and is retried on the next sweep. `/health` reports the cleanup runner as kf-boot does.
