---
"keri-ts": patch
"@keri-ts/tufa": patch
---

The IPEX disclosure API names the prior exchange by its SAID in `priorSaid` everywhere. `DisclosureBodyOptions` (and `GrantPreparationOptions`) close the option types of `prepareOffer`, `prepareGrantBody`, `prepareGrantFileBody`, `prepareGrant`, `PresentationOptions` and so `proposeGroupPresentation`: the builder's `prior` is no longer an option, so passing it is a type error and untyped input carrying it is refused with a `ValidationError` instead of being ignored (which sent an opening exchange). The `agree`/`spurn` presentation input renames `prior` to `priorSaid`. `storedExchangeWire` is exported from `keri-ts/runtime` as the exact presented bytes of a retained exchange.
