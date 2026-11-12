---
"keri-ts": patch
"@keri-ts/tufa": patch
---

After `tufa multisig rotate` or `tufa multisig join` sees a group rotation accepted, every signer of it that held a key in the prior establishment re-seals each registry root it holds for the group to every current signing member that is new in the rotation or whose contributing key changed, with no elected sender. `RegistryRoot.newcomers` gains a `rekeyed` option, `RegistryRoot.resealed` applies the sender rule, and `resealRegistryRoots` in `keri-ts/runtime` sends the copies fire and forget under a 30 second budget, printed as `root_copy` lines that never fail the rotation. The IPEX design doc and ACDC learnings now describe both automatic triggers and their limits.
