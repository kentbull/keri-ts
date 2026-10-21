# Retired autonomous legacy TEL backing

Reference snapshot: `dda5a9d48c1737d338e230560a5d1d154b1a5781`
(PR #651, before retirement). This report preserves the former design for future
inspection; executable history remains in Git. It is not an implementation plan.
[ADR-0014](../../adr/adr-0014-legacy-tel-backer-retirement.md) owns the rejection.

## What existed

[PR #629](https://github.com/kentbull/keri-ts/pull/629)
(`b66ffecd5c26bfada3d6d7a873a5b25a7db25338`) added autonomous indexed TEL
endorsements. [PR #628](https://github.com/kentbull/keri-ts/pull/628)
(`3217da6f2771d82cac19075fe4ef968ea785e676`) separately repaired observer
selection of accepted historical backer cohorts and accumulation of partial proofs.
Those observer responsibilities are useful independently of the retired service.

The implementation concerned legacy/v1-style `vcp`, `vrt`, `bis` and `brv`,
not native ACDC v2 `rip`/`bup`/`upd` registries. The event model is independent
of a package release, KERIpy release, body version or CESR attachment genus.
Issuer multisig approval, KEL witnessing and TEL backer endorsements were three
separate obligations.

1. `tufa agent --backer-alias` selected one hosted nontransferable single-key Hab.
   Runtime composition created its signer, private request Deck and worker.
2. Tevery first committed an accepted, duplicate or partial-quorum event. It then
   queued eligible coordinates with the newly received proof set. Missing issuer
   anchors or management history could not authorize a signature.
3. `Backer.endorse` reread the stored event, accepted issuer anchor, management
   tuple, ordered cohort and this signer's index. It did not require the quorum
   it was helping form. Unrelated signers and conflicting accepted events refused.
4. In one Reger transaction it wrote the indexed signature to ordinary `tibs.`
   and one digest choice per `(backer AID, TEL prefix, ordinal)` to private `bens.`.
   A different digest at the same signing coordinate was refused across restart.
   This protected the local signer, not the issuer against all duplicity.
5. Reger reconstructed the original TEL body with `WitnessIdxSigs` and an issuer
   `SealSourceCouples` proof. There was no invented receipt message or KEL `rct`.
6. `BackerService` resolved the accepted issuer controller/agent endpoint and
   handed receipt bytes to Poster on the ordinary receipt topic. Caller URLs
   could not select the return destination. Transport completion was not quorum
   acceptance or an acknowledgement.
7. An explicit duplicate lacking the stored receipt could resend it after restart.
   Escrow retries already carrying it did not echo it. Missing routing was reported
   locally; crash recovery required explicit redelivery. No durable delivery
   outbox, automatic network retry or delivery acknowledgement was implemented.

The source at that snapshot is directly recoverable:

- [Signer and durable choice](https://github.com/kentbull/keri-ts/blob/dda5a9d48c1737d338e230560a5d1d154b1a5781/packages/keri/src/vdr/backing.ts).
- [Worker and receipt handoff](https://github.com/kentbull/keri-ts/blob/dda5a9d48c1737d338e230560a5d1d154b1a5781/packages/keri/src/app/backer-service.ts).
- [Composition](https://github.com/kentbull/keri-ts/blob/dda5a9d48c1737d338e230560a5d1d154b1a5781/packages/keri/src/app/agent-runtime.ts)
  and [TEL eligibility publication](https://github.com/kentbull/keri-ts/blob/dda5a9d48c1737d338e230560a5d1d154b1a5781/packages/keri/src/vdr/eventing.ts).
- [Source-era hosted test](https://github.com/kentbull/keri-ts/blob/dda5a9d48c1737d338e230560a5d1d154b1a5781/packages/keri/test/integration/app/interop-tel-backers.test.ts).

## Reference correspondence and evidence limits

Pinned KERIpy main `c7e74ad`, GLEIF 1.2.17 `b8626e1` and upstream 1.3
`4ce4cc7` supply receipt encoding and observer validation. Their Tevery receipt
cue paths are commented out, including main `eventing.py:1527–1530` and
GLEIF 1.2.17 `eventing.py:1565–1568`. The autonomous TypeScript signer/service
was additional application behavior, not a port of an active Python service.
This inspection does not establish that nobody has ever used TEL backing.

The hosted interop case exercised a real public agent, withheld a proof,
restarted the host and completed a two-backer VCP quorum. Unmodified pinned-main
Parser/Kevery/Tevery independently accepted that evidence. Focused tests checked
stored signature reuse, conflict refusal and malformed thresholds. This did not
qualify the proposed complete group VCP/BIS/VRT/BRV lifecycle or autonomous
Python backer participation. Those expansion plans were cancelled, not completed.

## Retained responsibility

Wire constructors/decoders, canonical receipt/source-proof tables and accepted
historical-cohort verification remain for externally received legacy evidence.
Ordinary observer escrows and retries remain protocol recovery, not a hosted
signing service. The active application authors NoBackers TELs; KEL witnessing
and issuer multisig remain. Reconsidering autonomous backing requires a concrete
new application requirement and an explicit superseding design decision.
