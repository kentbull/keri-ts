---
"keri-ts": minor
"@keri-ts/tufa": minor
---

A group holder admits through the library. `runtime.operations.groupIpex` (`GroupIpexOperations`) owns a local group's v2 IPEX messages: `proposeGroupAdmit` (or `proposeGroupIpex` for any group-authored message, with its nested evidence) and `approveGroupIpex` are the explicit member consents; `groupIpexProposals` lists the stored proposals a member may approve; `groupIpexStatus` is a pure read derived from the stores and `waitForGroupIpex` only observes. The owner loop publishes each member's wrapper, retries a member that is briefly offline with a doubling delay (`RetryBackoff`), collects the other members' stored contributions, authorizes graph use and lets the elected lead send the completed message. `approveMultisigIpexLocally` splits a member's local approval from publication and delivery, and `findStoredMultisigIpex` and `groupIpexApproved` read the stored proposal. `tufa ipex admit --acdc-v2`, group `ipex grant` and `tufa ipex join` for ACDC v2 group messages are callers of these calls and keep their flags and output.
