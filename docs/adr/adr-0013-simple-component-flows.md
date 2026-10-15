# ADR-0013: Simple Component Flows and Explicit Ownership

- Status: Accepted policy; implementation migration is incomplete
- Date: 2026-10-14
- Scope: Component interaction, scheduling, decisions, resource lifetime, and
  runtime complexity across CESR, KERI, and Tufa
- Related: [ADR-0003](adr-0003-agent-runtime-composition-root.md),
  [ADR-0004](adr-0004-cue-runtime-portability.md),
  [ADR-0005](adr-0005-kel-decision-control-flow.md)

## Context and precedence

The cleanup exposed child workers receiving `AgentRuntime` to discover siblings,
Reactor being borrowed as a general callback scheduler, executable decision
wrappers, and admission/ownership machinery spreading into domain contracts.
Moving these dependencies into smaller containers does not repair ownership.

The preferred model is recognizable KERIpy composition: specific workers,
ordinary data records, cues, Decks, receive buffers, and explicit local operations.
This is not a pure actor architecture. Every abstraction and constraint must earn
its maintenance cost in this codebase, rather than follow an abstract best practice.

This ADR refines ADR-0003/0004 and supplements ADR-0005. It supersedes blanket
requirements in older plans and runtime guidance to retain bounded queues,
aggregate accounting, reservation layers, or exact service-container identity.
It does not declare those mechanisms removed or change protocol requirements.
Conflicting migration plans must be reconciled before implementing affected work.
Parser format rules, transaction correctness, and real resource cleanup remain
requirements. The 2026-10-15 removal decision supersedes all earlier local-budget
exceptions and blanket outbox/durable-recovery preservation instructions. Existing
implementation is transitional and must be removed before release.

## Decision

### 1. Establish ownership before adding communication machinery

Identify the mutable state, input records, output records, and existing durable
recovery authority of each affected worker. Keep change-together responsibilities
together. Do not create a component or queue for every function or protocol kind.

Independently progressing sibling workers must not receive `AgentRuntime`, a
runtime-shaped context, or sibling bundles. They exchange concrete records through
Decks, channels, or existing streams wired by application composition. Messages
must not hide component references or executable domain work.

Composition constructs components, supplies their actual dependencies, connects
flows, and owns their lifetimes. Direct calls to subordinate parsers, signers,
stores, and cohesive helpers are appropriate. Constructor injection does not
justify an oversized dependency, and no new repository-interface framework is
required around concrete stores. Application entrypoints may use the runtime to
orchestrate a workflow; they must not pass it down into worker internals.

### 2. Give state changes explicit processing and transaction owners

Protocol decisions carry plain domain data. Kevery and corresponding processing
owners explicitly apply decisions and persist inside the owning transaction.
Plain data must also be a precise semantic contract. Use named fields and
discriminated alternatives for the outcomes we control; require each field where
its variant requires it. Do not replace an arbitrary bag with a large interface
of unrelated optional properties. Remove unused fields and avoid duplicating
knowledge already represented by an instruction or another authoritative field.

Open-ended metadata bags are prohibited unless the particular problem cannot be
solved another explicit, reasonable way. This applies to `Record<string, unknown>`,
`Record<string, any>`, broad index signatures, maps of unknown values, aliases,
casts, and generic extension/context slots used to evade a concrete contract.
Domain control flow must never depend on keys hidden in diagnostic metadata.

For a necessary open boundary, document locally why explicit fields, a closed
union, a concrete dictionary value type, or an existing protocol/schema type
cannot reasonably represent it. Confine unknown input to decoding/validation;
narrow before domain use. Truly schema-defined credential attributes, generic
serialization, or third-party extension formats may justify open keys, but not
an unexamined escape hatch throughout their consumers. Use an existing suitable
value model where possible; do not rename the bag `JsonObject` and declare it
fixed or invent a schema/type framework merely to avoid the spelling. Preserve
actual wire/schema semantics, including supported non-JSON codec values.

