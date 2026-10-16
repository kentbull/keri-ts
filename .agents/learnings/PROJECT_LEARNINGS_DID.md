# DID learnings

Static Tufa artifact files are response-owned: open without reading, read on demand,
and join pending file work and close. The request signal owns
acquisition only; host shutdown closes unconsumed bodies. File extent capture is not a content snapshot.

DID Webs resolution ingests keri.cesr, reconstructs the document from KERI/VDR
state and compares hosted did.json. Hosted JSON alone is not verification.
CESR resolution streams through the runtime Reactor;
only genuine EOF followed by escrow processing permits full-document comparison.
Late failure preserves independently accepted state. Native fetch-header failures
and HTTP refusals may use the existing URL fallback; injected client, body/parser,
storage and cancellation failures propagate. Hosted JSON is collected and parsed
before comparison; there is no application byte cap, credit or copy lease.
Artifact generation still collects histories. Preserve comparison, captured
replay/proof ordering and accepted alias cutoffs.
Numeric, flat/nested weighted and multi-clause thresholds project through
ConditionalProof2022 without reducing them to a scalar threshold.

Static artifacts and dynamic hosting share the generator; dynamic hosts select
prefixes explicitly. Dynamic did.json uses the JSON-only artifact entry point,
preserving local-AID checks, schema pinning and document bytes without opening
CESR replay.
Universal Resolver path handling accepts encoded DID input
without decoding method-specific host-port %3A into a raw DID separator.

Alias selection uses the existing wallet issuer/schema indexes and ordinary
credential reads. Do not reintroduce alias metadata reservations, native decoder
interception, released ID owners or callback-only credential access. The unused
capture module and bounded clone helper were removed; active-state selection
remains in designated-aliases.ts.

Document projection borrows Habery and Regery directly; active-alias queries take
Regery. Those functions must not receive AgentRuntime or start intake workers.
Application resolution/artifact entry points select the actual state owners.
The did:keri five-turn resolver loop remains removal work: CLI owns finite-command
workers, while HTTP resolution already borrows an active host. Do not start a
second set of host consumers inside a shared resolver.

Designated aliases use ordinary registry-backed credentials and a SAID-checked
JSON schema. Current binding revokes the issuer/schema's active credentials before
issuing replacement; read the actual designated-aliases.ts contract before changing
semantics. Only accepted, unrevoked aliases feed document and artifact generation.

keri.cesr is not an OOBI reply bundle: replay controller/delegation KEL once, then
append stored witness/agent/mailbox location and role replies. Calling replyEndRole
per role repeats controller KEL. Witness recovery and explicit endpoint-role proof
are separate evidence needs.

Tufa owns dws/dkr CLI and HTTP hosting; runtime exports own resolution/generation.
Embedded Python resolver dependencies are independently pinned and imported. A KLI
upgrade does not qualify that environment; see the [reference inventory][pins].

[pins]: ../../docs/plans/qualification/REFERENCE_ENVIRONMENTS.md
