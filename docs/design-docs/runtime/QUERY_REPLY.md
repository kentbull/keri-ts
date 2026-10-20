# Query/Reply Correspondence And Watcher Support

Date: 2026-04-05

## Purpose

Describe the current query/reply correspondence contract and its KERIpy model.

This document describes query/reply ownership. It focuses
on:

- runtime correspondence for incomplete `query` cues
- `KeyStateNoticer` / `LogQuerier` / `SeqNoQuerier` / `AnchorQuerier`
- `/ksn/{aid}` reply handling
- `/watcher/{aid}/{action}` reply handling
- ownership boundaries across `WitnessInquisitor`, `Kevery`, `Revery`,
  `Hab.processCuesIter()`, and `AgentRuntime`

It does not try to re-explain the whole cue system. For the broader cue
architecture, including runtime cue decks, `stream` transport cues, mailbox
query routing, and KERIpy-to-`keri-ts` host correspondence, read
`docs/design-docs/runtime/CUES.md`.

## Ownership Model

KERIpy supplies the correspondence model; TypeScript ownership and endpoint-selection
differences are explicit below. The pinned references are KERIpy `71438328` and
GLEIF-IT `b8626e1d`, recorded in the [runtime contract](INGRESS_AND_EGRESS.md).

- `Revery` owns:
  - reply-envelope verification
  - BADA acceptance
  - reply escrow and replay
  - missing-signer `query` cue emission
- `Kevery` owns:
  - KEL query routes such as `logs`, `ksn`, and `mbx`
  - KEL-owned reply families such as `/ksn/{aid}` and `/watcher/{aid}/{action}`
  - `keyStateSaved` cues and query-not-found escrow
- `WitnessInquisitor` owns:
  - the runtime correspondence step between incomplete `query` cues and honest
    outbound `qry` messages
  - local habitat and remote-attester resolution for runtime-generated queries
- Concrete query workflows own:
  - their initial request, accepted-state/cue observation and scoped completion
  - KSN-to-logs follow-on work; the sender has no workflow registry
- `Hab.processCuesIter()` owns:
  - cue-to-wire interpretation for already-complete cues
  - message materialization once a cue already has the source and destination
    information it needs
- `QueryReplies` owns:
  - request-SAID correlation slots and ordered captured evidence
  - independent slots for duplicate requests; correlation does not authorize access
- `ProtocolProcessor` owns:
  - semantic dispatch and escrow advancement over synchronous domain commits
  - reply capture before application cue publication
- `Reactor` and receiving messengers own:
  - input-specific parsers and Kevery instances over shared accepted state
  - source cancellation and cleanup; they borrow the shared ProtocolProcessor
- `AgentRuntime` owns:
  - composition, hosting and convergence
  - not query policy itself

The most important boundary is this:

- incomplete `query` cues are correspondence requests
- complete `query` cues are wire-ready cue interpretations

## Why `WitnessInquisitor` Exists

KERIpy spreads this behavior across `querying.py`, `agenting.py`, and cue
producers such as `routing.py` and `eventing.py`.

That Python model works because:

- `WitnessInquisitor` can choose a witness/controller/agent target later
- doer loops can hold onto partially specified work
- cue consumers often sit close to transport code

In `keri-ts`, leaving incomplete `query` cues to `Hab.processCuesIter()` would
teach the wrong mental model. Habitat cue interpretation should not guess:

- which local habitat should sign
- which role endpoint should be queried
- whether a watcher override should be used

`WitnessInquisitor` exists to keep that policy above the cue-to-wire seam.

## KERIpy To `keri-ts` Correspondence

**`app/querying.py::KeyStateNoticer`**

- KERIpy role: start with `ksn`, then wait for `keyStateSaved`, then escalate to log query if remote is ahead
- `keri-ts` role: `KeyStateNoticer` scoped operation

**`app/querying.py::LogQuerier`**

- KERIpy role: query logs until local accepted state reaches target `sn`
- `keri-ts` role: `LogQuerier` scoped operation

**`app/querying.py::SeqNoQuerier`**

- KERIpy role: query logs until local state reaches a requested sequence number
- `keri-ts` role: `SeqNoQuerier` scoped operation

**`app/querying.py::AnchorQuerier`**

- KERIpy role: query logs until an event seal anchor appears locally
- `keri-ts` role: `AnchorQuerier` scoped operation

**`app/agenting.py::WitnessInquisitor.query(...)`**

- KERIpy role: choose endpoint target and send query later
- `keri-ts` role: `WitnessInquisitor` resolves signer/attester and prepares exact
  one attempt in `deliverOnce()`; `deliverDo()` runs background transmission

