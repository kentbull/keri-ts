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
requirements; optional runtime accounting is not automatically one of them.

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

### 5. Start with simple flow control; bounds must earn their keep

Unbounded Decks are allowed. Pure actor semantics, universal backpressure, byte
ledgers, and reservation handles are not default architecture requirements.
Prefer the simplest queue/stream that supports the real workflow.

Production evidence of backlog or resource pressure is the preferred reason to
strengthen internal flow control. A concrete protocol rule, reproduced excessive
allocation defect, deployment requirement, or actual resource lifetime can also
justify a local constraint. A hypothetical future overload or a test mirroring
an invented accounting formula does not establish that need.

For each existing bound/accounting layer touched, briefly state its evidence,
benefit, and complexity in the active plan or PR. Remove or simplify machinery
without a sufficient benefit. A small local bound may remain when its benefit is
concrete and its additional complexity is negligible; it must not force a general
ownership framework onto domain code. Do not keep complex machinery merely
because it already exists, and do not add dormant limit hooks for later use.

Distinguish queue policy from malformed-input validation, wire-format constraints,
actual buffer lifetime, file/socket cleanup, and established durable retry rules.
Retain the latter for their own reasons. Changing an optional limit is a deliberate
behavior change after the structural refactor, not an accidental refactor effect.
Update tests and documented guarantees accordingly; do not claim a shared memory
bound after removing the mechanism that established it.

Where bounds remain, refusal preserves retryable work and ownership is explicit.
Never wait for downstream capacity while holding a transaction or state turn that
downstream needs. Do not implement silent eviction of protocol work or a generic
deadlock-management framework.

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

### 8. Preserve durable recovery where the workflow needs it

Decks carry live work; existing outboxes and escrows remain authoritative for
recoverable work. Specify consumption/failure/restart behavior at affected
boundaries. Do not replace durable work with transient queues or make every queue
durable. Keep exact-wire retry when the protocol/workflow requires it.

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
Use narrow reviewable cuts, ordinarily 300–500 additions and independently
300–500 deletions or fewer. These are guidelines, not quotas.

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
