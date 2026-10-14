# DID learnings

DID Webs resolution ingests keri.cesr, reconstructs the document from KERI/VDR
state and compares hosted did.json. Hosted JSON alone is not verification.
Current CESR fetch and artifact generation collect complete histories; transport
S2 owns streamed intake/output before release. Preserve complete-document DID
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
