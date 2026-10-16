# ACDC learnings

## Commitments and disclosure

Section identifiers are label-aware: schema $id, ordinary d, aggregate agid.
Aggor commits to its CESR/JSON/CBOR/MGPK list framing and verifies map SAIDs;
generic counted groups remain Structor values. Its native count includes the
enclosure; non-native count is null. Issuee projection needs disclosed attributes
or the first aggregate member; a compact commitment does not disclose a recipient.

V2 compactable ACDCs verify most-compact top-level commitments while visible raw
still round-trips from visible SAD. Preserve supplied canonical a/e/r section
commitments, including partial roots; do not rehash their visible disclosure.
Compute the credential's most-compact commitment independently, as KERIpy does.
Blank semantic section mappings still need construction before disclosure.
Partial section-message ilks keep the section
expanded and verify embedded identifiers. V1 registry credentials use expanded-body
top-level SAIDs after subject saidification. Extend the shared native matrix rather
than creating a second ACDC parser.

Compactor retains canonical descendants across passes. Targeted compact(paths, root)
restores ancestors before descendants, preserving exact dotted-label paths; use
a fresh expanded instance per target. Frozen Python Compactor.raw stays stale after
compaction; TS keeps current-map serialization and compares a fresh reference Mapper.
Pather's 256-component resolution default is deployment policy, not a wire depth cap.
Construction/disclosure helpers supply no issuer authentication.

Fixed-field commitments hash actual primitive qb64 tuple bytes with d dummied,
not SAD strings. Noncer placeholders must remain representable. Unblind helpers
search candidates; they do not decrypt. Semantic verbs live in disclosure.ts,
record schemas in structing.ts and counted transport in wrappers.

## TEL, verifier and IPEX

Legacy Tevery/Tever owns accepted TEL state and out-of-order/anchorless escrow.
Revocation evidence persists before its ordinary cue is published. Storage or
publication failures retain their exact identity through router catches. TSN
pairs are appended in registry/credential order; captured replay stays lazy.
Verifier owns cached schemas, registry/schema/chain dependencies and saved indexes;
direct revoked saves and revoked-chain rejection are distinct. Publish ordinary
dependency/saved cues after writes. Registry/schema cues follow new escrow
membership; chain retries emit again. Storage failure preserves the retry family.
Regery/Registry/Credentialer compose issuer operations. Normal outcomes
stay typed. No queue capacity or metadata-credit contract belongs in these paths.

V2 `regeventing.vet/vetBinds` observer verification is read-only; explicit
RegistryObserver intake owns per-event engine publication, without bulk import. Supplied anchored prefixes cannot hide an unanchored suffix.
Disclosed issuer/target/rd, blinded/bound state and historical cutoff are separate
checks. Shared time/mod.ts parsing retains exact microseconds and requires an explicit
RFC3339 zone; cutoff selection includes events exactly at the supplied timestamp.
IPEX borrows RegistryStore and collects accepted updates without an event quota.
Ordinals must remain exactly representable by the numeric storage API; an existing
head with missing accepted rows is corruption.
Supplied chain authentication does not prove global freshness. IPEX
presentation cutoffs use completed receiver-observed KRAM time, retained through
dependency escrow and reopen. Partial group signatures do not complete that time;
later TEL updates and replay cannot refresh it. Independent-store HTTP workflows
with real KERIpy witnesses qualify the TS path; label credential-peer and mailbox
delivery evidence separately.
Share parsed rip/bup field validation across observer and local processing, but
retain their anchor rules: observer digest seals do not satisfy the local full
tuple plus witness-receipt requirement. Field validity is not TEL acceptance.
Local TEL publication must atomically commit body, anchor, accepted ordinal/head
and escrow cleanup; bind instance state only after the transaction succeeds.
Stored body presence alone never counts as acceptance or an accepted predecessor.
Explicit parsed RegistryObserver borrows public KEL/store without local Hab aliases.
Before inception, updates stay in durable anchor escrow; retry reconstructs issuer
from stored inception. Full tuple/witness intake is stronger than digest-only vet
and extends upstream integration, without establishing global registry freshness.
Duplicate replay is read-only and cannot move the head backward. Missing anchors
precede ordering escrow; unsafe numeric storage ordinals require explicit refusal.
Retry arbitrates anchored siblings as a set, using earliest anchor then digest
and SAID code-point order; database arrival order must not decide the winner.
Explicit anchoring validates event membership/prior before storing the couple.
Queued progression commits one event at a time; later failures do not undo prior acceptance.
Reopen named v2 registries from the stored rip issuer, not the first available
Hab. Duplicate aliases share one instance; injected RegBaser ownership stays with its caller.
Regery resolves local aliases; Registry owns its operations directly. Both legacy
and v2 Registrar forwarding facades are deleted: tests were their only consumers.
Do not restore class names merely to mirror KERIpy when no responsibility requires
them. Presentation checks target SAID syntax only; grant authentication stays
with IPEX. Empty-target/state vacuous steps need their own disclosures when
verifying the preceding effective binding. Blinded updates reuse the staged frontier.
Registry owns local blind/present/vacate construction and staged-frontier selection.
RegistryEventer shares validation, acceptance, anchoring and retries with observers,
exposing validated head metadata rather than local construction methods.
This deliberately differs from KERIpy 71438328, whose Registry delegates these
constructors to its eventer: the TypeScript observer shares that engine, so local
disclosure derivation stays with the local Registry without changing wire policy.
V2 local blind validates its schema before deriving any commitment. Keep missing
resource, invalid content and infrastructure failures distinct. Schema validation
has no byte/value/depth/reference/resource-count quotas; identity, reference
resolution and Draft 2020-12 correctness remain required.
The static 71438328 schema profile is separately qualified; preserve frozen927
commitments and legacy Schemer behavior. Validation consumes borrowed originals,
compiles private copies and never fetches references. Content-bound shallow JSON
bare-root schemas retain original bundled URI IDs across credential body formats; compact
s is their root ID. Serder checks commitments, while S1 checks each resource and
its profile. Verification never repairs stale explicit schema claims. Frozen
default/unbound format-specific schema construction remains separately qualified.

