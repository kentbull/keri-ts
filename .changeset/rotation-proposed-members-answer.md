---
"keri-ts": patch
---

A rotation's proposed new members can answer the proposal before they are signing members of the group. #996 made the multiplexor drop a wrapper from an identifier that is not a signing member of the receiver's local group; the approvals of a rotation come from the members it adds (for example the edge and service members of an enrollment), so the proposer never received them and the rotation never completed. A `/multisig/rot` wrapper from a non-member is now accepted only when it is named in the wrapper's own members and a stored wrapper for the same rotation from a current signing member or a local identifier names it too, so a sender cannot certify itself. A proposed member's approval that reaches another current member before the proposer's wrapper is dropped there; the completed event still reaches it by the lead's forwarding.
