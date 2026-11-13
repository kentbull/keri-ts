---
"keri-ts": minor
"@keri-ts/tufa": minor
"@keri-ts/wallet": minor
---

Closes the last CLI-only group behaviour and the gaps left by the group issuance work.

- A group custodian is told from a member that was sent a root copy by what the stores hold: `deriveGroupCustody(deps, hab, grant)` now takes the Grant and returns null when a `/registry/root` copy was sent to the local member for a disclosed registry, so a member holding a copy of a still-pending Grant is never adopted as the custodian.
- The issuance owner scans for resumable Grants every `ISSUANCE_SWEEP_MS` (5 s) instead of once, so a custodian that reloaded while its registry update awaited the other members resumes when the update is accepted.
- Delivery goes through one outbox with retry for every owner (`DeliveryOutbox`). Presentation and Unblind deliveries, single and group, keep the signed bytes on a failure and retry them with a doubling delay until the Grant's deadline, like issuance. `PresentOptions`, the `maxAttempts` option of `present`, `PRESENTATION_RETRY_MS` and `PRESENTATION_MAX_ATTEMPTS` are removed; an exchange with no deadline ends `failed` after `PRESENTATION_RETRY_BOUND_MS` (10 minutes) of failures. The wallet's `present` and `requestProof` lose `maxAttempts` too.
- A group presents with a presentation registry through the library: `proposeGroupPresentation` accepts `presentationRegistry`, proposes the registry update, and the group IPEX owner signs the member's contribution to the Grant once the group has accepted the update (`proposeGroupIpexAfter`, `GroupIpexPrerequisite`, phase `awaitingRegistryUpdate`). The other members approve the update with `approveGroupProposal` and the Grant with `approveGroupIpex`.
- The exact-file group presentation moves into the runtime: `preparePresentationFile`, `resumePresentationFile` and `deliverPreparedGrant` hold every check of what a file may change, and the elected lead's delivery is a presentation operation with the same retry. `tufa ipex` for these files only reads and writes them; `preparePresentationGrant` and `resumePresentationGrant` are removed with no replacement.
