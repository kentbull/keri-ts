---
"@keri-ts/wallet": minor
"keri-ts": minor
---

The web wallet covers groups. `wallet.groups` proposes and observes group events (`incept`, `rotate`, `interact`, `join`, `status`, `wait`), proposes a group registry (`inceptRegistry`) and adds the group's mailbox (`proposeMailbox` then `completeMailbox`). `wallet.proposals` is the one consent surface: `list` returns one typed list of key and reply events, registry events, group IPEX messages and group issuance Grants; `approve(id)` picks the library call from the proposal's kind and waits on the Counselor or the owner; `dismiss(id)` removes an event proposal's local notices. `credentials.issue`, `receive`, `present`, `unblind` and `pending` take a group identifier and use the group paths (the elected custodian begins an issuance; a holder group member approves the exchange and proposes or approves the Admit; a group presents a Grant; either group party can Unblind). Each waiting call returns a typed `outcome` and never throws for a normal wait. `AdmitDelivery` gains `by-lead` for a group Admit, which its elected lead delivers. The wallet's shared pieces moved to `src/web/surface.ts`; the public exports are unchanged.

keri-ts adds `pendingGroupGrants(ops, { group? })`, a pure read of the pending Grants addressed to a local group that its members have not consented to, and `GroupIpexProposal.prior`, the exchange an Admit answers.
