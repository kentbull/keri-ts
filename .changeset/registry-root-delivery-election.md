---
"keri-ts": patch
---

Add `groupElectedMember`, the KERIpy `GroupHab.elected` election of the current signing member with the lowest verified signature on an accepted group event, and `deliverRegistryRoots`, which sends prepared `/registry/root` copies through Poster and returns one sent or failed outcome per copy. Both are exported from `keri-ts/runtime`. `tufa vc registry root send|newcomers` and group issuance custodian selection now use them without changing their behavior.
