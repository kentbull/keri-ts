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
  issue, revoke, accepted-state persistence, TEL escrows and TSN admission/routes/retries.
  Tevery shares the composed Revery; this TSN ownership landed after 1.0.0 in #523.
- `db/reger.ts` owns KERIpy-shaped VDR storage and credential/TEL clone helpers.
- `vdr/backer-state.ts` selects historical backer rosters only through accepted
  management coordinates. Missing management evidence remains pending; Tevery
  revalidates accumulated signatures before admission and retries partial backer
  escrows. Exact accepted replays may add valid receipts without reapplying state.
- `vdr/credentialing.ts` owns issuer-side registry and credential orchestration.
- `vdr/tel-publication.ts` owns legacy TEL completion through `tmse`, `tpwe`,
  `tede` and `ctel`. Accepted anchors precede full witness receipt collection and
  local TEL publication. `app/tel-publishing.ts` performs finite receipt/fanout
  and witness transmissions; the ordinary host runs it. `ctel` stores the issuer
  anchor SAID and proves completed local publication, not remote TEL acceptance.
- `app/verifying.ts` owns verifier acceptance, schema/registry/chain escrows,
  wallet indexes, and chain policy.
- `app/ipexing.ts` registers version-specific IPEX policy; `ipex-v2.ts` owns
  disclosure and issuer-proof verification, using `ipex-graph.ts` for graph rules.
- `acdc/regbasing.ts` owns the public registry paths, LMDB lifecycle and typed
  `evts`/`tels`/`heads` bindings (physical `evts.`/`tels.`/`heds.`), plus
  optional existing `ancs.`/`maes.`/`ooes.` adapters.
- `acdc/registering.ts` supplies storage-only RegistryStore access, aliases,
  accepted-body cloning, earliest-anchor retention and insertion-ordered escrows.
- `acdc/observing.ts` supplies explicit public parsed registry intake through
  the engine. Ordinary RIP/BUP dispatch uses this owner; runtime sweeps discover
  pending foreign registries from durable escrows, not local aliases. AgentRuntime
  retains Regery/store lifecycle ownership. IPEX reads accepted ordinals through
  RegistryStore and retains a presentation with an unresolved referenced update.
- `app/ipex-credentialing.ts` owns KERIpy-shaped grant/admit credential
  artifacts.
- `app/verifier-agent.ts` owns Sally-like webhook sending and durable ack/retry
  state.

## Boundary Rules

- Registry-backed v1 credentials and ACDC-native v2 messages are different
  lanes. Do not apply v2 most-compact top-level SAID rules to v1 KERIpy
  registry credentials.
- TEL decisions should stay typed: accepted, duplicate, escrowed, or rejected.
  A registry inception still waiting for its issuer anchor remains escrowed
  across retries. Unexpected processing or storage failures propagate without
  turning that retained evidence into a peer rejection.
  Expected retry paths are not exception control flow. Revocation evidence writes
  precede ordinary cue publication. Infrastructure failures propagate unchanged;
  cue records have no reservation, credit or capacity lifetime.
- Tevery owns each synchronous TEL transaction and refuses a caller-owned writer.
  It evaluates a private Tever from accepted storage; cached Tevers retain neither
  input policy nor a cue Deck. Publish registry cache changes and revocation cues
  only after commit, so failed writes/commit leave accepted live state unchanged.
- IPEX is EXN conversation state. It should not own TEL acceptance or wallet
  persistence.
- Verifier webhooks are not notifier state. `Notifier` gives operator
  visibility; durable verifier work is driven from accepted grants, TEL state,
  saved credential indexes, and verifier cue sidecars.
- VerifierAgent scans only the initial Deck extent, preserves unrelated cue order,
  and requeues records when durable verifier publication fails. Webhook waits
  occur in its concrete I/O operation. Verifier sidecars do not borrow Reactor's
  protocol serialization. Duplicate revocations produce no second webhook.

## Legacy TEL backing boundary

The application authors NoBackers registries and `iss`/`rev` TELs. Autonomous
legacy TEL signing, hosting and backed-registry authoring are retired under
[ADR-0014](../../adr/adr-0014-legacy-tel-backer-retirement.md); the
[reference report](../../reports/credentials/LEGACY_TEL_BACKER_RETIREMENT.md)
preserves the former design. External `vcp`/`vrt`/`bis`/`brv` evidence still uses
ordinary observer validation and replay, including its exact historical backer
quorum. Issuer multisig approval and KEL witnessing remain separate obligations.

## V2 Registry Evidence

