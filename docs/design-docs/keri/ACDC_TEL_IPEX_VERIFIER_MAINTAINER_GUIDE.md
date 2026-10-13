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
- `vdr/eventing.ts` owns legacy TEL state processing: registry inception, rotation,
  issue, revoke, accepted-state persistence, and TEL escrows.
- `db/reger.ts` owns KERIpy-shaped VDR storage and credential/TEL clone helpers.
- `vdr/credentialing.ts` owns issuer-side registry and credential orchestration.
- `app/verifying.ts` owns verifier acceptance, schema/registry/chain escrows,
  wallet indexes, and chain policy.
- `app/ipexing.ts` registers version-specific IPEX policy; `ipex-v2.ts` owns
  disclosure and issuer-proof verification, using `ipex-graph.ts` for graph rules.
- `db/registry-evidence.ts` owns accepted v2 observer chains, separately from Reger.
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

`vetRegistry` and `vetRegistryBindings` accept parsed Serders and node-local
`BlindState`/`BoundState` values. They return `verified` with complete state,
`missing` with issuer/event coordinates for a retryable absent anchor, or `reject`
with a reason. The owning workflow decides whether/how to persist and retry;
these helpers emit no cues and do no writes. Database and programming failures
propagate. They are exported from `keri-ts/runtime`.

Every supplied event must have a valid chain position and issuer KEL anchor.
Verifier anchors compare seal digests, including bare digest seals; sequence
hints in the seal are not load-bearing. This differs from issuer-side local TEL
anchor processing, which requires the full seal tuple and witnessed event.
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
KEL hints to fit the database's safe-integer API. Cutoff text is restricted to
timezone-qualified RFC3339 with at most six fractional digits. Python accepts a
broader datetime grammar. The issuer engine and end-to-end production qualification
remain unfinished.

## V2 IPEX Runtime

Six v2 routes follow frozen `acdc/ipexing.py`; the existing v1 handlers/builders
retain their pathed protocol. Offer may disclose a reachable metadata subgraph.
Grant must satisfy the negotiated single-DAG plan in breadth-first order and
supply an independent issuer proof for every child. A declared registry takes
precedence over direct issuer anchors, which take precedence over current issuer
signatures. Parent proofs never authenticate children. `NOT`/`DI2I` remain
recognized but unsatisfied, matching the reference. Deeper child-owned nests are
guarded until their processing is defined.

`ipexExnBody` synchronously accepts parsed credential bodies and explicit route
options. It reads no payload or storage and authenticates no signatures. Opening
callers supply an exchange id; replies preserve parties and the prior id.
`nestedPayload`/`framePayload` borrow parsed frames and owners through consumption.
`prepareIpexExn` is the byte convenience operation: parse once, construct the
body, collect nested wire under the existing 8 MiB ceiling, then join disposal of
all parsed owners. Parent signatures and child evidence must share the outer
attachment enclosure. Cancellation aborts reads and joins cleanup; no lazy owner
escapes this operation.

Exchanger verifies before durable acceptance, retains missing issuer/KEL/TEL
proofs in its existing escrow, retries from persisted children, and notifies only
after acceptance. Replay preserves child proof enclosures. An accepted grant
is conversation evidence; nested nodes are not independent credential or wallet
acceptances. Schema resolution uses already cached schemas, without fetching.

`RegistryEvidenceStore.importEvidence` verifies the merged observer chain before
an atomic write to frozen RegBaser-compatible `evts.`, `tels.`, and `heds.` tables.
Importing an older prefix cannot downgrade the head. Missing or invalid evidence
makes no partial write. Reads require a complete accepted chain; corrupt rows and
I/O failures propagate. AgentRuntime owns its default store and joins close;
injected stores remain caller-owned. There is no automatic `rip/bup` parser intake
or issuer registry engine. The 16,384-event ceiling bounds one read/import, not
runtime memory; native whole-row allocation and shared admission remain phases 4–5.

Presentation-registry grants remain guarded until consolidated v2 intake supplies
receiver-owned KRAM timestamps. Sender time is never a substitute. The independent
wire oracle covers JSON outer exchanges with native ACDC nodes, verifies actual
unmodified-upstream imports, and exercises real Exchanger decisions. Native-CESR
outer EXNs with empty prior do not round-trip in the frozen low-level factory
probe; they are unqualified here. Full format/production qualification remains
in the progressive plan, separately from the mailbox-fork evidence.

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
