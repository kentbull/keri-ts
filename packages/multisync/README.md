# @keri-ts/multisync

`@keri-ts/multisync/v2` selects explicit existing-registry root copies after an
accepted group rotation. This is application policy, not a new KERI wire protocol.

```ts
import { selectNewcomerCopies } from "@keri-ts/multisync/v2";

const copies = selectNewcomerCopies({
  hby,
  group,
  rotation,
  previousSigningMembers: priorSigningAids,
  registries: selectedRegistrySaids,
});
```

The rotation must be the current accepted group establishment. Current signing
membership must match its accepted keys; next-key-only members are excluded.
The caller supplies the preceding signing roster transiently and selects every
registry explicitly. The selector neither persists rosters nor discovers roots.

Tufa's `vc registry root newcomers` instead uses `RegistryRoot.newcomers` from
`keri-ts/runtime`, which derives the preceding roster from the accepted KEL, and
sends ESSR `/registry/root` copies by mailbox. This selector remains for callers
that supply the roster explicitly. It neither copies roots nor requests fresh DH.
