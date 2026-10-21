# ADR-0014: Retire autonomous legacy TEL backing

- Status: Accepted
- Date: 2026-10-20
- Scope: Legacy TEL signing, collection, hosting and backed-registry authoring
- Related: [simple component flows](adr-0013-simple-component-flows.md),
  [retired design report](../reports/credentials/LEGACY_TEL_BACKER_RETIREMENT.md)

## Decision

Remove the autonomous legacy TEL backer feature and backed-registry application
authoring from keri-ts and Tufa. Do not retain dormant components, interfaces,
configuration flags, compatibility aliases or replacement storage machinery.
The application authors NoBackers registries and `iss`/`rev` credential TELs.
Issuer multisig approval and KEL witnessing remain separate supported features.

Retain decoding, observer verification and replay of external legacy
`vcp`/`vrt`/`bis`/`brv` evidence. An external backer quorum must still be verified
against the exact accepted management cohort; partial or invalid proof cannot
become accepted because the autonomous producer was removed. Imported backed
credentials may still be observed and presented with their existing evidence.
Local application workflows must not sign or manage backed TELs implicitly.

## Reason

The additional signer/service introduced private endorsement-choice persistence,
eligibility publication, a hosted worker, routing and restart obligations across
protocol, storage, runtime, CLI and interoperability owners. There is no current
justified application requirement for paying those continuing integration costs.
Working crypto and a possible future use are insufficient reasons to retain it.

KERIpy's legacy event model and receipt observer support do not imply that an
autonomous backer service is an active reference feature. The pinned Tevery
receipt cue paths are disabled; the TypeScript service was additional behavior.
Native ACDC v2 registries use a different model and do not require this mechanism.
These facts justify a product boundary, not removal of legacy protocol decoding
or a claim that no deployment ever used backers.

## Consequences

- Delete the signer/service, private request flow, runtime/hosting options,
  `--backer-alias`, `--backers`, backed-registry inception/rotation/issuance
  branches, their exports and the private `bens.` choice table construction.
- Remove feature-only tests, hosting harnesses, stale unreleased promises and
  helpers. Keep shared primitives and independently useful observer verification,
  signature accumulation, history, escrow and replay behavior.
- The reference report and immutable Git source preserve the former design.
  There is no old keri-ts API/private-format compatibility requirement and no
  migration or dormant storage cleanup framework is introduced.
- Record public changes in the 2.0.0 breaking guide. Verify the remaining
  NoBackers authoring, normal hosting and retained observer behavior; do not add
  tests or lint rules asserting that retired names or ideas remain absent.

Do not reintroduce autonomous legacy TEL backing or local backed-registry
management merely for reference symmetry, anticipated adoption or convenience of
a test fixture. A concrete new requirement, cost justification and explicit ADR
supersession are required before reconsideration.
