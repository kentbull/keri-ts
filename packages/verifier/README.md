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

`AcdcV2Verifier(hby, hab, exc, registrar, options)` borrows the actual Exchanger,
public evidence acceptor and local query signer. Options select one authenticated
HTTPS observer cache (`SourceTrust` from hosting), maximum observation age, finite
request deadline and a clock. Source requests use the shared hosting TLS client;
queries never trigger registrar acquisition. KEL/TEL proof authentication remains
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

`tufa verifier run --acdc-v2 --alias NAME --observer https://HOST/ --observer-ca /absolute/ca.pem --hook URL` composes this owner. `--observer-cert-name` explicitly
maps an IP URL to an expected DNS certificate identity. `--maximum-age-ms` and
`--source-timeout-ms` configure local freshness and request policy. Omitting
`--acdc-v2` preserves the legacy lane.
