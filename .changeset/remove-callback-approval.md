---
"keri-ts": minor
---

Remove the callback approval API from the library. `approvePendingMultisigProposal`, `MultisigApprovalCallbacks`, `ApprovalPromptContext` and the notice-polling selection behind them are deleted; `MultisigApprovalOptions` now carries only `resume`, `groupAlias` and `registryName`. Use `listGroupProposals` or `findGroupProposal` to choose a proposal and `approveGroupProposal(deps, said, { groupAlias, registryName })` to approve it: calling it is the consent, so nothing prompts and nothing is selected for you. The callback shape is removed rather than wrapped or deprecated; backward compatibility with the published 2.1.0 API is not a goal for 2.2.0. `tufa multisig join` already uses the new API.
