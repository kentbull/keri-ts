# Simple transport and complete-message ingestion plan

Accepted direction: 2026-10-15; implementation/qualification remain pending.
The [roadmap](../PARITY_ROADMAP.md) and [buffered parser](../cesr/CESR_PROGRESSIVE_PARSER_PLAN.md)
supersede progressive intake, general Reactor gates and delivery preparation.
The [runtime contract](../../design-docs/runtime/INGRESS_AND_EGRESS.md) must be
reconciled before affected implementation; it is not preservation authority.

## Ownership

- Concrete HTTP/TCP readers receive bytes, observe EOF/failure and close actual
  I/O. The parser buffers complete counted enclosures and decodes synchronously.
  Complete messages pass to concrete protocol processors. The parser and finite
  annotation accept no cancellation options. Consuming operations check before
  and after pulls and halt waiting dispatch/active consumers on external abort;
  concrete readers still interrupt and join actual I/O.
- Existing host operation scopes start, cancel and join readers, dispatch and
  output. FrameIntake, TcpRead.open, FrameChannel/toEffectionFrames and parser
  lifetime options are removed. TCP lends a real connection and composes native
  RX/TX at the application. Remove remaining admission/delivery hooks without
  introducing another intake framework. Generic HTTP requests, Fetch input, client
  SSE and static artifact responses now have no accounting or size ceilings.
  Provider mailbox responses now also own readers directly without byte/stream/
  topic/metadata policies. Listener/runtime and finite receipt policies still need removal;
  retain deadlines, actual I/O chunking, regular-file extents and joined cleanup.
- Plain cues reach their concrete Respondant/Poster/response owner. Delete generic
  preparation/delivery lifecycle wrappers. Real routing, signing, correlation and
  retry bytes stay with those owners. Reactor does no unrelated execution.
- Choose actual dependencies at construction; CLI and hosts use the same workers.
  Network waits occur outside transactions and state-sensitive protocol turns.

Use native stream/socket backpressure. Application estimates, quotas, leases and
credits are removed. A minimal private socket constraint needs an observed
production problem and evidence; it must not spread policy or options upward.
Ordinary records have no synthetic resource lifecycle.

## TCP and HTTP semantics to retain

TCP receives fragments and multiple messages on one connection. Keep one receive
buffer/parser owner per connection. Full counted enclosure availability permits
processing before connection EOF; a child inside an incomplete enclosure does not.
Body completion and network chunk boundaries do not finish attachments.

Preserve concurrent RX/TX, same-socket response correlation where requested,
independent directional errors, receive EOF versus transmit completion, and
explicit half-close. Drain pending output before ending it; retain the existing
absolute drain deadline where the concrete connection requires it. Actual activity
must not silently extend that deadline. Cancellation joins both directions.

Await native write/drain before pulling more outbound data. Use the same concrete
writer for finite messages and actual source consumers; serialize already parsed
messages without reparsing. Keep a source only while its real consumer needs it.
HTTP readers/writers own body completion, abort and cleanup; late unexpected I/O
errors remain errors. Do not treat every AbortError as the operation's own cancel.

Preserve mailbox/direct default routing, HTTP-first/TCP fallback where currently
required, incremental mailbox SSE, signed introductions and host ownership.
WitnessReceiptor completion requires verified persisted receipts. Local write
completion or HTTP status is not remote protocol/business acceptance. DID/OOBI
completion requires its final validation, not merely parsed input.

Shutdown stops accepting work, cancels reads, joins readers/dispatch/output, closes
sockets, then releases owned stores. Borrowed stores remain caller-owned. Keep
actual reader/file/iterator cleanup, not cleanup wrappers for ordinary frame data.

## Reference and scope

Use KERIpy `7143832813cac6a394ab1faf9be83bb3372be87c` as the recorded reference,
with current qualification pins in [reference environments](../qualification/REFERENCE_ENVIRONMENTS.md).
KERIpy TCP messengers enqueue complete messages; HTTPStreamMessenger uses a finite
bulk PUT. Keep the supported framed POST contract and document its intentional
wire difference; class names do not require copying a different HTTP endpoint.

Finite collection is permitted. Incremental network I/O does not imply progressive
decoding inside an enclosure. Do not require converting every file, DID artifact,
JSON endpoint, export, mailbox command or cache to streaming. Preserve unpublished
lazy-DID work without activating or publishing it. No new outbox, unsupported
acknowledgement, accepted-state eviction or borrowing framework is in scope.

## Review units and acceptance

1. Move actual cue routing/signing/correlation to existing owners and delete the
   preparation framework, general Reactor gate and vague service contracts.
2. Integrate the finite decoder with concrete receive loops; remove intake/cursor/
   channel bridges and options throughout their callers in a cohesive cut.
3. Qualify real HTTP/TCP/SSE callers and shared CLI/host worker lifetimes.

Combine units where splitting creates temporary APIs. Keep one implementation PR
active under the roadmap's 1,000–3,000-line deletion/refactoring allowance.

Use existing real-path tests for:

- Signed enclosed acceptance on an open TCP connection after its full enclosure
  arrives; fragmented multi-message input and actual Hab/serializer output.
- No GenericGroup delivery before its whole enclosure arrives; parent-owned nests
  stay attached and independently checked. No group-wide transaction is added.
- Another connection making progress while one awaits bytes; native slow read/write
  behavior, directional failure, cancellation, truncation, half-close and shutdown.
- HTTP request framing/auth/method, response consumption, disconnect and late I/O
  failure, receipt/replay correlation and distinct primary/cleanup errors.
- Real storage/escrow reopen and qualified evidence, with no invented delivery
  recovery guarantee. Joined source/reader/socket cleanup and correct store ownership.

Use representative traffic; no early-enclosure delivery, constant-memory plateau
or fixed giant-transfer performance gate. Historical measurements remain evidence
only. Validate source Deno and packed Node at the advertised minimum and current
CI runtime. Shared decoder tests alone do not qualify actual transport callers.
The [qualification plan](../qualification/QUALIFICATION_PLAN.md) owns the full
battery and live disclosure/KRAM gate before the three package releases.
