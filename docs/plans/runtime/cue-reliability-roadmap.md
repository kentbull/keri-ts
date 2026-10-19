# Cue delivery reliability roadmap

Status: deferred capabilities, not an active implementation queue. The approved
[cue delivery refactor](cue-delivery-refactor.md) defines phases 0–4 and their
acceptance gates. This document prevents those phases from quietly becoming a
general delivery/recovery framework.

## Baseline after the approved refactor

Phase 3 implements one ephemeral Poster `evts` queue, sequential FIFO delivery and
explicit whole-event failures. Ordinary records carry signed source messages.
Known refusals allow the remaining destinations of that event to be attempted;
partial results remain with the failed event. Explicit retry refreshes routing,
introductions and forwarding envelopes, may repeat successful destinations, and
does not promise byte-identical final packets. Explicit discard removes retained
failed work. Phase 4 qualifies the concrete transport completion boundaries.

Local TCP drain or completed successful HTTP exchange does not establish remote
protocol acceptance. Independent request response streams keep their own
lifetimes. Protocol escrows and accepted evidence retain their existing durable
owners; the outbound queue does not become a durable business workflow.

## Deferred capabilities and evidence required

| Capability                                | Why it is outside the approved baseline                                                  | Evidence needed before design                                                                                           |
| ----------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Automatic retries and backoff             | Retained failure plus explicit retry is the selected policy                              | A caller's retry obligation, retryable failure taxonomy, attempt/deadline semantics and duplicate tolerance             |
| Delivery deadlines and failover           | Concrete I/O owners keep actual lifecycle controls; no new workflow policy is added      | A measured operational failure, required end-to-end deadline and authorized alternate route behavior                    |
| Exact final-wire retries                  | Retry retains the signed source, while current routes/introduction/forwarding may change | A protocol or product requirement for identical final bytes, and rules for stale route/key/authentication state         |
| Per-target progress and deduplication     | Failure retains the whole event; retry may repeat successful destinations                | A demonstrated harmful duplicate and a recipient-scoped completion/deduplication contract                               |
| Cross-batch fairness or parallel delivery | FIFO is intentionally simpler; a large replay can delay later replies                    | Representative replay/short-reply latency evidence, desired scheduling semantics and cancellation/resource limits       |
| Lazy queued replay                        | Eager preparation removes live traversal state and makes batch publication atomic        | Measured materialization cost plus a precise source snapshot, retry and cleanup contract                                |
| Durable work and crash recovery           | In-memory `evts`/`failures` are not a transactional outbox                               | An explicit durability requirement, authority for replay/reconstruction, transaction boundaries and crash/restart tests |
| Remote acknowledgement                    | Transport completion is not KERI acceptance or downstream business completion            | An actual authenticated acknowledgement protocol and correlation/replay model                                           |

## Decision rules

Name the concrete caller, failure and observable benefit before introducing a new
mechanism. Separate recovery from scheduling: a retained failed message does not
require a resumable multi-level cursor, and fairness does not imply durable work.
Do not change KERIpy to justify a TypeScript-only guarantee or reuse a transport
success cue as remote acceptance.

Prefer a focused extension to the actual owner over a generic execution layer.
Define what happens after cancellation, partial success, changed routes, sender
rotation and process death before promising reliability. Preserve honest limits
when tests establish only local completion. No item here authorizes its own
implementation, automatic monitoring or production changes.
