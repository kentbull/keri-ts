---
"keri-ts": minor
"@keri-ts/tufa": patch
---

`createAgentRuntime` now registers `RegistryRoot` whenever a v2 registry is available and exposes it as `runtime.registryRoot`, so any runtime that polls the `credential` mailbox retains `/registry/root` copies on arrival or escrows them until local state arrives, with no `receive` command. `RegistryRoot.reconcile()`, run on construction, escrows and attempts stored copies that an Exchanger without the handler left unescrowed. The new `registryRoots: "refuse"` option registers the new `RouteRefuser` instead, which rejects the route so nothing is persisted. `tufa vc registry root receive` uses the runtime's handler.