Publish live state and cues only after that transaction commits. A helper returning
inside a caller-owned transaction does not establish commit completion.

Keep state-sensitive evaluation/application within the required uninterrupted
turn. Do not suspend for network I/O while holding a database transaction or a
shared-state turn. Before removing a guard, identify the state it protects and
preserve necessary ordering at its owner. Do not centralize all application state
into a universal actor or pretend independent database environments are atomic.

Remove executable decision protocols such as `write/publish/release` and
`applyProofs/publishQueries/release` when they merely obscure ordinary sequencing.
Named owner operations and plain metadata are sufficient. Immediate transaction
callbacks and genuine scoped-resource callbacks remain appropriate.

### 3. Separate preparation, transmission, and outcome application

Where these are independent responsibilities, the flow is:

```text
request/cue -> owner prepares/signs -> delivery data -> transport -> outcome
                                                                    |
                                                        workflow/persistence owner
```

Delivery work contains the target, wire/source data, and necessary provenance.
It does not defer domain preparation through a runtime, habitat, or callback
embedded in the record. Incoming transport bytes enter the separately composed
intake/protocol flow. Transport does not discover or invoke sibling processors.

Reuse existing pull streams and frame channels; do not introduce a buffer solely
to make the diagram look uniform. Actual payload/source handles may cross a flow
when their concrete lifetime requires it; they are not deferred domain commands.

### 4. Distinguish requests, facts, and completion

Requests ask for work; cues convey domain facts or follow-up work; outcomes state
what an operation accomplished. Use concrete types and add correlation only where
actual concurrent work requires it. Queued, locally transmitted, receive-stream
processed, protocol accepted, and remotely acknowledged are different claims.

A queued frame must remain valid through consumption. Preserve the processing
completion semantics of existing callers when replacing direct calls with flows.
Do not build a general request/reply RPC layer to avoid a simple local operation.

### 5. Remove application budgeting; use native socket backpressure

Application-managed resource accounting is prohibited. Remove shared policies,
byte estimates, reservations, credits, inspection charges, preparation floors and
synthetic ownership of ordinary records. Parsers, codecs, domain processing,
Decks, persistence, replay, orchestration and CLI contracts must not know about
memory budgets. Do not rename the machinery, retain no-op policies, use Infinity,
or keep dormant options for later.

The only possible exception is a small private TCP/HTTP/socket constraint for an
observed production problem. Production performance evidence must show why native
stream/socket backpressure is insufficient. The exception permits a necessary
local solution; it does not require retaining a subsystem. No accounting type,
configuration, callback or outcome may leak into other components. Hypothetical
overload and tests reproducing invented formulas are not evidence.

Preserve wire framing and declared lengths, cryptographic validation, supported
numeric representation, transactions, actual file/socket/iterator disposal, and
KERIpy-supported protocol state. These are correctness requirements, not resource
policy. Ordinary cues are records in Decks, without retain/transfer/release
protocols for garbage-collected data.

Refactor mixed functions so real work and cleanup belong to their existing owner
before removing accounting behavior. Do not invent staging abstractions. Remove
formula-only tests while retaining independent protocol and cleanup regressions.
Do not claim a process-memory bound from logical estimates or their removal.

### 6. Define queue consumers and route cues explicitly

A shared Deck is not broadcast. Give each queue a defined consumer; use a small
domain-specific routing loop or existing distinct queues when work has multiple
destinations. Define fanout only where multiple consumers actually need it.
Preserve existing ordering requirements without imposing global ordering.

Do not add a general event bus, broker, schema registry, per-type estimator
registry, or arbitrary callback job queue.

### 7. Keep scheduling separate from protocol semantics

