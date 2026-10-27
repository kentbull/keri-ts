# @keri-ts/hosting

Concrete Deno/Node HTTP hosting, app middleware and protocol route composition
for KERI runtimes. The package borrows public `keri-ts/runtime` and `cesr-ts`
operations; KERI continues to own protocol evidence and acceptance.

```ts
import { createProtocolHandler, createTufaApp, runHostKernel, startServer } from "@keri-ts/hosting";
```

`runHostKernel` composes the existing runtime and HTTP listener over a borrowed
Habery. It joins companion tasks, workers, active responses and owned resources
before teardown. `startServer` owns the concrete Deno/Node adapter lifecycle.
`createTufaApp` retains the existing Hono middleware/error policy around
`createProtocolHandler`; direct handler consumers close its artifact responses.
Names, routes, shutdown ordering and HTTP behavior are unchanged by extraction.

Tufa retains CLI registration and indirect/role/witness TCP composition. This
package introduces no role router, provider abstraction or alternate scheduler.
Import hosting APIs from this package directly; Tufa publishes its CLI surface.

Run `deno task check`, `deno task test` and `deno task build:npm` in this directory.
Licensed under Apache-2.0; see the repository's `LICENSE`.
