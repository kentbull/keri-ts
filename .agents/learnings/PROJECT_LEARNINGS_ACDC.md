# ACDC learnings

Credential workflows borrow one Regery for its coherent Habery, Reger, Tevery and
Verifier; delivery borrows Poster and import borrows ProtocolProcessor/Reger. Finite import
and grant artifact intake own their parser/input-specific Kevery; Tufa's VerifierAgent
borrows public protocol operations directly. Its policy, webhook formatting and
workflow records live in Tufa; protocol Verifier/IPEX/evidence remain in keri-ts. Recurring artifact intake retains its
single escrow pass; it does not start runtime workers. Finite import dispatches each
frame once, lets protocol escrows recover dependencies, and observes saved markers,
accepted KEL/TEL digests and accepted EXNs. It retains identities, not frames or
dispatch decisions. Ordinary sweeps yield through the clock until input acceptance
or a configurable post-EOF deadline; missing dependencies may use the full window.
Accepted records win over refused duplicates; receipts/replies still use their
handlers without an invented importer acceptance policy. Results contain saved,
complete and unaccepted; raw storage and imported grants never imply credential
acceptance. Unrelated escrow recovery is excluded from saved results; incomplete
CLI imports return failure. TEL row helpers
receive Reger directly. Multisig VDR approval checks availability after malformed/
declined proposal handling but before signing/intake. Group IPEX requires Reger for
grant approval/delivery and fresh admit approval; non-credential verbs need none.

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
not SAD strings. Opening `d` must equal the anchored canonical 44-character E-I
BLID, whose code selects the digest. Preserve carried text/number encodings and
public-mode empty `u` during verification. Noncer placeholders remain representable. Unblind helpers
search candidates; they do not decrypt. Semantic verbs live in disclosure.ts,
record schemas in structing.ts and counted transport in wrappers.

## TEL, verifier and IPEX

Legacy Tevery/Tever owns accepted TEL state and out-of-order/anchorless/partial-backer escrow.
BIS/BRV select the full accepted management tuple, never a raw or escrowed VCP/VRT.
Missing management state stays pending with its candidate signatures. Every admission
reverifies the union by unique index against that historical roster; accepted and
anchorless/partial evidence retains only verified contributions. Exact accepted
duplicates can add valid late receipts without reapplying state. Ordinary sweeps
retry partial backer evidence and remove completed family indexes after commit.
[ADR-0014](../../docs/adr/adr-0014-legacy-tel-backer-retirement.md) rejects
autonomous legacy TEL signing/hosting and backed-registry application authoring.
Keep externally received backed TEL verification, canonical proof tables, historical
cohorts and observer escrows; do not restore an active producer to support them.
Tevery owns the synchronous Reger writer, using a private admission candidate from
accepted storage. Tever retains no input policy/cue Deck; Tevery supplies policy
and publishes cache changes/revocation cues after commit. Caller-owned writers
are refused so an outer rollback cannot invalidate already-published live state.
Tevery also owns registry/credential TSN routes, independent reply admission and
Broker dependency retries. Record-only validators do not import processors.
Broker keys endorsement proofs by numeric establishment ordinal, matching both
Python references; primitive wrappers are not version selectors. The compatibility
inventory's COMP-12 owns this storage convention and its cross-version limits.
Revocation evidence persists before its ordinary cue is published. Storage or
publication failures retain their exact identity through router catches. TSN
pairs are appended in registry/credential order; captured replay stays lazy.
Verifier owns cached schemas, registry/schema/chain dependencies and saved indexes;
direct revoked saves and revoked-chain rejection are distinct. Publish ordinary
dependency/saved cues after writes. Registry/schema cues follow new escrow
membership; chain retries emit again. Storage failure preserves the retry family.
Escrow ejection warnings belong after actual owner removal/commit and include the
message identity and refusal detail. Acceptance cleanup, dependency migration and
EXN `preserveEscrow` are not rejection ejections; unexpected failures propagate.
Escrow owners return no recovery-progress status and take no proof/hint snapshots
for finite import. Tevery completes each captured TSN horizon in bounded pages;
new work beyond that horizon waits for a later sweep.
Local revocation checks the saved credential, selected issuer/NoBackers registry
and accepted issuance before any anchor signature. Explicit retry reuses the
accepted REV or original locally tracked tmse candidate and its source seal;
unrelated remote escrow cannot select a local authoring event. Corrupt retained
evidence fails instead of authoring a replacement anchor.
Regery/Registry/Credentialer compose issuer operations. Normal outcomes
stay typed. No queue capacity or metadata-credit contract belongs in these paths.