Effection and application lifecycle code start, cancel, and join workers. Reactor
and protocol processors do protocol work. Sibling workers must not borrow
`Reactor.settle(undefined, ..., callback)` to sign, prepare deliveries, clean up
cursors, or run unrelated state changes. Do not rename this to a universal
`runExclusive` or scheduler callback API and call the migration complete.

Use short owner turns and explicit flows. Retain a local synchronization mechanism
only for demonstrated shared-state ordering that cannot be eliminated simply.
`finally` releases real acquired resources. No-op lifecycle methods and synthetic
owners added only to satisfy a uniform interface should disappear. Legitimate
library teardown contracts, cancellation, disposal, and joined cleanup remain.

### 8. Retain KERIpy protocol state; remove unsupported delivery guarantees

Remove the outbox completely, including disabled implementations, storage,
workers, runtime/CLI integration, flags, exports and dedicated tests. Also remove
durable mailbox consumer acknowledgements/deadletters and KRAM ready/snapshot
handoff acknowledgements. Do not alter KERIpy to justify TypeScript-only delivery
guarantees or preserve them merely because they have tests.

Keep KERIpy-supported escrows, replay/timeliness caches, mailbox provider messages
and polling cursors, accepted evidence and protocol receipts. KRAM acceptance is
not downstream business acknowledgement. Local transport completion is not remote
application acceptance. Use the pinned reference to distinguish them.

Stop creating/opening retired stores and delete their code outright. Compatibility
with previous keri-ts versions and their data is not a requirement. Do not build
migration/export/recovery paths, compatibility readers, disabled implementations
or new-to-old version tests. Current KERIpy protocol interoperability remains the
target. The deferred outbox roadmap is an unimplemented idea, never retention
authority. Removing code does not require touching unrelated live databases.

## KERIpy grounding and deliberate differences

Reference: KERIpy commit `7143832813cac6a394ab1faf9be83bb3372be87c`.

- `src/keri/app/directing.py`: Reactor/Reactant compose parser, connection,
  protocol processors, message/cue/escrow doers; they are not general callback locks.
- `src/keri/app/indirecting.py`: setupWitness wires receive buffers and reply,
  response, and query Decks; WitnessStart routes cue records between those flows.
- `src/keri/app/agenting.py`: WitnessReceiptor consumes messages and emits cues;
  messenger workers have message/sent queues and subordinate parser lifecycles.
- `src/keri/app/storing.py`: Respondant consumes reply/cue Decks and composes Poster.
- HIO `src/hio/base/doing.py` and `src/hio/help/decking.py`: cooperative scheduling
  and ordinary deque-based flow, often without configured bounds.

KERIpy also shares domain/database objects and uses direct calls. This ADR adopts
its recognizable flow model while applying a stricter sibling-message boundary;
it does not claim KERIpy is a pure actor system or has universal bounded admission.

## Adoption and acceptance

Refactor to the principle first, then change behavior in a cohesive follow-up.
Use cohesive reviewable cuts. During deletion/refactoring, 1,000–3,000 changed
lines per PR are permitted when they complete a mechanism removal and avoid
temporary interfaces or repeated caller edits. Smaller cuts remain appropriate
at real ownership boundaries. Count tests and docs, and give reviewers a reading
order for cross-file changes. These are allowances, not quotas.

Reconcile existing cleanup rounds with this policy. In each affected real flow,
identify ownership, record contracts, completion, cancellation, and recovery;
record limit decisions without creating another maintained inventory framework.
Remove replaced paths rather than adding runtime-shaped adapters or compatibility
layers without a real requirement. No name, file move, or wrapper-to-class
conversion alone demonstrates architectural completion.

Validate representative event/receipt, TCP reply, HTTP/SSE, OOBI, and retry flows,
including relevant failure and restart cases. Preserve protocol/interoperability
regressions; retire implementation-mirroring tests when their machinery is deleted.
Final integration, interop, installed-package, and release qualification remains
required. Acceptance of this ADR is not a claim that the migration is complete.