**`core/routing.py` missing-signer cue**

- KERIpy role: ask for signer establishment state when reply verification is blocked
- `keri-ts` role: `Revery` emits incomplete `query` cue, then `WitnessInquisitor` resolves and sends it

**`core/eventing.py::processReplyKeyStateNotice`**

- KERIpy role: KEL-owned `/ksn` reply processing
- `keri-ts` role: `Kevery.processReplyKeyStateNotice(...)`

**`core/eventing.py::processReplyAddWatched`**

- KERIpy role: watcher-owned observed-AID reply processing
- `keri-ts` role: `Kevery.processReplyAddWatched(...)`

## Reply payload contracts

Current KSN production prepares a reply serder. That serder carries the route;
a second cue-level route or data body is prohibited. Arbitrary already-formed
reply bodies can use this form without an untyped cue payload slot.

TSN production carries the existing required registry or credential state record
with its matching /tsn/registry or /tsn/credential route and requester destination.
It waits for the interpreting Hab to supply the local attester suffix and signing.
The fresh owned record stays typed through the cue; Hab serializes it only while
constructing the wire reply. Missing credentials retain the registry-only reply;
the producer's tuple type preserves registry-before-credential ordering.

Both forms have actual producers. They are disjoint; absent payloads, contradictory
route/data/serder combinations, mismatched TSN state and missing TSN destinations
are invalid contracts. A successful serialized response still does not replace
independent receiver proof/trust/TEL checks. Raw partial registry seals retain
their existing producer behavior and remain distinct from accepted TSN validation.

## Incomplete Versus Complete `query` Cues

`keri-ts` intentionally keeps two states under one `QueryCue` contract. Both use
one required `q` body, as KERIpy does; there is no `query` alias or precedence rule.
Routed work requires `pre` and a concrete `route`: logs accepts sequence/FEL/anchor
filters, ksn accepts sequence/FEL filters, and tels/tsn require registry and credential
identifiers. The target appears once in the envelope. QueryRequest shares this
routed record with QueryCue; signer is the local AID, while src is the remote
attester. Continuations and pending work carry identifiers, not Hab references.
The sender resolves an explicit selection through Habery at signing;
an unavailable selection remains unresolved and never falls back to another Hab.
A Hab interpreting a cue selected for another signer leaves it to correspondence.
The runtime router sends all query cues to WitnessInquisitor; its resolved requests
use Hab.query. Direct component callers can still interpret already-resolved cues
through Hab.processCuesIter.
Anchorer's query dependency is only a QueryRequest enqueue port; composition owns the consuming
coordinator and its lifetime. KERIpy 714 normally resolves its queued src through
Habery, but also permits a Hab override. This queue uses an identifier in both
cases; the explicit signer name distinguishes it from our existing remote-attester
src field. Delivery uses that same selected signer for its introduction and
endpoint lookup. Poll authorized mailbox providers and every current witness
mailbox: a reply lives at the witness that answered. The existing per-endpoint
workers provide concurrency; no new scheduler is needed. Hab.query accepts the same
instruction, or the existing mbx topic-cursor form. The raw query constructor remains
an open codec boundary for extension routes and malformed-input vectors.

Continuation-owned pending requests use the same field. Copy the top level at the
existing ownership boundaries before signing; preserve nested
immutable borrows and joined retry/cancellation lifetimes.

TEL recovery notifications carry concrete `q.ri` and `q.i` fields, with `q.issr`
when the registry itself is unknown. This does not add a transport consumer for
TEL/schema notifications. Schema and credential-recovery `query` notices retain
their concrete KERIpy-shaped q.r hints; they are separate from routed work.
Notices remain notify-only even if a hint happens to name a known KEL. They must
not fall through to a logs request. Producers use canonical s filters directly;
there is no sn/anchor alias normalization or redundant r/dig wire hint.

Incomplete cue:

- usually produced by `Revery` or `Kevery`
- carries a concrete route/body and target; `wits` may still be unresolved
- does not yet know the honest `src`
- does not yet know whether runtime can honestly choose a local habitat

Complete cue:

- includes both the queried prefix and a resolved attester source
- is ready for `Hab.processCuesIter()` to materialize into bytes

Maintainer rule:

- if a `query` cue still needs policy, it belongs to `WitnessInquisitor`
- if it only needs message construction, it belongs to `Hab.processCuesIter()`

## Query and cue source ownership

