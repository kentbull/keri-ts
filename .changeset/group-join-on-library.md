---
"keri-ts": minor
---

`tufa multisig join` selects and approves stored proposals through the library: it lists them with `listGroupProposals` (or finds the `--said` one with `findGroupProposal`), asks the user for each unapproved proposal in notice order, approves only one that gets a yes with `approveGroupProposal`, and then waits on the runtime Counselor for receipts and delegation. `--auto` still approves the first pending proposal without asking, as KERIpy's `kli multisig join --auto`, but only inside the `join` command; no other command signs a proposal it was not asked to sign. A declined proposal is asked about once per command. `join --group <alias>` with nothing to join resumes the group's own latest event through the Counselor. The CLI-held `receiptAcceptedEvent`, `completeDelegationIfNeeded`, `waitForGroupAcceptance` and the stored-proposal polling loops are removed; backward compatibility with 2.1.0 is not a goal for 2.2.0.
