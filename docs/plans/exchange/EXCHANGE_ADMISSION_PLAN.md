# Exchange proofs and v2 admission plan

Owner: roadmap **3f**, reusing proof work from **3e** (#162/165) and nested
runtime consumers (#159–168). The [proof contract][proof] is implemented;
consolidated non-event admission remains incomplete.

## Required processing boundary

Reconcile frozen KERIpy `Kevery.processMsg` for v2 `qry/rpy/exn/xip/pro/bar`:
sender allow/deny policy, optional KRAM intake and actual route ownership.
Inspect `core/parsing.py`, `core/eventing.py` and `core/kraming.py` at
`927c0cb8794d7c84fc17143c67df64aab9deda6c` before editing. Verify the imported
modules in each evidence run. `processXip`, `processPro` and `processBar` are
stubs there; do not invent processing to claim parity.

Acceptance must prove allowed/denied senders, missing prerequisite behavior,
historical sender resolution, optional KRAM ownership/persistence/replay and
receiver-observed cutoffs consumed by [IPEX presentations](IPEX_PLAN.md).
Retain rejection of unfinished nested routes and HTTP inspection paths until
their real consumers can own and process evidence. Parsing is not acceptance.

## Preserve proof policy

Selection, evidence delivery, nonempty sender-couple delivery and missing-extra
metadata are independent capabilities. Missing sender source state, strict
supplemental failures, route dependencies and incomplete duplicates have distinct
escrow/cue behavior. Do not infer the current attempt's success from durable
`complete(said)`. Preserve `ests.`, `eidx.`, cigar verifier reconstruction,
canonical signature ordinals and re-verification on retry/replay.

Use real-store and independent Python fixtures for positive, tampered, missing,
retry, duplicate and replay cases. Group leadership excludes foreign endorsers
as an intentional correction to frozen reference behavior. This phase neither
reopens that cleanup PR nor implements the shared resource policy.

[proof]: ../../design-docs/exchange/EXCHANGE_PROOFS.md
