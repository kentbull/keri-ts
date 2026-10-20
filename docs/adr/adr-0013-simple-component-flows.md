# ADR-0013: Simple component flows and explicit ownership

- Status: Accepted; 1.0.0 composed qualification complete; later refinements require separate validation
- Date: 2026-10-14
- Scope: Component interaction, decisions, scheduling and actual resource lifetime
- Related: [composition](adr-0003-agent-runtime-composition-root.md),
  [cues](adr-0004-cue-runtime-portability.md),
  [KEL decisions](adr-0005-kel-decision-control-flow.md)

## Governing model

Use recognizable KERIpy composition: concrete components, ordinary records, cues,
Decks, receive buffers and explicit local operations. KERIpy also shares domain
objects and calls subordinates directly; this is not a pure actor architecture.
Choose the design that cuts future cost in this codebase. Refactor responsibility
and contracts first, then change behavior.

This ADR supersedes older instructions to preserve accounting, delivery preparation,
general Reactor gates, runtime-shaped service bundles or duplicate command drivers.
[ADR-0012](adr-0012-progressive-nested-parser.md) requires buffered complete-enclosure
decoding. The retired mechanisms are not compatibility requirements.

## Concrete ownership and communication

Identify each worker's state, input/output records and existing durable recovery
authority before changing a flow. Keep change-together work together. Do not make
a component or queue for every function or protocol kind.

Independently progressing siblings receive their actual dependencies, not an
AgentRuntime, a smaller runtime-shaped context or a bundle used to discover peers.
They exchange concrete records through flows wired at composition. Records do not
hide component references or deferred domain callbacks. Direct calls to subordinate
parsers, stores, signers and cohesive helpers are appropriate.

Composition creates the concrete graph and owns its lifetimes. It does not justify
a DI registry, repository-interface hierarchy, universal executor or event bus.
Application entrypoints may orchestrate through the root; lower transports do not
know the root or how its components are assembled. Unsupported forwarding facades,
hollow modes and unused hooks are removed rather than renamed.

HTTP composition supplies the scoped request client. Its concrete owner constructs
Request before network execution and retains the native response reader through
joined cleanup. Prepared request bodies contain no asynchronous producers. Finite
request returns metadata and complete bytes after cleanup; scoped open lends a
stream for actual incremental/status-only consumers. Protocol/application consumers receive metadata and owned bytes;
client object identity never chooses failure semantics.

A shared Deck is not broadcast. Define its consumer and routing; fan out only when
actual consumers require it. Preserve demonstrated ordering without global ordering.

## Decisions, contracts and commits

State machines decide with plain domain data. Processing owners apply decisions,
persist in their own transactions and publish live state/cues after commit. A
helper returning inside a caller's transaction does not prove commit completion.
Independent Baser/Reger environments are not one atomic transaction.

Keep state-sensitive evaluation/application in a synchronous owner transaction.
Prepare asynchronous evidence first, then revalidate current state at commit.
ProtocolProcessor dispatches to those owners without a global lock; independent
inputs and escrow scans may progress during EXN durability or handler cleanup. It
captures committed replies before application publication and returns decision data.
Output owners sign, route and consume request slots directly.

Tevery owns registry/credential TSN admission, route registration and dependency
retries. Independent record validators decode notice fields; composition supplies
the shared Revery. ProtocolProcessor calls Tevery operations without knowing its handlers.
This ownership refinement landed in #523 after the 1.0.0 publications.

Mailbox provider storage and recipient processing are separate responsibilities.
MailboxPoller retrieves endpoint streams; it never scans the provider's rows back
into its own recipient handlers. Direct HTTP/TCP or explicit in-process intake
serves immediate processing. Provider publication, authorized SSE retrieval and
remote persisted cursors remain; no optional local-consumer component is added.

Use named fields and discriminated alternatives; require variant-specific data.
Do not replace a bag with an interface of unrelated optional fields or duplicate
knowledge already represented by an instruction. Domain behavior must never read
policy from diagnostic keys. Exceptions retain invariant, infrastructure and
caller-contract failures; normal remote outcomes use typed decisions.

Open metadata bags, index signatures, maps of unknown values and casts need a
specific local justification. Explain why an explicit type, closed union, concrete
dictionary value or existing schema/protocol model cannot represent the boundary.
Validate unknown input before domain use. Schema-defined attributes, generic
serialization and third-party formats may justify open values; preserve actual
non-JSON codec semantics. Renaming a bag JsonObject or building a new schema
framework does not establish an explicit contract.

Executable decision protocols such as write/publish/release or callback-bearing
proof admission do not replace ordinary sequencing. Immediate transaction callbacks
and genuine scoped-resource callbacks remain legitimate.

## Flow and completion

Owners interpret/prepare/sign synchronously against committed state, publish
concrete output, then remove source records. Network delivery and its outcome
belong to actual transport/workflow owners. Incoming bytes use the separately
composed protocol intake. Reuse existing pull streams; do not add buffering merely
to make every flow look uniform.