Composition routes the actual source queue directly to query, mailbox and reply
owners. CueSink, its optional preparation/admission hooks and root adapters are
deleted. Respondant and WitnessInquisitor do not receive the parent runtime or
discover its siblings.
WitnessInquisitor's delivery operation owns ordinary pending
send work. Concrete workflows borrow accepted state and a sender. The command
wires one queryCues Deck to its noticer and runAgentRuntime before I/O. The
application cue worker transfers saved notices there once, leaving the noticer
as its sole consumer. Each operation owns its wait and follow-on work without a
runtime registry or callbacks. Future Channels require an independently justified
production use, not a simultaneous-observer test.

Query preparation, signing and admission are synchronous operations over accepted
state published by its processing owner after commit. They do not suspend between
state lookup and signing. Network waits happen after preparation; failed delivery,
refusal and cancellation consume the attempt and join cleanup. Unresolved
instructions remain pending; there is no signed-packet retry backlog. ProtocolProcessor owns protocol dispatch and captures reserved replies before
publishing ordinary cues to the application Deck. A reservation also claims
already-published matching replies synchronously; exact dispatch authorization
still controls whether that request may use them. Request owners consume slots
for same-socket TCP replies. Ordinary HTTP queries return 204 and replies use
Respondant/Poster and independent receiving owners. Authorized mailbox requests
retain SSE; HTTP does not reserve ordinary query output.
CLI and hosts run the same component workers; final composed qualification remains
separate from these ownership contracts.

Respondant owns eager reply construction and atomic publication; Poster owns
queued FIFO execution and cleanup. Complete local replay sequences are materialized in the production
pass; no reply cursor survives delivery passes. Failed outcomes preserve original
causes and partial success for actual observers. Poster reports unobserved or
abandoned failures without retaining a recovery backlog; no retry/discard API or
automatic retry remains.
WitnessInquisitor owns sending independently of workflow completion. HTTP response
bodies are transport output, not incoming protocol evidence. The [runtime contract](INGRESS_AND_EGRESS.md) defines transport completion.
WitnessInquisitor prepares its signed packets directly without public custom-emission
or raw-packet injection. Internal address selection stays private.
After the signer-identifier refactor, pending queries use one private ordinary
Deck of plain QueryRequest records with read-only inspection. Metadata reservation
wrappers, configurable pending/continuation caps and partial-admission bookkeeping
are removed: no production caller used those controls and no demonstrated backlog
justified their complexity. Failed/cancelled sends retain the head, unresolved work
rotates, newly appended work waits for the next finite pass, and close joins active
consumption before clearing. Actual wire preparation, payload/source lifetime and
transport cleanup retain their own controls. Pending metadata is unbounded; there
is no shared memory-bound claim.

## Attester Resolution Contract

Queries follow KERIpy `71438328` WitnessInquisitor selection:

1. A nonempty explicit `wits` list selects one random supplied witness and resolves
   its location directly, even if the subject's KEL is not yet known.
2. Otherwise, a known subject uses the first present role: controller, agent, witness.
   Select one endpoint randomly within that role. Missing or unsupported locations
   fail visibly; do not promote a lower role or silently try another endpoint.
3. An explicit `src` retains its addressed attester; `signer` remains the local AID.

Mailbox providers are not query attesters. Mailbox-only routing cannot invent a
controller attester or use a provider URL for a controller query. Such unresolved
requests remain pending. Anchor recovery separately asks each eligible candidate;
this is not general load balancing or automatic transport retry.

Hab.endsFor preserves endpoint entries with empty locations, as the reference does.
It continues to filter stored roles by the existing `allowed || enabled` contract;
this deliberately avoids the reference's enumeration of unauthorized retained
rows. In particular, ordinary `/end/role/cut` rows (`allowed=false`, no enabled
approval) remain excluded. Current KEL witnesses are independent of end-role rows.

## Habitat Resolution Contract

`WitnessInquisitor` resolves the signing habitat in this order:

1. explicit local `signer` AID on the request, resolved from Habery
2. coordinator-configured `hab`
3. the sole local habitat, if exactly one exists

A missing explicit signer never falls back to another habitat. If multiple habitats
exist without a selection, `keri-ts` does not guess. The request remains pending
until a caller provides enough information.

That is an intentional honesty rule. Silent multi-hab guessing would make the
runtime appear to work while signing from the wrong local controller.

## `/ksn/{aid}` Is KEL-Owned

`/ksn` is not treated as a generic reply family.

Why:

- the body is key-state semantics, not generic endpoint auth
- trust-source policy depends on KEL state and configured watchers
- acceptance depends on consistency with accepted event state at the reported
  sequence number
