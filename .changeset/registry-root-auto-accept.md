---
"keri-ts": minor
"@keri-ts/tufa": minor
---

Accept received `/registry/root` copies automatically, matching KERIpy kentbull/keripy#168. `RegistryRoot.handle` retains a copy that verifies on arrival and escrows the rest in `Baser.rrpe` until they are retained or refused; `RegistryRoot.processEscrows` retries them and `Exchanger.processEscrows` now calls `processEscrows()` on any route handler that defines it. Refused copies leave the escrow, a different retained root is never replaced, and a newly retained root adds one informational `/exn/registry/root` note. `dismiss` is removed, `pending()` lists escrow entries without decrypting, and `receive(said, { event, opening })` is only a manual retry. `tufa vc registry root receive` is now a drain (`--message`, or `--listen` with `--registry`), and `--sender` is removed.
