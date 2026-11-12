---
"keri-ts": patch
"@keri-ts/tufa": patch
---

`RegistryRoot.prepare` now derives each `/registry/root` copy's verification hint for its own registry, from the head BUP's held opening or else an ACDC of that registry nested in any locally stored exchange, including a Grant inside a `/multisig/exn` proposal. Before sealing, the sender checks that its root reproduces the BUP with that hint and refuses otherwise. `--acdc` on `tufa vc registry root send|newcomers` is now an override, an empty hint still sends an unhinted copy, and the new `hinted` option refuses instead of sending a copy that cannot verify. `newcomers` no longer applies one hint to every registry.
