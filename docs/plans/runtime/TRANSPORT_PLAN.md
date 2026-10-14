# Production transport and backpressure plan

Owner: roadmap **6**, required for the next npm release and the existing goal.
Progressive parsing, HTTP/file intake, serialization, lazy replay and mailbox SSE
exist. TCP socket-to-application streaming and composed backpressure remain open.
The [runtime contract][runtime] distinguishes current behavior from the target.

## Current boundary

- `witness-tcp.ts` collects the entire connection before parsing, treats `close`
  as successful EOF, and detaches connection tasks from listener shutdown.
- `processWitnessIngress` accepts finite bytes and retains all emissions.
- Generic HTTP ingress already parses progressively, but HTTP/witness/runtime
  cue drains can await `Respondant` network delivery under the Reactor guard.
- The TCP sender accepts finite bytes and ends output; it has no streamed writer
  or same-socket reply consumer. Existing replies use mailbox/direct routing.

Reuse the active admission stack: HTTP frame/output work (#224–225), finite TCP
ownership (#230), parser scheduling (#231), and mailbox stream admission.
Those units are dependencies, not proof of end-to-end socket streamability.
HTTP already shares `requestFrame` (parsed frame) and `postCesr` (byte source);
its successful-response consumer is optional, so ordinary sends do not prove
verified protocol replies or durable remote acceptance.
Lazy replies, query queues, HTTP frame preparation and outgoing source parsing
share owner credit. Standalone sender wiring and native/storage copies still
require qualification through real slow sinks.

## Messenger organization

Use two shared transport engines, with small finite-message and source entry
points. The [API/ownership mapping][messengers] assigns the responsibilities of
KERIpy’s four Messenger names without four classes, duplicate state machines or
new `msgs`/`sent` queues. Parsed frames go directly to serializers; finite bytes
adapt to the same source engine. HTTP keeps successive framed POST requests,
including per-frame streamed body mode, rather than adopting upstream’s bulk PUT.

This is part of S1–9: S1–3 owns HTTP callers, response lifetimes and guarded
preparation; S6–8 owns TCP connection, finite/source output and conversation
policy. Preserve Poster/Respondant routing and Reactor verification boundaries.

## Review units

Use [small stacked PRs](../PARITY_ROADMAP.md), each targeting 300–500 changed
lines or fewer. Split again if necessary; preserve the single parser engine.

| Unit | Responsibility                               | Depends on       |
| ---- | -------------------------------------------- | ---------------- |
| S1   | Admitted cue-to-delivery ownership           | Shared policy    |
| S2   | Guard-free delivery and HTTP ownership       | S1               |
| S3   | Delivery failure and acknowledgement         | S2               |
| S4   | Source-based witness ingress                 | S2               |
| S5   | Pull-based TCP byte source                   | Read credit      |
| S6   | Supervised TCP connections and shutdown      | S4–5             |
| S7   | Shared finite/stream TCP writer              | #230             |
| S8   | Explicit duplex replies and half-close drain | S3, S6–7         |
| S9   | Composed socket/HTTP qualification           | S1–8, phases 4–5 |

**S1–3: bounded delivery.** Reuse Deck/QueryDeliveries ownership. Reserve bytes
and items before interpretation; remove the source cue only after admitted
transfer. Phase 4 must also charge retained cue bytes before producer enqueue or
acceptance and transfer that credit; a charged delivery queue alone is insufficient.
Saturation retains that cue and suspends outside the guard with finite
waiters. Prepare signing, introductions, routing and local mailbox writes under
short guarded turns; only independently owned network work escapes. A replay
retains its captured extent and at most one current message, never a log array.
Update HTTP/witness drains, runtime turns and CLI callers; use a bounded joined
delivery worker, not detached tasks. Preserve request-local HTTP reply ownership
and `/receipts`' finite `deliver=false` path. Retain failed work and report partial
mailbox failures; acknowledge only joined delivery or verified durable transfer.
Converge actual HTTP callers on shared admission and scoped response consumption,
preserving receipt and SSE contracts. Distinguish transport completion from
verified replies and durable acceptance; do not expose ambiguous `sent`/`idle`
success. Keep cancellation, cleanup and infrastructure failures visible. This live queue
does not survive restart: phase 5 owns [durable recovery][storage], including the
accepted-event-to-cue gap and the optional mailbox-only outbox's atomicity.

**S4–6: progressive receiving.** Add `processWitnessIngressSource` using
`Reactor.frames/settle`; consume emissions per frame and keep the finite wrapper.
Give each admitted connection one parser for its entire receive lifetime. The
socket adapter pulls bounded chunks on demand, propagates abort/error, and uses
only genuine receive EOF to finish input. Admit connection/read credit before
starting reads; supervise and join every task. Shutdown stops admission, aborts
reads, joins parser/dispatch/output cleanup, releases sockets, then closes stores.
Preserve witness-local dispatch, escrow turns, proof separation and genus scopes.

**S7–8: streaming output and duplex.** Use one owned TCP engine for complete
messages and abortable sources/owned payloads; already-parsed frames use the
serializer without reparsing. Acquire credit before opening sources or allocating
output; retain borrowed owners through joined consumption. Await
`write(false)`/`drain` before pulling again, with finite charged pending output.
Parse replies concurrently with sending in an explicit same-socket reply mode;
retain mailbox/direct delivery as the default. Same-socket connections use
`allowHalfOpen: true` and explicit output end after drain. Distinguish receive
EOF, transmit failure, local write completion and authenticated remote acceptance.
An absolute, non-refreshing drain deadline bounds accepted input and responses;
activity cannot prolong it. Cancellation joins both directions and releases owners.

Extend existing maintained transport cases where possible. Use uncommitted real
path probes to measure parsed versus verified-usable children and pressure. New
permanent integration coverage needs a demonstrated uncovered happy path or a
strong regression justification. Keep review diffs within the roadmap target.

## Required path and evidence

Qualify actual HTTP/file/TCP integrations through parsing, normalization,
application verification, durable storage, forwarding/replay and egress. Await
processing and sink credit; bound queues by both bytes and items. Streaming routes
must avoid `arrayBuffer()` and hidden transfer-sized joins/arrays. Finite convenience
collectors must declare and enforce their caps.

| Requirement      | Current evidence           | Owner   | Unresolved gate                |
| ---------------- | -------------------------- | ------- | ------------------------------ |
| HTTP progress    | Progressive body intake    | S1–3    | Guard-free network waits       |
| TCP progress     | Whole-connection intake    | S4–6    | Acceptance before EOF          |
| Streamed output  | HTTP serializer path       | S7–8    | TCP pressure and duplex        |
| Ownership        | Finite guards/active stack | S1–8    | Shared bounds and joined stop  |
| Recovery         | Optional mailbox outbox    | Phase 5 | Atomic/recoverable obligations |
| Production proof | Parser/focused cases       | S9      | Real socket-to-store path      |

S9 extends existing transport/runtime tests for decisive regressions:

- A signed enclosed TCP event reaches verified witness state before client EOF;
  several arbitrarily fragmented messages share one connection/parser. Audit
  actual TCP producers and exercise real Hab/serializer output, proving their
  counted enclosures permit early dispatch, not only hand-built receiver input.
- A stalled connection or slow delivery leaves another connection able to
  dispatch. Real HTTP/TCP slow sinks stop upstream reads and retained queue growth;
  admitted storage remains demand-driven. Prove pressure at each handoff.
- Measure first **parsed** child separately from first **verified usable** child.
  Prove an independent GenericGroup child is usable before its enclosing transfer
  finishes. Parent-owned nested children are never independent accepted messages.
- Exercise cancellation, disconnect, malformed late children, EOF, processing
  failure and shutdown. Keep already delivered independent children; dispose all
  unclaimed owners and join I/O before releasing runtime/store resources.
- Exercise saturation, partial-target failure, genuine versus truncated EOF,
  half-close and absolute drain expiry. Earlier independent frames survive later
  failure. An unwrapped final message may await a following body or real EOF;
  temporary byte exhaustion and arbitrary chunks never establish CESR framing.
- Exercise finite/source parity through actual callers, including parsed-frame
  input without reparsing. Verify HTTP method, destination, authorization, media
  type, response consumption and one-request-per-frame behavior under pressure.
- Verify actual serializer output bidirectionally with the declared Python
  environment. Preserve parent signatures, child evidence and local genus scopes.

Run this against shared resource/storage work (4–5), then preserve measurements
in [final qualification](../qualification/QUALIFICATION_PLAN.md). S9 is a release
gate; long probes stay local/manual under the existing hosted 15-minute cap.

## Reference boundary

KERIpy `7143832813cac6a394ab1faf9be83bb3372be87c` remains the normative parity
baseline. The reviewed [GLEIF lifecycle implementation][gleif] at `a55a712d`
(`gleif_hio==0.6.20rc3`) is a separate comparison for directional close, task
ownership and bounded drain. Do not substitute its buffer-exhaustion framing or
fork behavior for upstream wire evidence. Node's [stream threshold][buffering]
is not a hard memory ceiling; qualify actual Deno and packed Node paths.

[runtime]: ../../design-docs/runtime/INGRESS_AND_EGRESS.md
[messengers]: ../../design-docs/runtime/INGRESS_AND_EGRESS.md#messenger-responsibilities
[storage]: ../db/STORAGE_RECOVERY_PLAN.md
[gleif]: https://github.com/GLEIF-IT/keripy/blob/a55a712d1dd92121ab659d76ee71942155f6caa9/src/keri/app/directing.py
[buffering]: https://nodejs.org/api/stream.html#buffering
