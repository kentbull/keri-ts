# ACDC learnings

## Commitments and disclosure

Section identifiers are label-aware: schema $id, ordinary d, aggregate agid.
Aggor commits to its CESR/JSON/CBOR/MGPK list framing and verifies map SAIDs;
generic counted groups remain Structor values. Its native count includes the
enclosure; non-native count is null. Issuee projection needs disclosed attributes
or the first aggregate member; a compact commitment does not disclose a recipient.

V2 compactable ACDCs verify most-compact top-level commitments while visible raw
still round-trips from visible SAD. Partial section-message ilks keep the section
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
Verifier owns cached schemas, registry/schema/chain dependencies and saved indexes;
direct revoked saves and revoked-chain rejection are distinct. Regery/Registry/
Registrar/Credentialer compose issuer-side operations. Normal outcomes stay typed.

V2 `regeventing.vet/vetBinds` observer verification is read-only; import/persistence belongs to its
store and workflow. Supplied anchored prefixes cannot hide an unanchored suffix.
Disclosed issuer/target/rd, blinded/bound state and historical cutoff are separate
checks. Shared time/mod.ts parsing retains exact microseconds and requires an explicit
RFC3339 zone; cutoff selection includes events exactly at the supplied timestamp.
Supplied chain authentication does not prove global freshness. IPEX
presentation cutoffs require receiver-observed KRAM time, still pending.
Share parsed rip/bup field validation across observer and local processing, but
retain their anchor rules: observer digest seals do not satisfy the local full
tuple plus witness-receipt requirement. Field validity is not TEL acceptance.
Local TEL publication must atomically commit body, anchor, accepted ordinal/head
and escrow cleanup; bind instance state only after the transaction succeeds.
Stored body presence alone never counts as acceptance or an accepted predecessor.
Duplicate replay is read-only and cannot move the head backward. Missing anchors
precede ordering escrow; unsafe numeric storage ordinals require explicit refusal.

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

## Remaining work

The [registry foundation](../../docs/plans/credentials/REGISTRY_PLAN.md) owns
full v2 services and the custom-import audit. Preserve legacy VDR and #168 stores;
storage readability, observer vetting and issuer processing are separate gates.

Standalone Mapper currently accepts a tampered map with a stale claimed d despite
saidive verify. The [focused repair](../../docs/plans/cesr/MAPPER_PLAN.md) must use
independent positive/tampered formats and preserve Aggor disclosure semantics.
[IPEX](../../docs/plans/exchange/IPEX_PLAN.md) retains presentation/qualification
gates; do not relist already implemented CLI/verifier workflows as missing.
Broader dissemination/revocation and DB-row parity claims require their actual
maintained scenario evidence.

[Credential contract](../../docs/design-docs/credentials/ACDC_TEL_VERIFIER.md),
[disclosure contract](../../docs/design-docs/credentials/GRADUATED_DISCLOSURE.md).
