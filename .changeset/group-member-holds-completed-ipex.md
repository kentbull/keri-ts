---
"keri-ts": patch
---

Every member of a group now holds a group IPEX message the group completed, whether or not that member signed it, and
can accept the counterparty's answer in its thread. Before, a member whose signature the group did not need (a weight-0
co-member, say) held only the proposal wrapper: it never accepted the group's presentation Grant or Admit without
calling `approveGroupIpex`, so its KRAM refused the verifier's Admit with `unknownThread` and its store, the replay
source for a wiped co-member, lacked both. A member now takes a v2 group IPEX message, adding no signature, when the
copies it received carry the group's signing threshold, the exchange it answers is accepted, and it is not a group
issuer's DH Grant (new `groupIpexFollowable` and `groupThresholdSigned`): on receipt of the wrapper, or else on the
group IPEX owner's `GROUP_IPEX_FOLLOW_MS` sweep. A message below the threshold still waits for the member's consent,
and approving one the member already took still adds its signature.
