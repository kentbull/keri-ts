# Production transport and backpressure plan

Owner: roadmap **6**, required for the next npm release and the existing goal.
Progressive parsing, HTTP/file intake, serialization, lazy replay and mailbox SSE
and explicit TCP conversations exist. Final composed/packed qualification remains open.
The [runtime contract][runtime] distinguishes current behavior from the target.

## Current boundary

- Accepted TCP sockets have one admitted parser and shared borrowed writer;
  receipt/replay is correlated to the current dispatch. One bounded pending query
  wakes via the owning runtime escrow driver. RX/TX are independent, drain deadlines
  are absolute and shutdown joins sources, parser, output and socket cleanup.
- WitnessReceiptor requires verified persisted receipts; runtime witness/query/
  Anchorer/Poster callers borrow existing services and use HTTP-first/TCP fallback.
  Standalone transmit-only operations retain their explicit completion contract.
- HTTP direct/queued fanout, generic request drains and witness source callbacks
  transfer owners under short guarded preparation and await transport outside it.
  Source witness intake collects no aggregate; finite wrappers return capped,
  independent caller-owned snapshots. Current sender refusal gates every response.
- Mailbox SSE is incremental, demand-driven and HTTP(S)-only. Delivery still permits
  TCP. Default mailbox/direct role precedence, signed introductions and host
  ownership remain intact; queued output is not a durable-delivery journal.

These are implemented caller boundaries, not proof of final release qualification.
[Exact PRs and source evidence](../../reports/parity/RUNTIME_PARITY_2026-10-14.md)
separate local drain, verified acceptance, caller-owned finite behavior and recovery.
Same-socket output works with two RX slots occupied. The default eight-stream
policy reserves headroom for ordinary polls and independent work; fairness and
final caller cleanup remain separately qualified boundaries. Busy must
preserve bounded work or close/refuse explicitly, never hide another waiting queue.
Native/kernel/fetch buffering and other storage reads retain their own limits.

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

## Reference-backed caller scope

The release requires streaming where KERIpy `71438328` supports it. It does
not require converting every KERI/Tufa socket, file, JSON or artifact caller.
Keep the shared engines and qualify their actual reference-backed uses. Names
alone do not prove lazy production: both upstream TCP messengers enqueue a
complete message, and HTTPStreamMessenger sends a finite bulk PUT.
Selective inter-component streaming is permitted when a concrete caller benefits
from incremental processing, reduced collection or cancellation and can reuse the
existing engines. Prioritize parity; no blanket conversion or new framework is
required. Optional proposals do not become release blockers.

| Reference path           | Release responsibility  | Remaining gate       |
| ------------------------ | ----------------------- | -------------------- |
| [TCP][tcp-ref]           | Continuous RX; owned TX | Caller/reply proof   |
| [HTTP][http-ref]         | Request/response owner  | Framing and cleanup  |
| [SSE][sse-ref]           | Incremental events      | Callers and shutdown |
| [Direct TCP][direct-ref] | Connection/parser owner | Pressure and stop    |

Use the existing S1–9 owners for those boundaries. Preserve Poster/Respondant
and witness/query delivery policy, finite receipt semantics and default mailbox
routing. Network waits stay outside guarded protocol turns. Keep the established
framed POST contract; do not introduce bulk PUT merely to match a class name.
The API mapping records that intentional wire difference.

Upstream OOBI and GET KEL output collect `rep.data`; forwarding introductions
collect a bytearray. Finite equivalents remain permitted. Existing merged lazy
OOBI/GET/DID intake/static-file enhancements remain supported TS integrations;
they do not create a requirement to convert all their producers or commands.
KERIpy core has no DID Webs artifact streaming path. Preserve the unpublished
lazy-DID worktree, without publishing it or activating new host/export callers.

Each required caller records the exact reference, framing, completion boundary,
services/owner and existing-test or retained-probe evidence. Qualify slow peers,
cancellation, failure and joined shutdown; do not infer verified acceptance from
local drain or an HTTP status. Finite handling still preserves existing caps and
cleanup, but no repository-wide collector/API rewrite is required.

## Deferred enhancements

These are optional roadmap items, not pre-release gates or active implementation:

- Stack-wide streaming beyond the reference, including lazy DID generation/export,
  credential/IPEX support export, mailbox administration and forwarding producers.
- New JSON/webhook/config/diagnostic streaming or cache facilities beyond existing
  behavior. Add no cache that lacks a KERIpy counterpart.
- Accepted-state eviction, generation/pinning and public borrowing API redesign.
- Exhaustive CBOR extension/arithmetic/share accounting and generalized new
  durable-delivery/recovery mechanisms beyond implemented reference behavior.

Record useful proposals and preserved work; do not implement them in this goal.

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

**S1–3: bounded delivery.** Reuse Deck/RuntimeDeliveries ownership. Reserve bytes
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
does not survive restart. Phase 5 qualifies existing escrow/store and optional
mailbox-outbox recovery. Report volatile delivery honestly; a new journal or
regeneration framework is deferred rather than required to claim upstream parity.

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
| TCP progress     | Witness accepts before EOF | S4–8    | Guard-free delivery/duplex     |
| Streamed output  | Shared HTTP/TCP writers    | S1–8    | Caller adoption and duplex     |
| Ownership        | Finite guards/active stack | S1–8    | Shared bounds and joined stop  |
| Recovery         | Optional mailbox outbox    | Phase 5 | Atomic/recoverable obligations |
| Production proof | Parser/focused cases       | S9      | All applicable stack paths     |

CESR/KERI/Tufa npm manifests require Node >=20.3. Final packed qualification uses
that minimum and the current CI runtime, including transport and joined cleanup.
Historical Node 18 probes remain evidence of their measured revision; Node 18 is
no longer a supported release target. A focused floor probe does not qualify the
whole stack.

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
- Close HTTP cancellation provenance: a pending fetch join must not discard late
  unexpected I/O failures, and null-on-abort must recognize its own cancellation
  rather than any same-class AbortError. Preserve distinct primary/cleanup errors.
- Exercise cancellation, disconnect, malformed late children, EOF, processing
  failure and shutdown. Keep already delivered independent children; dispose all
  unclaimed owners and join I/O before releasing runtime/store resources.
- With two real live receive sources (including two TCP receives),
  queued and directed output must progress or produce explicit bounded admission,
  refusal or closure. Never wait while holding every permit needed by the reply.
  Qualify the combined configured pipeline floor separately from temporary busy;
  individual bounded engines do not prove composed progress. Probe actual default
  callers before changing stream defaults or credit ownership.
- Exercise saturation, partial-target failure, genuine versus truncated EOF,
  half-close and absolute drain expiry. Earlier independent frames survive later
  failure. An unwrapped final message may await a following body or real EOF;
  temporary byte exhaustion and arbitrary chunks never establish CESR framing.
- Exercise finite/source parity through actual callers, including parsed-frame
  input without reparsing. Verify HTTP method, destination, authorization, media
  type, response consumption and one-request-per-frame behavior under pressure.
- Reconcile the reference-backed TCP/HTTP/SSE callers, including their actual
  witness/query consumers. Exercise slow sinks, cancellation and services wiring.
  Record permitted upstream finite collection and separately label TS additions.
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
[tcp-ref]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/app/agenting.py#L683
[http-ref]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/app/agenting.py#L827
[sse-ref]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/app/indirecting.py#L731
[direct-ref]: https://github.com/WebOfTrust/keripy/blob/7143832813cac6a394ab1faf9be83bb3372be87c/src/keri/app/directing.py