Requests ask for work; cues convey facts or follow-up work; outcomes say what
completed. Queued, locally transmitted, stream-processed, protocol-accepted and
remotely acknowledged are different claims. Add correlation only for actual
concurrency. Preserve existing completion semantics without a general RPC layer.
Actual source/payload handles can cross a flow when their lifetime requires it;
ordinary records do not need a synthetic resource protocol.

The [runtime contract](../design-docs/runtime/INGRESS_AND_EGRESS.md) defines Poster as
the single queued execution owner. Respondant and other producers construct and
publish source messages; the host runs Poster.deliverDo independently of query
delivery. Ingress publishes without driving the postman. Optional outcomes refer
to a concrete queue admission, not an old success for the same SAID; cancelling
their observation does not withdraw published work. EXN construction belongs to
the producer, with standalone callers starting and joining an explicit worker.

Respondant constructs every local replay message and every correlated reply before
atomic publication. Poster owns ordinary FIFO events and sequential target loops.
Recognized failures produce outcomes with partial successful deliveries and allow
later selected targets/events to run. Actual waiters keep concrete-event matching.
Poster reports unobserved or abandoned failed outcomes at its delivery boundary,
with source/destination/topic, partial delivery and the original error. It keeps
no recovery history or retry/discard API. Reporting adds no logger dependency,
framework, callback or replacement queue. Unexpected faults publish/report then
propagate. Optional completion cues do not determine pending work. There is no
cursor, automatic retry, exact final-packet cache or cross-batch fairness mechanism.
Deferred capabilities require the evidence in the
[reliability roadmap](../plans/runtime/cue-reliability-roadmap.md).
Transport boundaries distinguish local transmission from processed duplex receive
and remote acceptance. Ordinary HTTP sends require body EOF; TCP transmit-only
sends join local drain/cleanup without waiting for arbitrary peer EOF. Concrete
network failures retain causes; source/parser/storage/cleanup failures propagate.
These checks do not replace broader release qualification.

CLI and long-lived hosts start the same workers. Finite commands use accepted-state
predicates and elapsed deadlines, then join workers before returning or closing
stores. Phase-specific tests invoke the operation under test. No serial whole-runtime
pump, turn-count completion formula or second scheduler replaces this model.

## Resource and durability boundary

No application memory budgeting belongs in parsers, codecs, domain, queues,
storage/replay, runtime or CLI. Shared policies, estimates, credits, accounting
reservations, inspection charges and synthetic retain/transfer/release machinery
are removed. No no-op policy, Infinity setting or dormant option preserves them.
A request SAID reservation is correlation, not such accounting.

Only a minimal private socket constraint could be justified by an observed
production problem and evidence that native backpressure is insufficient. It
must not spread configuration, callbacks or outcomes upward. Hypothetical overload
and tests mirroring invented formulas are not evidence.

Tholder's existing configurable `maxWeights` and `maxSithLength` are an accepted
narrow deployment exception. Retain the 1,000-weight and 65,536-character defaults
and positive-safe-integer validation; configure them before concurrent processing.
They bound threshold input complexity, not numeric threshold values or protocol
wire maxima. This does not authorize a shared policy service or new accounting.

Preserve wire framing/declared extents, crypto checks, supported numeric ranges,
transactions, native backpressure and real reader/socket/file/iterator/DB cleanup.
Effection scopes start, cancel and join work. External input abort stops waiting
dispatch and active consumers as well as reads; finite parser/transforms take no
lifetime options. Cleanup preserves genuine failures, including failures during halt.

Keep KERIpy protocol escrows, replay/timeliness caches, accepted evidence, mailbox
provider messages/cursors and protocol receipts. Outbox storage/workers/flags,
durable consumer acknowledgements/deadletters and KRAM ready/snapshot handoff
acknowledgements are removed. KRAM acceptance is not downstream business acceptance.
Do not modify KERIpy to justify TypeScript-only delivery guarantees.

No previous keri-ts API/data compatibility, migration/export/recovery readers,
disabled duplicate implementation or new-to-old tests are required. Removing code
does not authorize changes to unrelated live databases.

## Grounding and acceptance

Recorded protocol reference: KERIpy `7143832813cac6a394ab1faf9be83bb3372be87c`.
Directing composes parser/connection/processors; Hab owns cue interpretation;
Respondant composes reply output; query doers and Decks carry correspondence.
The separately declared mailbox fork adds its own mailbox host. Verify current
imports/pins using [reference environments](../plans/qualification/REFERENCE_ENVIRONMENTS.md).

The [runtime contract](../design-docs/runtime/INGRESS_AND_EGRESS.md) owns concrete
operational invariants. The [roadmap](../plans/PARITY_ROADMAP.md) owns remaining
work and future release gates; the [release report](../reports/parity/CLEANUP_RELEASE_2026-10-16.md)
records completed qualification at its exact baseline. Future acceptance requires real event/receipt,
TCP, HTTP/SSE, OOBI, retry, failure and restart evidence plus installed packages;
a renamed class or green narrow test is not architectural or release completion.

Keep one implementation PR active. Cohesive 1,000–3,000-line removals are permitted
when they avoid temporary interfaces or repeated migrations; smaller cuts remain
appropriate. Count tests/docs and give a reading order. Retire formula-only tests,
retain independent protocol/cleanup regressions and preserve participant topology.
