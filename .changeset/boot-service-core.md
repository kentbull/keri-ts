---
"@keri-ts/tufa": minor
---

Add the core of a TypeScript KF boot service, a port of upstream kf-boot: `KF_BOOT_*` configuration, `GET /health`, `GET /bootstrap/config`, the CESR-over-HTTP onboarding and account surfaces with kf-boot's transport status table and signed v2 replies, the `/onboarding/session/start|status`, `/onboarding/cancel` and `/operations/status` routes, and the provisioning worker that allocates witnesses across distinct backends and one watcher through the service-admin clients.
