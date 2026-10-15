# Exchange proofs and v2 admission plan

Planning constraint: [ADR-0013](../../adr/adr-0013-simple-component-flows.md) requires removal of
application accounting and unsupported delivery durability, without old-version
keri-ts API/data compatibility. Protocol correctness and real cleanup remain.

Owner: roadmap **3f**, reusing proof work from **3e** (#162/165) and nested
runtime consumers (#159–168). The [proof contract][proof] is implemented;
sender filtering, non-event routing and optional KRAM are implemented; composed
workflow qualification remains incomplete.

## Current boundary

The [admission contract](../../design-docs/exchange/MESSAGE_ADMISSION.md) owns
sender policy, proof prerequisites, query source/processor routing and explicit
reference-stub refusals. Evidence: signed frozen-reference delegation fixtures,
real runtime acceptance/invalid-signature tests, joined owner disposal and HTTP
refusal/readmission. Built-in legacy `tels` replay and internal TSN production
are implemented; authenticated registry TSN receiving and typed dependency/proof
retry, credential receiving and ordered TSN query replies are implemented.
Production corrects 714's `vcState(vcpre=...)` keyword bug
using independently observed `vcState(vci)` records, without claiming receiving
workflow qualification. Registry receiving intentionally corrects 714's self-listed
backer trust and TEL-digest BADA pointer defects using accepted trust and outer
reply evidence. Credential receiving also refuses forged carried anchors and superseded
issuance, which actual 714 accepts. TSN wire routes append the attester absent from
714 cue serialization; focused query/HTTP-pair/independent-receiver composition is
qualified. The maintained full workflow matrix remains required.

## Remaining processing boundary

The [KRAM units K1–K10](KRAM_PLAN.md) replace the unmerged #172 snapshot with
reviewable policy, evidence, authentication, replay and runtime changes. Intake
must precede route processing without replacing Exchanger proof policy.
3f also owns built-in TEL query processing. `tels/tsn` are real legacy
`vdr/eventing.py` processors at frozen 927 and unchanged in inspected 714, not
reference stubs. Bounded lazy `tels` replay is a documented TypeScript strengthening
over eager upstream collection; TSN producers alone cannot qualify the receiving
workflow. Reuse existing state records and transaction-state Broker ownership.

Inspected 714 emits bare schema-SAID query cues without adding host URL discovery.
Existing explicit schema data-OOBI retrieval verifies the expected SAID in both
implementations. That supported OOBI path requires qualification; inventing an
automatic SAID-to-URL resolver is not an additional completion gate.
Inspect `core/parsing.py`, `core/eventing.py` and `core/kraming.py` at
`7143832813cac6a394ab1faf9be83bb3372be87c` before editing. Verify the imported
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