`vet` and `vetBinds` accept parsed Serders and node-local
`BlindState`/`BoundState` values. They return `verified` with complete state,
`missing` with issuer/event coordinates for a retryable absent anchor, or `reject`
with a reason. The owning workflow decides whether/how to persist and retry;
these helpers emit no cues and do no writes. Database and programming failures
propagate. They are exported from `keri-ts/runtime` as `vet` and `vetBinds`, matching the
reference module names. Pure verification does not acquire or dispose resources.
The [verified-import preservation record](../../reference/credentials/VERIFIED_IMPORT_SNAPSHOT.md)
preserves the removed custom bulk-import design. Public RegistryObserver intake
now uses the registry engine; do not restore direct accepted-row publication.

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
milliseconds to six digits. Python accepts a broader datetime grammar. Public issuer orchestration and the supported composed workflows are implemented;
the [release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md) records qualification and limits.

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
Named services are explicitly acquired and composed into the runtime workers.
`acdc/registraring.ts` supplies explicit local Regery/Registry creation and alias
lookup. Reopen resolves the controlling Hab from the stored inception issuer;
multiple aliases share one instance. Inception staging and alias publication
share a transaction, and in-memory maps change only after it commits.
`createRegery` owns a default backend until transfer, joining cleanup if loading
fails; injected backends stay caller-owned, including after `close`. Owned close
is joined and repeat-safe. Opening binds the current registry layout.
Local `blind` also applies the separately inspected 71438328 v2 schema profile
before derivation/staging. Internal `acdc/scheming.validateSchema` returns valid,
missing SAID, or invalid content; caller-facing missing/failed errors remain
separate from propagated storage/invariant failures. Static Draft 2020-12
resources require content-bound IDs and plain semantic versions. Bare/sad/DID/OOBI
references resolve only from the local cache, including fragments and verified
bundles; dynamic/recursive keywords are prohibited. Legacy Schemer is unchanged.
TS refuses ambiguous duplicate anchors as invalid; pinned 714 selects its first
anchor. This stricter local policy prevents validator-specific ambiguous resolution.
JSON schema resources are supported; validation consumes decoded ACDC data.
Validation imposes no application byte, value, depth, reference or resource-count
quota. Resource identity and visited schema scopes drive local reference discovery;
the validator still checks the actual schema and credential content.
Override/cache validation does not qualify the [embedded bundle builder](../../plans/cesr/MAPPER_PLAN.md).

Local `blind` checks the parsed credential's SAID, registry and issuer, then derives
its disclosure and bup together. Its next ordinal follows the accepted head plus
one unambiguous staged successor per slot across both escrows, including after
reopen. Competing successors refuse construction; staged bodies never establish
acceptance. Bound-state options remain separate from body serialization options.
The engine chooses the ordinal and refuses caller-supplied blinder overrides.
Registry `present` and `vacate` reuse that frontier and disclosure derivation.
Presentation validates only the grant target's digest syntax; it authenticates
neither the grant nor its sender. Empty-target/state vacuous steps preserve the
preceding binding only when `vetBinds` receives every intervening disclosure.
Call Regery for local creation and alias lookup, then Registry for blind/present/
vacate. The legacy and v2 Registrar wrappers are removed: they had no production
consumers or independent responsibility. KERIpy retains those convenience classes;
TS uses its existing concrete owners with the same protocol behavior. No alias-
resolving forwarding class replaces them. Frontier traversal still scans local
store state; application scan accounting is removed.
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

Explicit `RegistryObserver` parsed intake borrows public Baser and RegistryStore,
requiring no local controlling Hab or aliases. This is TypeScript integration
beyond frozen 927, using the ported engine rather than a bulk chain transaction.
It is not a global freshness observer or automatic parser/runtime route. Incoming
updates before inception stage body/anchor-escrow rows, never accepted markers;
the stored, self-validating inception supplies issuer identity after reopen.
`processEscrows(regid)` explicitly retries one registry through ordinary engine
anchoring and ordering. Its full tuple/witness policy deliberately exceeds
digest-only `vet` evidence. There is no application event-count ceiling. Incoming
ordinals retain bigint precision until checked conversion at the numeric storage
boundary, including events staged before inception.
Each accepted event commits independently, preserving a prefix if a later event
fails. Corrupt stored inception/accepted state and datastore failures propagate.

