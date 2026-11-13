---
"keri-ts": patch
---

`Habery.retireHab(pre)` retires a local, non-group habitat at the store level. It deletes the `habs.` record and the `names.` mapping, removes the prefix from the local prefix set and the habitat cache, and deletes the Keeper's stored key rows through the new `Manager.forget(pre)`: `prms.`, `sits.`, `pubs.` and the `pris.` seeds. It returns a `RetiredHab` naming the prefix, the alias and how many private keys were deleted. The KEL, key state, receipts and every accepted reply stay, so the identifier becomes an ordinary remote one, also after a reopen, and BADA still refuses an older reply replayed later. Retirement refuses group habitats, a local group's recorded or accepted member, and the delegator of a local habitat. It makes no event.

Retirement deletes the stored keys and the ability to act as a local habitat, not the secret's derivability: a rooted salty habitat's seeds stay derivable from the Keeper's root salt plus its namespace and name. The Keeper's `pres.` rows are kept so that `makeHab` refuses any later inception that derives a retired identifier's first key, in either transferability encoding. A retired name can therefore not be reused with the same salt and namespace. `Hab.make` now leaves no `habs.`, `names.` or Keeper rows behind when local acceptance of its inception fails.
