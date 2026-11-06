---
"@keri-ts/tufa": patch
---

Add the KF service-admin client (`WitnessAdmin`, `WatcherAdmin`, `RegistryAdmin`), a port of kf-boot's private boot API client, and the cross-implementation service-admin contract suite (`deno task test:contract`) that runs it against the TypeScript witness, watcher, registrar and observer roles and, when their entrypoints are configured, the Python witness-hk, watcher-hk, kf-registrar and kf-observer services.