Current stores bind event, ordinal, head, anchor and both escrow tables at open.
There are no absent-table fallbacks or lazy initialization for old layouts.
Readonly reopen uses those existing tables without rewriting evidence. Body
presence does not establish acceptance; `tels` contains accepted ordinals and
`heads` caches their current head. Local `regs.` aliases remain optional because
public observer stores have no local aliases.
Alias records contain only
`registryKey`, distinct from legacy VDR records. Earliest-anchor storage compares
full bigint NumberPrimitive values, preserving equal/later reseals unchanged;
its caller authenticates the Number/Diger couple. Storage `accept` publishes
caller-approved markers; event/anchor validity and duplicate/head protection stay
with the processing engine. `openRegistry` transfers one LMDB owner after joined
acquisition; RegistryStore wraps that owner, and explicit close delegates to it.
The facade rejects negative/unsafe numeric ordinals before any storage mutation;
engines retain incoming ordinals as bigint until checked conversion. `cloneTel`
eagerly collects accepted bodies without application accounting. The web backend remains unsupported.
The custom whole-chain import API is removed. RegistryObserver validates and
commits each event through the normal engine; missing anchors/order remain in
escrow for explicit retry. Old keri-ts layout compatibility is not supported.
The historical [import design](../../reference/credentials/VERIFIED_IMPORT_SNAPSHOT.md)
remains deferred. Automatic parser intake and global freshness are separate work.

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

## Credential input ownership and finite completion

`importCredentialStream(protocol, reger, bytes, clock, timeoutMs = 5000)` borrows
one configured `ProtocolProcessor` and its credential/TEL store. The finite input
operation owns its parser and input-specific Kevery. It dispatches each complete
frame once before pulling the next; a malformed later frame does not roll back earlier
acceptance. Source and suspending-handler cleanup join before the operation exits.
The CLI buffers its file/stdin input before invoking this operation, after validating
its settlement timeout. Settlement retains compact input identities, not frames,
attachments or previous dispatch decisions.

Parsing EOF is separate from acceptance. Existing accepted records determine
completion for directly imported identities, deduplicated in first-seen order:

| Input                                            | Persisted acceptance predicate               | Meaning                                                                                          |
| ------------------------------------------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Raw credential                                   | `Reger.saved` marker                         | Verified credential acceptance; `Reger.creds` raw material alone is insufficient.                |
| KEL support                                      | Exact prefix/sequence/digest in accepted KEL | This event is accepted, regardless of a later current head.                                      |
| Registry or credential TEL, including revocation | Exact prefix/sequence/digest in accepted TEL | Registry/credential state evidence, not a newly saved credential.                                |
| Exchange, including IPEX grant                   | Accepted EXN in `Baser.exns`                 | The exchange is accepted; embedded credential artifacts remain behind their explicit workflow.   |
| Other message kinds, including receipts/replies  | Existing protocol handler                    | Dispatched normally; absence of an importer predicate does not make the message a failed target. |

The result contains `saved`, `complete` and `unaccepted`. `saved` contains only
newly accepted raw credential SAIDs from this input, using the saved marker observed
before each credential's first dispatch. Unrelated credentials recovered by a shared
escrow pass do not appear there. `unaccepted` lists observed identities without
their normal accepted evidence; `complete` means that list is empty. Completion
does not certify every input occurrence or impose another validation policy on
every CESR message kind.

Direct refusals are logged, and escrow owners report actual terminal ejections.
A refused duplicate does not override already accepted state or hide an earlier
successful save. Grant acceptance remains separate from credential admission;
importing a grant does not process its embedded children.

After EOF, import checks acceptance before sweeping unrelated escrows. While
observed records remain unaccepted, it runs an ordinary shared escrow sweep and
checks again. Between sweeps it yields through a one-millisecond clock timer so
cancellation and the settlement deadline can run. Accepted input returns promptly;
missing dependencies may consume the whole configured settlement window. Escrow
owners expose no progress status, and import does not infer quiescence from counts
or snapshots. It retains no frames for redispatch and never waits for every global
escrow to empty. New external evidence may enable later recovery.

The local settlement deadline starts after EOF. `tufa vc import --settlement-timeout-ms <ms>` passes the explicit library timeout, defaulting to
5000 ms. Both boundaries reject nonfinite, zero and negative values before intake;
positive fractions are floored with a one-millisecond minimum. The deadline bounds
asynchronous settlement and logs exhaustion; it cannot interrupt synchronous
processing midway through a sweep. Deadline cancellation joins active work before
the final acceptance read. Handler/source/storage/cleanup failures still propagate
with their original causes and partial accepted state intact.

This local operation does not start discovery,
Poster delivery, mailbox polling, or full-runtime workers. The caller still owns
cancellation of intake itself. `tufa vc import` prints the structured result and
exits unsuccessfully when `complete` is false. Detailed processing/ejection reasons
remain in stderr diagnostics; accepted partial state remains available.

`processCredentialPresentationArtifacts(protocol, artifacts)` separately consumes
`anc`, `iss`, then `acdc`, honoring each artifact's genus selector. It advances
escrows once after intake; recurring IPEX/VerifierAgent callers own subsequent
scheduling and never enter the finite-import settlement loop. VerifierAgent borrows
the shared processor directly. Neither operation uses Reactor.
