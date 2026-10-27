# @keri-ts/verifier

Credential verifier application policy, webhook projection and workflow storage.
The package borrows public `keri-ts/runtime`, `keri-ts/db` and `cesr-ts` operations;
it does not start a host, open protocol stores, register CLI commands or own
protocol acceptance. The existing agent consumes legacy credential/TEL evidence;
this extraction adds no native ACDC v2 workflow.

```ts
import { createVerifierCueBaser, VerifierAgent } from "@keri-ts/verifier";
```

Composition supplies the Habery, Reger, protocol processor, application cue Deck,
scoped HTTP client and epoch-millisecond clock. The caller owns scheduling and
closes the cue sidecar before its enclosing protocol stores. `VerifierAgent`
keeps pending/ready issuance and revocation webhook work in `VerifierCueBaser`;
HTTP success markers are local workflow history, not KERI receipts or business
acknowledgements. Schema-specific validators decide business policy separately
from authenticated protocol evidence.

`tufa verifier run` remains the CLI composition. `@keri-ts/hosting` exposes
the concrete HTTP host; verifier applications import this package directly.

Run `deno task check`, `deno task test` and `deno task build:npm` from this directory.
Licensed under Apache-2.0; see the repository's `LICENSE`.
