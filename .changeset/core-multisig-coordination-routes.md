---
"keri-ts": patch
"@keri-ts/tufa": patch
---

`/multisig/qry` and `/multisig/ipex-proof` are core multisig routes, as in KERIpy (kentbull/keripy#149). The Multiplexor checks that a query child is authored by the group and that a proof child is a Grant for the group, requires a current signing-member sender, and indexes and notifies both without replaying their children. New builders `multisigQueryExn` and `multisigIpexProofExn`, plus `Multiplexor.addChildHandler`, let several owners share one route by nested child route; the agent runtime exposes its `mux`. Tufa group DH, Unblind and issuance proof coordination use these instead of replacing exchanger routes. The KERIpy reference pin moves to `v2-spec` `f05d200c`.
