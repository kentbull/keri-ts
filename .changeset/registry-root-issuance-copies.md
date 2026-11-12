---
"keri-ts": patch
"@keri-ts/tufa": patch
---

The DH custodian of a group issuance now sends its retained registry root to every other current signing member once issuance completes: the issuer custodian after `tufa ipex grant --issue`, and the holder custodian at the end of its group `tufa ipex setup`. Copies are fire and forget through the new `replicateRegistryRoots` in `keri-ts/runtime`: each is prepared with a per-registry hint, run under the remaining `--timeout`, and reported as a `root_copy` JSON line after the issuance result. Nothing is retried or recorded, duplicates are harmless, a failed copy never fails the issuance, and `tufa vc registry root send` is the recovery path.
