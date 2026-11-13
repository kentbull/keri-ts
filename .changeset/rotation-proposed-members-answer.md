---
"keri-ts": patch
---

A rotation's proposed new members can answer the proposal before they are signing members of the group. #996 made the multiplexor drop a wrapper from an identifier that is not a signing member of the receiver's local group; the approvals of a rotation come from the members it adds (for example the edge and service members of an enrollment), so the proposer never received them and the rotation never completed. The sender check now also accepts the proposal's own `smids` and `rmids` for a `/multisig/rot` wrapper.
