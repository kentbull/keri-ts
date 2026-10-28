# @keri-ts/verifier

Credential verifier application policy, webhook projection and workflow storage.
The package borrows public `keri-ts/runtime`, `keri-ts/db` and `cesr-ts` operations;
it does not start a host, open protocol stores, register CLI commands or own
protocol acceptance. The agent retains its legacy credential/TEL workflow and optionally composes
`AcdcV2Verifier` for authenticated ACDC v2 Grant views.

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

## ACDC v2 retained views and current use

`AcdcV2Verifier(hby, hab, exc, registrar, http, options)` borrows the actual Exchanger,
public evidence acceptor, local query signer and ordinary runtime HTTP client.
Options select one HTTPS observer cache URL (`source`), maximum observation age,
finite request deadline and a clock. The runtime's normal certificate trust and
URL hostname verification authenticate HTTPS; requests refuse redirects. The URL
must have no credentials, query or fragment. Queries never trigger registrar acquisition.
KEL/TEL proof authentication remains
independent of response-source authentication. Matching source/head/age establishes
only recent observation from that configured endpoint, never global latest state.

`inspectHistorical(grant)` authenticates the retained exact-route Grant through
historical inspection, returning its unchanged origin and view references without
queries, graph approval, current-standing claims, cues or reporting writes.
`verifyCurrent(grant)` acquires current public evidence, requires an issued origin
and the shared graph evaluator's explicit true with current per-node states.
A legitimately revoked far node is known False and may satisfy NOR/NAND; missing,
malformed or opaque evidence remains unresolved. Authenticated current public
openings are transient proof inputs, never enrichment of retained credential views.

Pass this concrete owner as `VerifierAgentOptions.acdcV2`. ACDC v2 workflow rows
reuse the existing cue tables keyed by Grant SAID, keeping partial/full views of
the same credential distinct. Every attempted ACDC v2 delivery rechecks current
policy: a previously ready webhook cannot bypass a later opaque head. Historical
accepted views and delivered markers remain history after revocation. ACDC v2
payloads identify the Grant, presenter, verifier and configured observations.
Transport failures retain ordinary pending webhook work; genuine cleanup/storage
failures remain visible. No exactly-once delivery is claimed.

`tufa verifier run --acdc-v2 --alias NAME --config verifier.json --hook URL`
composes this owner with `runtime.http`. Observation selection and freshness are
application policy in the existing schema-policy configuration:

```json
{
  "observation": {
    "url": "https://observer.example/",
    "maximumAgeMs": 15000,
    "requestTimeoutMs": 5000
  },
  "requireKnownSchemas": false,
  "schemas": {}
}
```

ACDC v2 requires `observation.url`. Omitted durations retain the 15,000 ms age
and 5,000 ms deadline defaults; supplied durations must be finite and positive.
Configure HTTPS trust through the runtime/platform trust settings. A missing or
expired observation cannot approve current use; unrelated cancellation, cleanup
and storage failures remain visible. Omitting `--acdc-v2` preserves the legacy lane.
