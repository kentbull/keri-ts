# Query/Reply Correspondence And Watcher Support

Date: 2026-04-05

## Purpose

Capture the maintainer contract for the Gate E query/reply correspondence slice
that was ported from KERIpy into `keri-ts`.

This document is intentionally narrower than the full Gate E plan. It focuses
on:

- runtime correspondence for incomplete `query` cues
- `KeyStateNoticer` / `LogQuerier` / `SeqNoQuerier` / `AnchorQuerier`
- `/ksn/{aid}` reply handling
- `/watcher/{aid}/{action}` reply handling
- ownership boundaries across `QueryCoordinator`, `Kevery`, `Revery`,
  `Hab.processCuesIter()`, and `AgentRuntime`

## Ownership Model

The main rule is that `keri-ts` preserves KERIpy behavior while making ownership
more explicit.

- `Revery` owns:
  - reply-envelope verification
  - BADA acceptance
  - reply escrow and replay
  - missing-signer `query` cue emission
- `Kevery` owns:
  - KEL query routes such as `logs`, `ksn`, and `mbx`
  - KEL-owned reply families such as `/ksn/{aid}` and `/watcher/{aid}/{action}`
  - `keyStateSaved` cues and query-not-found escrow
- `QueryCoordinator` owns:
  - the runtime correspondence step between incomplete `query` cues and honest
    outbound `qry` messages
  - KERIpy-style continuations that wait on remote key state or local catch-up
  - local habitat and remote-attester resolution for runtime-generated queries
- `Hab.processCuesIter()` owns:
  - cue-to-wire interpretation for already-complete cues
  - message materialization once a cue already has the source and destination
    information it needs
- `AgentRuntime` owns:
  - hosting and convergence only
  - not query policy itself

The most important boundary is this:

- incomplete `query` cues are correspondence requests
- complete `query` cues are wire-ready cue interpretations

## Why `QueryCoordinator` Exists

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

`QueryCoordinator` exists to keep that policy above the cue-to-wire seam.

## KERIpy To `keri-ts` Correspondence

| KERIpy source                                   | KERIpy role                                                                                    | `keri-ts` role                                                                                              |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `app/querying.py::KeyStateNoticer`              | start with `ksn`, then wait for `keyStateSaved`, then escalate to log query if remote is ahead | `KeyStateNoticer` continuation hosted by `QueryCoordinator`                                                 |
| `app/querying.py::LogQuerier`                   | query logs until local accepted state reaches target `sn`                                      | `LogQuerier` continuation                                                                                   |
| `app/querying.py::SeqNoQuerier`                 | query logs until local state reaches a requested sequence number                               | `SeqNoQuerier` continuation                                                                                 |
| `app/querying.py::AnchorQuerier`                | query logs until an event seal anchor appears locally                                          | `AnchorQuerier` continuation                                                                                |
| `app/agenting.py::WitnessInquisitor.query(...)` | choose endpoint target and send query later                                                    | `QueryCoordinator.wireEmissionForRequest(...)` resolves habitat and attester, then emits one wire query cue |
| `core/routing.py` missing-signer cue            | ask for signer establishment state when reply verification is blocked                          | `Revery` emits incomplete `query` cue, then `QueryCoordinator` resolves and sends it                        |
| `core/eventing.py::processReplyKeyStateNotice`  | KEL-owned `/ksn` reply processing                                                              | `Kevery.processReplyKeyStateNotice(...)`                                                                    |
| `core/eventing.py::processReplyAddWatched`      | watcher-owned observed-AID reply processing                                                    | `Kevery.processReplyAddWatched(...)`                                                                        |

## Incomplete Versus Complete `query` Cues

`keri-ts` intentionally keeps two shapes under one `QueryCue` contract.

Incomplete cue:

- usually produced by `Revery` or `Kevery`
- may contain only `pre`, `route`, `q/query`, or `wits`
- does not yet know the honest `src`
- does not yet know whether runtime can honestly choose a local habitat

Complete cue:

- includes both the queried prefix and a resolved attester source
- is ready for `Hab.processCuesIter()` to materialize into bytes

Maintainer rule:

- if a `query` cue still needs policy, it belongs to `QueryCoordinator`
- if it only needs message construction, it belongs to `Hab.processCuesIter()`

## Attester Resolution Contract

`keri-ts` intentionally diverges from KERIpy's random target selection.

Resolution order is:

1. explicit `wits` override from the cue
2. `controller`
3. `agent`
4. `witness`

Within any role family, `keri-ts` chooses the deterministic first sorted
endpoint identifier instead of a random entry.

Why:

- tests become stable
- maintainer reasoning becomes easier
- the branch surface is inspectable

Cost:

- it differs from KERIpy's transport-spread behavior
- it does not attempt witness load balancing in this layer

That is acceptable because Gate E is still a runtime/correspondence slice, not
full transport closure.

## Habitat Resolution Contract

`QueryCoordinator` resolves the signing habitat in this order:

1. explicit `hab` on the request
2. runtime-configured `hab`
3. the sole local habitat, if exactly one exists

If multiple habitats exist and none is explicit, `keri-ts` does not guess. The
request remains pending until some caller provides enough information.

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

## Continuation Semantics

The continuations mirror KERIpy's query doers, but they are hosted inside a
runtime-owned coordinator instead of as independent HIO doers.

`KeyStateNoticer`

- starts by requesting `ksn`
- completes immediately if local accepted state already matches or exceeds the
  remote report
- upgrades into `LogQuerier` if the remote KSN reports newer accepted state

`LogQuerier`

- emits `logs` from `fn=0`, `s=0`
- completes when local accepted sequence reaches the target sequence

`SeqNoQuerier`

- emits `logs` with explicit `fn` and target `s`
- completes when local accepted sequence reaches the requested threshold

`AnchorQuerier`

- emits `logs` with anchor search criteria
- completes when the local database contains a sealing event for that anchor

## Runtime Convergence Rule

`queriesPending` is part of `runtimePendingState()`.

Why:

- query continuations may owe a follow-on `logs` query after a `keyStateSaved`
  cue
- local runtime work can still be incomplete even when ingress, cues, and OOBI
  queues are empty

Without `queriesPending`, bounded command-local flows such as `init`, `incept`,
or focused runtime tests can terminate while the correspondence layer still has
unfinished work.

## Maintainer Checklist

When changing this area, confirm:

- does the branch belong to `Revery`, `Kevery`, or `QueryCoordinator`?
- is the cue incomplete or complete?
- does the runtime have enough information to choose a habitat honestly?
- is endpoint selection deterministic and documented?
- if a watcher or `/ksn` route changes, are the durable stores and trust rules
  still explicit?
- if a new continuation is added, does `queriesPending` still reflect it?

## Related Docs

- `docs/adr/adr-0003-agent-runtime-composition-root.md`
- `docs/adr/adr-0004-cue-runtime-portability.md`
- `docs/adr/adr-0005-kel-decision-control-flow.md`
- `docs/adr/adr-0008-escrow-decision-architecture.md`
- `docs/plans/keri/GATE_E_AGENT_RUNTIME_OOBI_PLAN.md`
