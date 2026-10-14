# Production transport and backpressure plan

Owner: roadmap **6**, required for the next npm release and the existing goal.
Progressive parsing, HTTP/file intake, serialization, lazy replay and mailbox SSE
and bounded witness TCP intake exist. Composed backpressure and duplex remain open.
The [runtime contract][runtime] distinguishes current behavior from the target.

## Current boundary

- `witness-tcp.ts` supervises admitted paused sources, distinguishes EOF from
  peer failure, and joins parser/socket tasks before listener shutdown completes.
- `processWitnessIngressSource` settles frames progressively; its finite wrapper
  still returns a bounded aggregate of emissions.
- Final direct HTTP query replies atomically share one interpreted batch between
  ReplyStreams and queued targets; no network runs during that preparation.
  Earlier-query and ordinary HTTP/witness cue drains still require adoption.
- Generic HTTP ingress already parses progressively, but HTTP/witness/runtime
  cue drains can await `Respondant` network delivery under the Reactor guard.
- The TCP sender shares a finite/source/frame writer and explicit same-socket
  reply processing (#271). Actual conversation callers remain S8; mailbox/direct
  routing remains the default.

Reuse the active admission stack: HTTP frame/output work (#224–225), finite TCP
ownership (#230), parser scheduling (#231), and mailbox stream admission.
Those units are dependencies, not proof of end-to-end socket streamability.
Generic witness sends and runtime delegation share services; finite TCP credit
follows joined socket close. Writer foundation is delivered; frame/caller
integration and replies remain S7–8.
HTTP already shares `requestFrame` (parsed frame) and `postCesr` (byte source);
its successful-response consumer is optional, so ordinary sends do not prove
verified protocol replies or durable remote acceptance.
Lazy replies, query queues, HTTP frame preparation and outgoing source parsing
share owner credit. Standalone sender wiring and native/storage copies still
require qualification through real slow sinks.

Raw Poster delivery exposes separate route snapshot, synchronous target
preparation and prepared HTTP sending. Runtime cue callers still compose them
under the guard; S1–3 must add admission, owned handoff and explicit outcomes.

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

## Stack-wide adoption gate

Incremental, cancellable, demand-driven I/O is the default across KERI and Tufa,
not an opt-in optimization for selected endpoints. This inventory extends the
existing S1–9 owners; it creates no parallel transport project. Two CESR transport
engines remain shared. GET, SSE and JSON retain their own framing while reusing
source, response, admission and lifecycle facilities.

| Path                    | Current boundary             | Owner / remaining adoption        |
| ----------------------- | ---------------------------- | --------------------------------- |
| [Hosts][hosts]          | HTTP/TCP streams             | S8: explicit TCP conversations    |
| [Delivery][delivery]    | Shared sends; guarded drains | S1–3, S7–8: owned workers/replies |
| [Queries][queries]      | Lazy POST/GET replay         | S1–3: owned delivery and proofs   |
| [Mailbox][mailbox-path] | Demand-driven SSE            | S1–3: cue/worker credit and stop  |
| [OOBI][oobi-path]       | Incremental intake/output    | S2: forwarding caller adoption    |
| [DID Webs][did-path]    | Streamed intake/static files | S2: lazy generation/export        |
| [Commands][commands]    | Mixed services/lifetimes     | S1–8: shared runtime wiring       |
| [JSON edges][json-path] | Finite documents/status      | S2: bounded exception audit       |

**Host and delivery adoption.** Audit native Deno and packed Node hosts, generic
CESR and witness-specific HTTP, receipts, TCP listeners and error paths. Reuse
connection/source ownership rather than a private collector or detached task.
Poster/Respondant, witness publication/receipting, delegation, exchange delivery,
query continuations and replay must use the shared admitted engines. Stream
introductions and replay-sized inputs; finite events/proofs may use finite adapters.
Preserve witness-local policy and default mailbox/direct routing. Verify response
consumers explicitly; status-only sends do not establish verified replies.

**Discovery and artifacts.** Oobiery must feed CESR bodies directly into the
progressive Reactor, keeping durable queued/in-flight/resolved ownership and marking
resolution only after complete successful intake. JSON/schema branches remain
bounded document parsing. Serve OOBI replay and witness GET KEL queries lazily,
including required role/location proofs, without joining whole histories. Stored
reply reconstruction has finite native body/proof-retention/wire-size ceilings;
lazy role selection and forwarding collection still need adoption. Stored output preserves actual
714 all-groups/exactly-one-cigar rules and fails without an authenticator, under
the explicit caller genus floor. Native proof-row pre-admission remains phase 5.
DID Webs resolution streams `keri.cesr` into accepted KERI/VDR state; success still
requires complete evidence, escrow resolution and comparison with hosted `did.json`.
Dynamic artifact output and static file serving pull under response demand;
generation/export writes bounded pieces rather than assembling a replay array.
Dynamic did.json uses JSON-only construction; its finite preparation admission
and the CESR generation/export source remain S2 requirements.
Preserve captured ranges, proof order, delegated evidence and current alias cutoffs.
HTTPS fallback must distinguish failed acquisition from partial application: do not
silently restart a consumed artifact or swallow cancellation/infrastructure faults.

**Composition and exceptions.** Audit CLI agent/witness/mailbox, OOBI, DWS/DKR,
query, multisig, IPEX, delegation and verifier commands through actual library
callers. Pass the runtime's exact services/policy into nested network operations;
standalone operations use one owned policy for their invocation. Finite receipts,
schema/DID JSON, administrative metadata and Sally-style webhook JSON can retain
whole-document semantics. They still need explicit size/copy/handle admission,
bounded response/error consumption, abort propagation and joined cleanup. The
sample webhook's unrestricted `request.json()` and retained presentation map are
open bounds, not an exemption because it is a demo. Do not force non-CESR data
through CESR messengers or invent incremental JSON verification.
WellKnownAuthenticator already uses shared services and joined status-only GET
response cleanup; shared handle admission remains open. Tufa operator/mailbox-debug
SSE callers still need the exact runtime services/policy. Local schema and credential
file inputs need finite preflight bounds before whole-file reads. Keep these in the
existing Commands/JSON edges S2 audit.

Publish each adoption slice within the existing S owners, separating OOBI receive,
OOBI/GET output, DID receive, DID artifact generation/serving and JSON lifecycle
fixes as needed to meet the review-size target. Preserve finite API convenience
where justified, with enforced ceilings before avoidable allocation. Every retained
collector needs a documented semantic reason, limit, owner and actual caller test;
"currently accepts bytes" is not a reason. Reconcile other `fetch`, socket, file
and body-reader call sites again before release so this inventory cannot hide a
new bypass. S9 requires all applicable rows adopted or a qualified bounded
exception; foundations alone do not close the stack gate.

### Actual caller closure

Apply these remaining ports within the existing units, in dependency order:

- **S1–3 delivery:** `processCuesOnce`, `Respondant` and `QueryCoordinator`
  transfer admitted source heads before interpretation/removal. Port generic HTTP
  and witness request-local drains through `runtime-bridge` and the CLI kernel.
  Keep correlated direct responses and `deliver=false` receipts explicit.
  Mailbox endpoint workers also need shared handle credit before spawning;
  per-event SSE limits alone do not bound aggregate workers.
- **S2 discovery/output:** OOBI HTTP output uses the lazy source (#281). Port
  replay-sized forwarding introductions to source delivery; a capped finite
  convenience method does not qualify the large-history caller.
- **S2 DID artifacts:** `generateDidWebsCesr`, dynamic CESR hosting and DID export
  use captured KEL/TEL/alias extents and demand-driven output. JSON-only construction
  and streamed static files are delivered; whole-history generation and
  credential-list callers still need replacement/admission. Internal owned ID
  capture and bounded selected-row reads are prerequisites; they do not close
  active-state/proof capture or actual artifact callers.
- **S2 receipt/catchup and mailbox administration:** thread the exact runtime
  services/policy into response readers and Receiptor; close database cursors
  before network suspension. Stream replay-sized mailbox submissions and admit
  bounded administrative parsing/copies. Keep finite receipts and multipart
  compatibility where justified, with failure/cancellation provenance intact.
  Outer response/request cleanup now joins and propagates failures. Request
  disconnect still needs to reach receipt settlement after finite intake.
- **S2 credential/exchange commands:** replace collected KEL/TEL/dependency and
  grant wire in presentation, issuance/revocation and IPEX network callers with
  owned sources. VC file/stdin intake feeds the progressive parser; finite export
  adapters need enforced ceilings. This ports existing workflows, not new protocol.
- **S2 JSON exceptions:** admit verifier webhook serialization and replace its
  whole ready-row snapshot with bounded work. Bound the sample hook's request body
  and retained presentations, and join host shutdown. Preserve JSON/status policy.
- **S7–8 conversations:** use shared finite/source engines through actual witness,
  delegation and command callers; same-socket replies require an explicit policy.
  Multisig/IPEX delivery inherits this path through Poster/Respondant.

For each inventory row, S9 records the actual default caller/source revision,
shared policy/owner, framing and completion boundary, and existing-test or retained
probe evidence. A finite exception also records its semantic reason, configured
ceiling and refusal-before-read/allocation evidence. Audit all socket/fetch/body
readers again on the release head, including service injection and host error
paths; absence from this table does not exempt a caller. An engine test without
caller adoption leaves the row open. Preserve small PRs and existing test topology.

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
does not survive restart: phase 5 owns [durable recovery][storage], including the
accepted-event-to-cue gap and optional mailbox-only outbox admission/recovery.

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

KERI/Tufa npm manifests advertise Node >=18.17. Query delivery, TCP output and
HTTP shutdown use ordinary Promises; packed secure randomness is initialized
before sodium (#270). Installed Node 18.17 probes cover these paths and static
file response shutdown. S9 still requires the composed package/runtime matrix;
neither newer-runtime checks nor a focused floor probe qualifies the whole stack.

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
- With the real default two live receive sources (including two TCP receives),
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
- Reconcile the stack-wide inventory: OOBI, witness GET replay, DID artifacts,
  command/service wiring and bounded JSON exceptions. Exercise existing real
  callers under slow sinks and cancellation; record any remaining collection and
  its enforced cap. End-to-end document success may still require full evidence.
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
[hosts]: ../../../../packages/tufa/src/host
[delivery]: ../../../../packages/keri/src/app/forwarding.ts
[queries]: ../../../../packages/keri/src/app/witnessing.ts
[mailbox-path]: ../../../../packages/keri/src/app/forwarding.ts
[oobi-path]: ../../../../packages/keri/src/app/oobiery.ts
[did-path]: ../../../../packages/keri/src/did/webs
[commands]: ../../../../packages/tufa/src/cli
[json-path]: ../../../../packages/keri/src/app/verifier-agent.ts