Group VCP/ISS/REV approval checks business bindings and actual credential source proof
before prompts/signatures. REV additionally binds the saved credential and
original accepted issuance. Its command resumes retained publication evidence,
waits for ordinal-one completion and gates external delivery/export on acceptance
and completed publication. Group delivery elects the lowest verified historical
anchor signer; member rotation does not move that authority. Explicit resend is
allowed without a delivery ledger. Missing registry/schema/predecessor evidence stays
pending; malformed evidence and conflicting aliases produce no local anchor.
Proposers admit each exact signed local wrapper before member delivery so returning
proofs can join an approved payload. Independently counted local/peer contributions
remain complete messages; never append a closed attachment enclosure as bare proof.
Reuse read-only registry-inception and exact TEL-seal checks from the TEL owners,
without processor construction or escrow writes for validation. Establishment-only
group anchors rotate using participants' prepared next keys. TelPublication owns
tmse/tpwe/tede/ctel progression. Accepted local TEL admission alone never marks
completion: the exact anchor's full historical witness cohort must be receipted
and local TEL publication must finish. The host runs finite receipt/fanout and
dissemination operations without a writer across I/O; interrupted work remains
in ordinary protocol escrow. ctel stores the anchor SAID, not the TEL SAID.
Remote observer acceptance is a separate fact.
Finite credential CLI commands run one host, polling member mailboxes for group
approval. They observe publication and saved-credential facts under elapsed deadlines,
join workers before stores close, and report partial state on timeout. Registry
policy comes from accepted configuration after reopen; EO anchors rotate for both
ordinary and group issuers.

V2 `regeventing.vet/vetBinds` observer verification is read-only; explicit
RegistryObserver intake owns per-event engine publication. Normal dispatch routes RIP/BUP
to this owner; runtime retries snapshot both durable escrow tables before writes,
including foreign registries with no local aliases after reopen. Supplied anchored
prefixes cannot hide an unanchored suffix.
Disclosed issuer/target/rd, blinded/bound state and historical cutoff are separate
checks. Shared time/mod.ts parsing retains exact microseconds and requires an explicit
RFC3339 zone; cutoff selection includes events exactly at the supplied timestamp.
IPEX borrows RegistryStore and collects accepted updates without an event quota.
Ordinals must remain exactly representable by the numeric storage API; an existing
head with missing accepted rows is corruption.
Supplied chain authentication does not prove global freshness. IPEX
presentation cutoffs use completed receiver-observed KRAM time, retained through
dependency escrow and reopen. An accepted source naming a not-yet-accepted registry
update stays retryable even when its RIP has arrived; intermediate ingress sweeps
must not turn that missing dependency into a binding rejection. An issuer RIP
without its first BUP likewise leaves registry-backed authentication pending. Partial group signatures do not complete that time;
later TEL updates and replay cannot refresh it. Independent-store HTTP workflows
with real KERIpy witnesses qualify the TS path; label credential-peer and mailbox
delivery evidence separately.
Share parsed rip/bup validation and one registry-seal matcher across observer and
local processing. Accept only `{d}`, `{s,d}`, or `{i,s,d}` with every supplied
coordinate matching. Both stateless vetting and durable discovery require the
current accepted KEL head's prior-digest ancestry and that event's historical
witness quorum. Superseded ordinal buckets retain history, not new TEL authority.
Field validity is not TEL acceptance.
Local TEL publication must atomically commit body, anchor, accepted ordinal/head
and escrow cleanup; bind instance state only after the transaction succeeds.
Stored body presence alone never counts as acceptance or an accepted predecessor.
Explicit parsed RegistryObserver borrows public KEL/store without local Hab aliases.
Before inception, updates stay in durable anchor escrow; retry reconstructs issuer
from stored inception. Exact seal/quorum authentication does not establish global
registry freshness. Source couples/triples remain unsigned per-intake hints:
reject resolvable false locators before writes or duplicate success, but never
persist their conditions or prevent a later clean replay.
Duplicate replay is read-only and cannot move the head backward. Missing anchors
precede ordering escrow; unsafe numeric storage ordinals require explicit refusal.
Retry arbitrates anchored siblings as a set, using earliest anchor then digest
and SAID code-point order; database arrival order must not decide the winner.
Explicit anchoring validates event membership/prior before storing the couple.
Retain a valid first pair across reverse presentation, reseals and reopen. Before
new TEL acceptance, remove a recovery-invalidated active pair and rediscover an
authentic current-branch seal; the same TEL SAID may become eligible again.
Keep already accepted TEL and historical KEL/FEL evidence unchanged.
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
hook demo is only a sample receiver. VerifierAgent takes a required epoch-millisecond
now function: local issuance/revocation Daters, webhook headers and expiry all use
it. Credential/TEL timestamps remain source evidence. Expiry is strictly greater
than the configured window and ready sending still precedes post-refusal expiry.

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
README routes to the peer and graph fixture modules. Conversation controls must
carry authentic signatures and traverse receiver intake, independent of guarded
builders. A wrong exchange may stop in KRAM before IPEX; assert the actual gate
and reason instead of mislabeling it a handler rejection. Public key introductions
select actual attachment genus, and Python node serialization uses its native
nested option; do not patch headers, mutate reference code or tolerate undecoded
wire to obtain a negative-case pass.

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
