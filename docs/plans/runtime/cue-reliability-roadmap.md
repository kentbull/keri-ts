# Cue delivery reliability roadmap

Status: deferred capabilities, not an active implementation queue. The [runtime contract](../../design-docs/runtime/INGRESS_AND_EGRESS.md) defines current
delivery behavior. This document records the evidence required before adding
a delivery or recovery mechanism.

## Deferred capabilities and evidence required

| Capability                                | Why it is outside the approved baseline                                                | Evidence needed before design                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Automatic retries and backoff             | Failure containment exists; recovery needs a concrete application owner                | A caller's retry obligation, retryable failure taxonomy, attempt/deadline semantics and duplicate tolerance             |
| Delivery deadlines and failover           | Concrete I/O owners keep actual lifecycle controls; no new workflow policy is added    | A measured operational failure, required end-to-end deadline and authorized alternate route behavior                    |
| Exact final-wire retries                  | No retry API exists; fresh admissions rebuild current routes and outer material        | A protocol or product requirement for identical final bytes, and rules for stale route/key/authentication state         |
| Per-target progress and deduplication     | Outcomes describe whole attempts; future resubmission may duplicate successful targets | A demonstrated harmful duplicate and a recipient-scoped completion/deduplication contract                               |
| Cross-batch fairness or parallel delivery | FIFO is intentionally simpler; a large replay can delay later replies                  | Representative replay/short-reply latency evidence, desired scheduling semantics and cancellation/resource limits       |
| Lazy queued replay                        | Eager preparation removes live traversal state and makes batch publication atomic      | Measured materialization cost plus a precise source snapshot, retry and cleanup contract                                |
| Durable work and crash recovery           | Runnable work/outcomes are process-local; reported failures have no recovery history   | An explicit durability requirement, authority for replay/reconstruction, transaction boundaries and crash/restart tests |
| Remote acknowledgement                    | Transport completion is not KERI acceptance or downstream business completion          | An actual authenticated acknowledgement protocol and correlation/replay model                                           |

## Decision rules

Name the concrete caller, failure and observable benefit before introducing a new
mechanism. Separate recovery from scheduling: reporting or recovering failed work does not
require a resumable multi-level cursor, and fairness does not imply durable work.
Do not change KERIpy to justify a TypeScript-only guarantee or reuse a transport
success cue as remote acceptance.

Prefer a focused extension to the actual owner over a generic execution layer.
Define what happens after cancellation, partial success, changed routes, sender
rotation and process death before promising reliability. Preserve honest limits
when tests establish only local completion. No item here authorizes its own
implementation, automatic monitoring or production changes.
