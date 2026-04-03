# ADR-0004: Portable Cue Runtime Semantics Over A Shared Root Cue Deck

- Status: Accepted
- Date: 2026-03-29
- Scope: `packages/keri` Gate E cue handling, runtime orchestration, and local
  location-state mutation
- Related:
  - `packages/keri/src/core/cues.ts`
  - `packages/keri/src/app/cue-runtime.ts`
  - `packages/keri/src/app/habbing.ts`
  - `packages/keri/src/app/agent-runtime.ts`
  - `packages/keri/src/app/cli/loc.ts`
  - `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`

## Context

Gate E needs more than a shared `Deck<AgentCue>`. It needs cue handling to be a
portable runtime behavior set that works in both host shapes:

- command-local CLI flows such as `ends add`, `loc add`, and `oobi resolve`
- long-lived runtime hosting via `tufa agent`

KERIpy already has the right mental model:

- producers such as `Kevery`, `Revery`, and `Oobiery` push typed cue payloads
- `BaseHab.processCuesIter()` interprets those cues into message bytes or local
  notifications
- host doers such as `cueDo()` drain the shared deck continuously and deliver
  the results

The old `keri-ts` bootstrap slice copied only the shallowest part of that
pattern:

- there was a shared root cue deck
- `Hab.processCuesIter()` existed
- but it only handled `replay` and `reply`, yielded raw bytes only, and was not
  part of the actual runtime orchestration

That was enough for the first OOBI/bootstrap slice, but it taught the wrong
architecture to maintainers and left no honest place to port broader KERIpy cue
behavior.

## Decision

`keri-ts` keeps the shared root cue deck, but formalizes cue handling as a
three-layer runtime contract:

1. Cue production
   - `Kevery`, `Revery`, `Oobiery`, and later `Tevery` / `Exchanger` produce
     typed `AgentCue` values.
   - Producers do not send raw bytes directly.

2. Cue interpretation
   - `Hab.processCuesIter()` remains the semantic interpretation seam.
   - This is the closest `keri-ts` correlate to KERIpy
     `BaseHab.processCuesIter()`.
   - Cue meaning becomes structured `CueEmission` values here.

3. Host delivery
   - runtime helpers `processCuesOnce()` and `cueDo()` drain the shared deck
   - host sinks receive `CueEmission` values and decide what to do with:
     - wire messages
     - notify-only runtime cues
     - transport/session cues such as `stream`

`keri-ts` deliberately differs from KERIpy in one important representation
choice:

- KERIpy collapses many cues straight into raw byte arrays.
- `keri-ts` preserves the originating cue in a `CueEmission` so hosts and tests
  can observe cue semantics directly instead of re-deriving intent from bytes.

## Why Keep The Root Cue Deck

The shared root `Deck<AgentCue>` is still the correct abstraction because cues
are genuinely cross-component runtime state:

- `Revery` can emit a `query` cue because reply verification is blocked
- `Kevery` can emit `keyStateSaved`, `notice`, or later `receipt` / `witness`
- `Oobiery` can emit `oobiQueued`, `oobiResolved`, or `oobiFailed`

This is different from topic-local workflow state like OOBI job queues, which
belong behind `Oobiery` and in durable DB families such as `oobis.`.

## Why Habitat-Owned Interpretation

We explicitly keep cue interpretation habitat-owned because that matches the
KERIpy mental model and keeps signature/message construction near the local
controller state that authorizes it.

That means:

- the runtime owns draining and delivery
- the habitat owns turning cue semantics into KERI wire messages when possible

This is also why `loc add` belongs in the same architecture. A local
location-scheme update is not a direct DB mutation; it is a signed
`/loc/scheme` reply fed back through:

- parser
- `Revery`
- route acceptance
- reply stores (`lans.` / `locs.`)

## Cue Taxonomy

