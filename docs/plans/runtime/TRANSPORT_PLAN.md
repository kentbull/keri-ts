# Production transport and backpressure plan

Planning constraint: [ADR-0013](../../adr/adr-0013-simple-component-flows.md) requires removal of
application accounting and unsupported delivery durability, without old-version
keri-ts API/data compatibility. Protocol correctness and real cleanup remain.

Owner: roadmap **6**, required for the next npm release and the existing goal.
Progressive parsing, HTTP/file intake, serialization, lazy replay and mailbox SSE
and explicit TCP conversations exist. Final composed/packed qualification remains open.
The [runtime contract][runtime] distinguishes current behavior from the target.

## Current boundary

- Accepted TCP sockets have one parser and shared borrowed writer;
  receipt/replay is correlated to the current dispatch. A pending query
  wakes via the owning runtime escrow driver. RX/TX are independent, drain deadlines
  are absolute and shutdown joins sources, parser, output and socket cleanup.
- WitnessReceiptor requires verified persisted receipts; runtime witness/query/
  Anchorer/Poster callers borrow existing services and use HTTP-first/TCP fallback.
  Standalone transmit-only operations retain their explicit completion contract.
- HTTP direct/queued fanout, generic request drains and witness source callbacks
  transfer owners under short guarded preparation and await transport outside it.
  Source witness intake collects no aggregate; finite wrappers return
  independent caller-owned snapshots. Transport failures remain explicit.
- Mailbox SSE is incremental, demand-driven and HTTP(S)-only. Delivery still permits
  TCP. Default mailbox/direct role precedence, signed introductions and host
  ownership remain intact; queued output is not a durable-delivery journal.

These are implemented caller boundaries, not proof of final release qualification.
[Exact PRs and source evidence](../../reports/parity/RUNTIME_PARITY_2026-10-14.md)
separate local drain, verified acceptance, caller-owned finite behavior and recovery.
Previous stream-slot and combined-floor measurements describe the removed ledger,
not future constraints. Use native stream/socket backpressure and actual cleanup.
Only a minimal private socket control backed by production performance evidence
may remain; no parser, domain or storage quota is permitted.

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
local drain or an HTTP status. Finite handling preserves actual cleanup, but no repository-wide collector/API rewrite is required.

## Deferred enhancements

These are optional roadmap items, not pre-release gates or active implementation:

- Stack-wide streaming beyond the reference, including lazy DID generation/export,
  credential/IPEX support export, mailbox administration and forwarding producers.
- New JSON/webhook/config/diagnostic streaming or cache facilities beyond existing
  behavior. Add no cache that lacks a KERIpy counterpart.
- Accepted-state eviction, generation/pinning and public borrowing API redesign.
- Future delivery guarantees require a separate decision and KERIpy grounding.
  Accounting is removed, not deferred for reimplementation.

Record useful proposals and preserved work; do not implement them in this goal.

## Review units

Use [cohesive review units](../PARITY_ROADMAP.md), permitting 1,000–3,000 changed
lines for complete deletion/refactoring cuts. Avoid artificial splits and temporary
accounting interfaces; preserve the single parser engine. Finish the active PR
before opening the next.

| Unit | Responsibility                         | Depends on       |
| ---- | -------------------------------------- | ---------------- |
| S1   | Plain cue-to-delivery records          | Protocol owners  |
| S2   | Network waits outside protocol turns   | S1               |
| S3   | Concrete transport outcomes            | S2               |
| S4   | Source-based witness ingress           | S2               |
| S5   | Pull-based TCP byte source             | Socket lifecycle |
| S6   | Supervised connections and shutdown    | S4–5             |
| S7   | Shared finite/stream TCP writer        | S6               |
| S8   | Explicit duplex replies and half-close | S3, S6–7         |
| S9   | Composed socket/HTTP qualification     | S1–8, storage    |

**S1–3: ordinary delivery.** Remove source-credit, queue admission and synthetic
ownership protocols. Existing workers prepare/sign concrete data and transport
reports its outcome. Actual file/iterator cleanup stays with its owner; ordinary
cue records need no release protocol. Network waits stay outside transactions.
Preserve real routing, request correlation, direct/mailbox sends and partial-failure
reporting. Delete outbox enqueue/retry and unsupported acknowledgement promises.
A local drain or HTTP status is not remote protocol or business acceptance.
No old-version keri-ts API/data compatibility or upgrade tests are required.

**S4–6: progressive receiving.** Use the existing FrameIntake parser/source owner; consume emissions per frame.
Do not restore the removed Reactor.frames API or use Reactor as a callback scheduler.
Give each connection one parser for its entire receive lifetime. The
socket adapter pulls bounded chunks on demand, propagates abort/error, and uses
only genuine receive EOF to finish input. Supervise and join every task. Shutdown stops new connections, aborts
reads, joins parser/dispatch/output cleanup, releases sockets, then closes stores.
Preserve witness-local dispatch, escrow turns, proof separation and genus scopes.

**S7–8: streaming output and duplex.** Use one owned TCP engine for complete
messages and abortable sources/owned payloads; already-parsed frames use the
serializer without reparsing. Retain actual borrowed sources through joined consumption. Await
`write(false)`/`drain` before pulling again. No preparation/output estimates.
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
application verification, durable storage, forwarding/replay and egress. Keep real processing order and native backpressure. Streaming routes should not
collect an entire transfer before processing; finite reference-backed collectors
remain permitted without application quotas.

| Requirement      | Current evidence           | Owner   | Unresolved gate              |
| ---------------- | -------------------------- | ------- | ---------------------------- |
| HTTP progress    | Progressive body intake    | S1–3    | Guard-free network waits     |
| TCP progress     | Witness accepts before EOF | S4–8    | Guard-free delivery/duplex   |
| Streamed output  | Shared HTTP/TCP writers    | S1–8    | Caller adoption and duplex   |
| Ownership        | Real source/socket owners  | S1–8    | Cancellation and joined stop |
| Recovery         | KERIpy-supported escrows   | Phase 5 | Protocol reopen/replay       |
| Production proof | Parser/focused cases       | S9      | All applicable stack paths   |

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
  source reads remain demand-driven. Measure actual native backpressure.
- Measure first **parsed** child separately from first **verified usable** child.
  Prove an independent GenericGroup child is usable before its enclosing transfer
  finishes. Parent-owned nested children are never independent accepted messages.
- Close HTTP cancellation provenance: a pending fetch join must not discard late
  unexpected I/O failures, and null-on-abort must recognize its own cancellation
  rather than any same-class AbortError. Preserve distinct primary/cleanup errors.
- Exercise cancellation, disconnect, malformed late children, EOF, processing
  failure and shutdown. Keep already delivered independent children; dispose all
  unclaimed owners and join I/O before releasing runtime/store resources.
- With two real live receive sources (including two TCP receives), verify actual
  queued/directed output progress and joined shutdown. Remove capacity-formula
  assertions; concurrent progress is the behavior under test.
- Exercise slow peers, partial-target failure, genuine versus truncated EOF,
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

Run this after accounting/durability removal and actual storage cleanup; preserve measurements
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
