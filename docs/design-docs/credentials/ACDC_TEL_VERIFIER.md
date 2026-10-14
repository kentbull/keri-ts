# ACDC, TEL, IPEX, And Verifier Maintainer Guide

## Purpose

Give maintainers the current mental model for the registry-backed credential
stack added through the 0.8.0 and 0.9.0 work.

This is not a user tutorial. It is the ownership map for reviewing and changing
credential behavior without collapsing ACDC, TEL, IPEX, wallet, and verifier
responsibilities into one vague "VC" layer.

## Ownership Model

- `acdc/regeventing.ts` verifies supplied v2 `rip`/`bup` evidence against already
  accepted KEL state; it owns no fetching, persistence, or issuer-side processing.
- Internal `acdc/regengine.ts` owns local event acceptance and anchor/order escrows,
  borrowing an issuer's public KEL and RegistryStore without acquiring secrets.
- `vdr/eventing.ts` owns legacy TEL state processing: registry inception, rotation,
  issue, revoke, accepted-state persistence, and TEL escrows.
- `db/reger.ts` owns KERIpy-shaped VDR storage and credential/TEL clone helpers.
- `vdr/credentialing.ts` owns issuer-side registry and credential orchestration.
- `app/verifying.ts` owns verifier acceptance, schema/registry/chain escrows,
  wallet indexes, and chain policy.
- `app/ipexing.ts` registers version-specific IPEX policy; `ipex-v2.ts` owns
  disclosure and issuer-proof verification, using `ipex-graph.ts` for graph rules.
- `acdc/regbasing.ts` owns the public registry paths, LMDB lifecycle and typed
  `evts`/`tels`/`heads` bindings (physical `evts.`/`tels.`/`heds.`), plus
  optional existing `ancs.`/`maes.`/`ooes.` adapters.
- `acdc/registering.ts` supplies storage-only RegistryStore access, aliases,
  accepted-body cloning, earliest-anchor retention and insertion-ordered escrows.
- `db/registry-evidence.ts` extends that same RegBaser owner for accepted v2
  observer chains, separately from Reger.
- `app/ipex-credentialing.ts` owns KERIpy-shaped grant/admit credential
  artifacts.
- `app/verifier-agent.ts` owns Sally-like webhook sending and durable ack/retry
  state.

## Boundary Rules

- Registry-backed v1 credentials and ACDC-native v2 messages are different
  lanes. Do not apply v2 most-compact top-level SAID rules to v1 KERIpy
  registry credentials.
- TEL decisions should stay typed: accepted, duplicate, escrowed, or rejected.
  Expected retry paths are not exception control flow.
- IPEX is EXN conversation state. It should not own TEL acceptance or wallet
  persistence.
- Verifier webhooks are not notifier state. `Notifier` gives operator
  visibility; durable verifier work is driven from accepted grants, TEL state,
  saved credential indexes, and verifier cue sidecars.

## V2 Registry Evidence

`vet` and `vetBinds` accept parsed Serders and node-local
`BlindState`/`BoundState` values. They return `verified` with complete state,
`missing` with issuer/event coordinates for a retryable absent anchor, or `reject`
with a reason. The owning workflow decides whether/how to persist and retry;
these helpers emit no cues and do no writes. Database and programming failures
propagate. They are exported from `keri-ts/runtime` as `vet` and `vetBinds`, matching the
reference module names. Pure verification does not acquire or dispose resources.
The [verified-import preservation record](../../reference/credentials/VERIFIED_IMPORT_SNAPSHOT.md)
retains the custom store workflow pending its separately owned intake audit.

Every supplied event must have a valid chain position and issuer KEL anchor.
Verifier anchors compare seal digests, including bare digest seals; sequence
hints in the seal are not load-bearing. This differs from issuer-side local TEL
anchor processing, which requires the full seal tuple and witnessed event.
Shared `validateRip`/`validateUpdate` helpers return parsed facts or a typed
rejection. They check inception issuer and optional update predecessor without
accepting an event or deciding continuity against a stored head. `vet` reuses
these field rules; `regcept`/`blindate` remain the existing pure constructors.
`verifyRegistryAnchor` checks an explicit Number/Diger couple against the last
accepted KEL event, its witness threshold and the exact registry/ordinal/digest
seal. An absent, mismatched or unrepresentable KEL location returns false;
storage failures propagate. These helpers provide no TEL persistence or escrow.
Distinct anchored candidates at one ordinal are duplicity; a candidate whose
anchor is still absent prevents an early conclusion. This authenticates only
the evidence supplied, not the global freshness of the registry.

Disclosed target, issuer, and optional credential `rd` must agree. An `rd`-less
credential produces an explicit `oneway` binding. A blinded head authenticates
no credential without disclosure. Binding resolution walks backward through
vacuous updates, requiring exactly one authentic disclosure for each visited
update. Historical cutoff selection retains microseconds and needs a trusted
receiver-observed timestamp supplied by the owning workflow; it does not create
or authenticate KRAM receipt state.