| Cue kind            | Primary producer(s) in KERIpy                           | Primary consumer(s) in KERIpy        | Wire bytes?                            | Host-observable only? | Current `keri-ts` handling                                                    |
| ------------------- | ------------------------------------------------------- | ------------------------------------ | -------------------------------------- | --------------------- | ----------------------------------------------------------------------------- |
| `receipt`           | `core/eventing.py`                                      | `BaseHab.processCuesIter()`          | Yes                                    | No                    | typed and preserved; currently surfaced as notify until receipt builders land |
| `notice`            | `core/eventing.py`                                      | `BaseHab.processCuesIter()`          | No                                     | Yes                   | notify emission                                                               |
| `witness`           | `core/eventing.py`                                      | `BaseHab.processCuesIter()`          | Yes                                    | No                    | typed and preserved; currently surfaced as notify until witness builders land |
| `query`             | `core/routing.py`, `core/eventing.py`, other subsystems | `BaseHab.processCuesIter()`          | Yes                                    | No                    | complete query cues emit wire bytes; incomplete query cues stay notify        |
| `replay`            | `core/eventing.py`                                      | `BaseHab.processCuesIter()`          | Yes                                    | No                    | wire emission with preserved cue                                              |
| `reply`             | `core/eventing.py`, later reply/status flows            | `BaseHab.processCuesIter()`          | Yes                                    | No                    | wire emission from route/data or prebuilt serder                              |
| `stream`            | `core/eventing.py`                                      | indirect/mailbox host layers         | Sometimes, but host/transport-specific | Yes                   | transport emission, not flattened into ordinary wire bytes                    |
| `noticeBadCloneFN`  | `core/eventing.py`                                      | `BaseHab.processCuesIter()`          | No                                     | Yes                   | notify emission                                                               |
| `keyStateSaved`     | `core/eventing.py`                                      | `querying.py`, local noticers        | No                                     | Yes                   | notify emission                                                               |
| `invalid`           | `core/eventing.py`                                      | `BaseHab.processCuesIter()`          | No                                     | Yes                   | notify emission                                                               |
| `psUnescrow`        | `core/eventing.py`                                      | higher-level recovery/notifier logic | No by default                          | Yes                   | notify emission                                                               |
| `remoteMemberedSig` | `core/eventing.py`                                      | diagnostic/security observers        | No                                     | Yes                   | typed reserved parity cue; notify emission                                    |
| `oobiQueued`        | `oobiing.py` analogue                                   | host/runtime waiters                 | No                                     | Yes                   | notify emission                                                               |
| `oobiResolved`      | `oobiing.py` analogue                                   | host/runtime waiters                 | No                                     | Yes                   | notify emission                                                               |
| `oobiFailed`        | `oobiing.py` analogue                                   | host/runtime waiters                 | No                                     | Yes                   | notify emission                                                               |

## Runtime Ordering

Command-local stepped flows now use:

1. `reactor.processOnce()`
2. `oobiery.processOnce()`
3. `processCuesOnce()`
4. `reactor.processEscrowsOnce()`
5. `processCuesOnce()`

Long-lived hosts now run:

- `reactor.msgDo()`
- `cueDo()`
- `reactor.escrowDo()`
- `oobiery.oobiDo()`

This mirrors the KERIpy idea that cue handling is a first-class doer, not an
incidental helper inside a command.

## `keri-ts` Idiomatic Deviations

These are intentional, not accidental:

1. HIO doers become Effection operations.
   - KERIpy `cueDo()` -> Effection `cueDo()`
   - KERIpy `msgDo()` -> Effection `msgDo()`
   - KERIpy `escrowDo()` -> Effection `escrowDo()`

2. Cue delivery is explicit.
   - Hosts implement a `CueSink`.
   - We do not hide transport/session side effects inside anonymous callbacks or
     root-owned transport queues.

3. Cue results are structured.
   - `CueEmission { cue, msgs, kind }` preserves semantics and supports better
     tests and host logic.

4. Habitat resolution is explicit.
   - A cue may require a specific local habitat to sign or materialize bytes.
   - When no explicit habitat is supplied and the habery owns exactly one local
     habitat, `keri-ts` uses that habitat.
   - When multiple local habitats exist and the runtime cannot resolve the
     correct one honestly, cues are surfaced as notify/transport emissions
     rather than silently guessing.

## Consequences

- Future cue-producing work should add typed `AgentCue` variants before adding
  host-specific plumbing.
- Future cue-consuming work should prefer `CueEmission` + `CueSink` over raw
  byte iterators or new root-owned transport queues.
- `loc add` and similar local admin commands must continue to mutate local state
  through parser/routing acceptance, not through direct DB writes.
- Receipt/witness cue parity is still incomplete in current `keri-ts`; the
  runtime now preserves those cues honestly and visibly instead of dropping
  them, but full wire-message materialization still belongs to the broader KEL
  port.