- successful acceptance emits `keyStateSaved`, which drives further
  correspondence work

`Revery` still verifies the reply envelope and applies BADA, but `Kevery`
decides whether the reply is meaningful for KEL state.

Non-lax trust sources are:

- the controller itself
- one of the backers named in the reported KSN
- a locally configured watcher

## Watcher Reply Support

`/watcher/{aid}/{action}` is also KEL-owned.

Accepted actions:

- `add`
- `cut`

Accepted replies:

- verify through `Revery`
- normalize BADA comparison onto the base route `/watcher/{aid}`
- persist watcher reply SAIDs in `wwas.`
- persist observed watcher projection state in `obvs.`
- queue advertised `oobi` URLs into `oobis.` when present

Why this is not generic `Revery` ownership:

- the semantic meaning is watched-identifier state, not reply-envelope state
- persistence touches KEL-adjacent watcher stores with their own meaning
- route semantics live with the subsystem that owns those records

## Scoped workflow semantics

Concrete operations mirror KERIpy's query doers. Their invoking scopes own
progress and cleanup; the sender does not register, tick or count workflows.
The query command owns one cue Deck before sending. Its noticer pulls one head,
matches kind/subject and appends unrelated or currently unusable notices at the
tail, yielding cooperatively between turns. Witness drains preserve saved facts
for this application handoff. There is no broadcast or request freshness promise.
Sequence and anchor operations read accepted database state.

`KeyStateNoticer`

- starts by requesting `ksn`
- selects the first usable matching queued notice, retaining it while local
  prerequisite state is unavailable
- completes if local accepted state matches or exceeds that notice's sequence
- directly awaits `LogQuerier` if the notice reports a higher sequence; later
  notices stay queued rather than replacing a running catch-up task

`LogQuerier`

- emits `logs` from `fn=0`, `s=0`
- completes when local accepted sequence reaches the target sequence

`SeqNoQuerier`

- emits `logs` with explicit `fn` and target `s`
- completes when local accepted sequence reaches the requested threshold

`AnchorQuerier`

- emits `logs` with anchor search criteria
- asks each eligible attester once through the existing pending queue; a retired
  witness must not prevent another known witness from answering
- retains the ordinary deferred-resolution request when no endpoint is yet known
- completes when the local database contains a sealing event for that anchor
- accepts the existing CESR event-seal SAD contract (`i`, hexadecimal `s`, `d`),
  copies it at registration and emits the owned seal as the logs query’s `q.a`
- `tufa query --anchor` validates the JSON shape and CESR primitive values before
  opening a controller store; malformed files cannot become pending query work
- emits `i, s, d` key order required by KERIpy’s lookup; supplied field values
  are retained rather than canonicalized

KERIpy's WitnessInquisitor selects one random peer. Anchor queries deliberately
try the known alternatives because a witness cut can leave the old first peer
without the requested seal. This is finite query work, with no new retry timer or
scheduler. Witness HTTP replies can arrive through mailbox delivery; the querying
controller needs actual witness/mailbox routing and active polling. Transmission
alone does not establish local acceptance. `tufa query` uses the existing concurrent
runtime runner so an empty long poll at one mailbox cannot postpone query
transmission or polling another endpoint until the command deadline. It halts
and joins those workers before printing state and closing its stores.

## Runtime convergence

`queriesPending` in `runtimePendingState()` describes deferred requests and active transport. It does not represent an independent semantic wait.
A finite command awaits its concrete workflow under its own deadline and joins
that operation and the host workers before stores close. Tufa captures the final
accepted-state display while the store is open and prints it after closure. The
command fails its single elapsed deadline when evidence is missing; explicit OOBI
resolution is a separate command, without an implicit query fallback.

## Maintainer Checklist

When changing this area, confirm:

- does the branch belong to `Revery`, `Kevery`, or `WitnessInquisitor`?
- is the cue incomplete or complete?
- does the runtime have enough information to choose a habitat honestly?
- is endpoint selection deterministic and documented?
- if a watcher or `/ksn` route changes, are the durable stores and trust rules
  still explicit?
- does the invoking scope await accepted evidence and join its workflow before closing stores?

## Related Docs

- `docs/design-docs/runtime/CUES.md`
- `docs/adr/adr-0003-agent-runtime-composition-root.md`
- `docs/adr/adr-0004-cue-runtime-portability.md`
- `docs/adr/adr-0005-kel-decision-control-flow.md`
- `docs/adr/adr-0008-escrow-decision-architecture.md`
- [Transport acceptance plan](../../plans/runtime/TRANSPORT_PLAN.md)
