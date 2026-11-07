---
"@keri-ts/tufa": patch
---

Hosted witness, watcher, boot, registrar and observer services and the witness/mailbox startup runtimes compose with `registryRoots: "refuse"`, so a `/registry/root` copy addressed to a service identity is rejected and nothing is persisted. `tufa vc registry root receive` now adopts stored copies that no handler escrowed (`RegistryRoot.reconcile()`) before draining, and its help text marks it as an optional drain: any runtime that polls the credential mailbox, such as `tufa agent`, already retains copies.
