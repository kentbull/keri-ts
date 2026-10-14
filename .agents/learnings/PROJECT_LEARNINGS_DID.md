# DID learnings

Static Tufa artifact files are response-owned: admit before open, read only on demand,
and join pending file work/close before returning credit. The request signal owns
acquisition only; host shutdown closes unconsumed bodies. File extent capture is not a content snapshot.

DID Webs resolution ingests keri.cesr, reconstructs the document from KERI/VDR
state and compares hosted did.json. Hosted JSON alone is not verification.
CESR resolution streams through the runtime Reactor with its exact services/policy;
only genuine EOF followed by escrow processing permits full-document comparison.
Late failure preserves independently accepted state. Native fetch-header failures
and HTTP refusals may use the existing URL fallback; injected client, body/parser,
storage, admission and cancellation failures propagate. Finite hosted JSON retains
an 8 MiB cap and a joined request/copy lease through comparison. Artifact generation
still collects histories; transport S2 owns output before release. Preserve
comparison, captured replay/proof ordering and accepted alias cutoffs. Static
CESR serving/export should stream too; finite DID JSON remains bounded parsing.
Numeric, flat/nested weighted and multi-clause thresholds project through
ConditionalProof2022 without reducing them to a scalar threshold.

Static artifacts and dynamic hosting share the generator; dynamic hosts select
prefixes explicitly. Universal Resolver path handling accepts encoded DID input
without decoding method-specific host-port %3A into a raw DID separator.

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