The implementation follows unmodified upstream `927c0cb8` verifier semantics.
Bound-state verification here authenticates the full tuple commitment; it does
not independently establish the meaning of its issuee key-state coordinates.
The [ACDC specification](https://github.com/trustoverip/kswg-acdc-specification/blob/0b23845da67fa804261399fcc71d88478e67b8fb/spec/spec-body.md#transaction-event-logs-tels-as-acdc-state-registries)
defines the controlling KEL and blinded-state commitment basis.

The typed API takes parsed inputs, uses bigint TEL ordinals, and requires numeric
KEL hints to fit the database's safe-integer API. Shared `time/mod.ts` parsing
restricts cutoff text to timezone-qualified RFC3339 with at most six fractional
digits and retains exact microseconds; events at the cutoff are included.
`makeNowIso8601` accepts a caller-supplied `Date` for clock injection, padding its
milliseconds to six digits. Python accepts a broader datetime grammar. The issuer
engine's public orchestration and end-to-end production qualification remain unfinished.

The internal event entry point returns accept, duplicate, anchor/order escrow or
typed rejection. It discovers full, fully witnessed KEL seals; stored anchors
are already caller-verified evidence. One registry transaction stages the body,
anchor, accepted ordinal/head and escrow removal. Failure rolls back those rows
before binding the engine instance. Replay cannot rewrite an occupied slot or
downgrade a head; absent/corrupt accepted bodies propagate as invariant failures.
Duplicate replay opens no write transaction and remains usable on readonly stores.
Updates require an accepted predecessor with the exact prior SAID; a staged body
cannot satisfy ordering. Missing anchors take precedence over missing predecessors.
Protocol ordinals retain bigint precision, but the current storage API supports
only safe integer ordinals; larger updates receive an explicit `ordinalRange`
refusal before storage conversion. This is an unfinished storage boundary.
Named services are explicitly acquired; runtime scheduling remains a later gate.
`acdc/registraring.ts` supplies explicit local Regery/Registry creation and alias
lookup. Reopen resolves the controlling Hab from the stored inception issuer;
multiple aliases share one instance. Inception staging and alias publication
share a transaction, and in-memory maps change only after it commits.
`createRegery` owns a default backend until transfer, joining cleanup if loading
fails; injected backends stay caller-owned, including after `close`. Owned close
is joined and repeat-safe. Opening neither migrates nor rewrites old layouts.
Blind/present/vacate and runtime installation remain separate implementation gates.
Acceptance advances already anchored successors one transaction at a time.
Explicit `processEscrows` retries both families, pruning invalid prior links;
later failures preserve earlier committed events. `anchorMsg` validates stored
events before saving a verified explicit couple, requires both source primitives
or neither, and retains the earliest anchor across reseals. Authentication of an
explicit anchor is durable separately from subsequent event/chain acceptance.
Explicit missing-anchor retry groups candidates by ordinal and discovers all
visible anchors before choosing siblings by anchor number, anchor digest, then
event SAID (code-point order). Unanchored candidates sort last. Dangling bodies
and stale candidates leave escrow; corrupt records and I/O failures propagate.
The read cursor closes before replay writes. This pass still collects registry
escrow rows; shared scan admission remains part of the resource-policy phase.

Existing #168 stores retain their paths, bodies, 32-digit ordinal keys and head
markers. Readonly opening binds the existing three tables without rewriting or
migrating rows. Body presence does not establish acceptance; `tels` contains the
accepted ordinals and `heads` is their current head cache. Missing anchor/escrow
and `regs.` alias tables remain null on old layouts; reads create no tables.
Explicit storage writes initialize their facilities. Alias records contain only
`registryKey`, distinct from legacy VDR records. Earliest-anchor storage compares
full bigint NumberPrimitive values, preserving equal/later reseals unchanged;
its caller authenticates the Number/Diger couple. Storage `accept` publishes
caller-approved markers; event/anchor validity and duplicate/head protection stay
with the processing engine. `openRegistry` transfers one LMDB owner after joined
acquisition; RegistryStore wraps that owner, and explicit close delegates to it.
The facade rejects negative/unsafe numeric ordinals before any storage mutation;
engines retain incoming ordinals as bigint until checked conversion. `cloneTel`
eagerly collects accepted bodies and provides no shared-budget guarantee; IPEX
must reserve credit before collecting. The web backend remains unsupported.
Verified observer import retains its complete-
chain check and atomic publication. The full registry service remains unfinished.

## IPEX

The [IPEX design](../exchange/IPEX.md) owns nested negotiation, issuer proofs,
construction and payload ownership.

## Credential Presentation Artifacts

KERIpy-compatible grant material keeps three streams distinct:

- `acdc`: credential body plus SealSourceTriples proof attachment.
- `iss`: TEL issue or revoke stream for the credential.
- `anc`: issuer KEL event anchoring the TEL event.

Do not conflate `anc` and `iss`. That mistake breaks KLI-issued credential
presentation because the TEL source seal and KEL anchor are separate evidence.

## CLI/Interop Surface

- `tufa vc schema import` pins JSON schemas.
- `tufa vc registry incept|list|status` manages local registry state.
- `tufa vc create|list|export|import|revoke` drives credential lifecycle and
  import/export streams.
- `tufa ipex apply|offer|agree|grant|admit|spurn|list|poll|join` drives IPEX
  conversation and credential settlement.
- `tufa verifier run` is the Sally-like sender; `tufa hook demo` is only a
  sample webhook receiver.

## Failure Conditions

- Saving verifier webhook ack state inside KERIpy VDR namespaces pollutes
  fixture comparisons.
- Assuming KERIpy holder `vc list` is the verifier's saved view hides accepted
  verifier credentials.
- Treating `/multisig/exn` as the business protocol skips the embedded IPEX
  message's own route and prior-response rules.
- Sending raw ACDC support over `/fwd` as if every forwarded SAD were KERI
  breaks mixed KLI/Tufa credential transport.