Local blinded updates follow a unique staged frontier across both escrows after an
accepted head. De-duplicate sightings, reject forks, and never equate staging with acceptance.

IPEX conversations, issuer proofs and wallet acceptance remain separate. Follow
[exchange learnings](PROJECT_LEARNINGS_EXCHANGE.md) for v2 nested routes and
coordination. Legacy grant artifacts distinguish acdc/cancs TEL source proof from
iss/ancs issuer KEL anchor; confusing them breaks credential presentation.

Verifier work comes from accepted grants, saved credentials and TEL state, not
Notifier visibility. Webhook retries/acks live in a separate sidecar, not Reger.
Bounded runs rescan persisted revocation state; issuance ack cannot suppress a
revocation, and rack prevents repeated revocation delivery. Verifier run sends;
hook demo is only a sample receiver.

## Interoperability traps

- Holder vc list filters by subject; verifier acceptance uses saved/exportable SAIDs.
- Mixed KLI/Tufa holder flows use real mailbox/IPEX transport. Forwarded support
  can begin with ACDC; never hydrate it unconditionally as SerderKERI.
- Measure pathed groups separately from complete framed EXN length when diagnosing
  quadlet failures. Preflight fixtures; do not patch the reference or weaken tests.
- Preserve vLEI topology: multisig GEDA/QVI/LE, delegated QVI, mixed witnesses,
  witness and separate KERIpy/Tufa mailboxes, OOR holder and Sally webhook target.
  Sally historical version/genus compatibility is separate reference evidence.
- Revocation can travel as raw credential support. Repeated recipient delivery and
  webhook idempotence require durable state, including process restarts.

The bidirectional HTTP disclosure tests own their conversation steps. Reusable
peers own only startup, signing, transport, state observations and cleanup; Python
test-control commands never substitute for public CESR ingestion. Graph data is
separate from peer lifetime. Preserve independent stores and per-node issuer
proofs, both refusal and admission, and hidden-field assertions when extending
scenarios. Full graph commitments stay separate from negotiated partials. Derive
each progressive reveal from the full node, never an earlier partial; validate
unchanged commitments and each grant's actual retained evidence. Later larger or
smaller selections and stored replay must not expand historical partials. Extra
or missing fields and plaintext carrying the original different commitment's
proof are independent refusal boundaries. Edge/schema refusal fixtures retain
both issuer proofs and vary only the named semantic defect; complete a valid
counterpart afterward and assert refused parent/child rows remain absent. This
separates actual edge/schema refusal from missing authentication setup. The test
README routes to the peer and graph fixture modules.

## Remaining work

The [registry foundation](../../docs/plans/credentials/REGISTRY_PLAN.md) owns
full v2 services and the recorded upstream intake gap. Preserve v1 VDR protocol
behavior. Current registry tables open together; old-layout fallback and migration
are not supported. Local aliases remain optional for public observer stores.
Storage readability, observer vetting and issuer processing are separate gates.

Standalone saidive Mapper verifies top-level claims across all input formats.
Compactor disclosure construction does not flat-rehash compact claims in expanded
maps; Aggor independently verifies its visible map commitments. The
[Mapper plan](../../docs/plans/cesr/MAPPER_PLAN.md) retains bundled schema-ID and
resource-encoding qualification separately from these checks.
[IPEX](../../docs/plans/exchange/IPEX_PLAN.md) retains presentation/qualification
gates; do not relist already implemented CLI/verifier workflows as missing.
Broader dissemination/revocation and DB-row parity claims require their actual
maintained scenario evidence.

[Credential contract](../../docs/design-docs/credentials/ACDC_TEL_VERIFIER.md),
[disclosure contract](../../docs/design-docs/credentials/GRADUATED_DISCLOSURE.md).
