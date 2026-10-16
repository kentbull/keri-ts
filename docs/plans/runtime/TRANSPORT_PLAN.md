# Simple transport and complete-message ingestion plan

Buffered intake, concrete input/output owners, protocol-only Reactor serialization
and shared host workers are implemented. Final composed and installed-package
qualification passes for the published 1.0.0 baseline; the
[release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md) owns evidence
and explicit limits. The [roadmap](../PARITY_ROADMAP.md) owns future change
discipline; the [runtime contract](../../design-docs/runtime/INGRESS_AND_EGRESS.md)
owns delivered operational invariants. Historical progressive and accounting
instructions are not preservation authority.

## Delivered ownership

- Concrete HTTP/TCP readers own bytes, EOF/failure, cancellation and joined I/O.
  One buffered finite decoder waits for complete counted enclosures. Parser lifetime
  options, FrameIntake/TcpRead and custom frame/channel bridges are removed.
- Composition routes plain cues directly to QueryCoordinator, MailboxDirector and
  Respondant. Query/reply owners prepare/sign/publish before source removal and own
  exact retry packets and actual output I/O. No CueSink, delivery preparation layer,
  callback-based reply admission or generic Reactor application gate remains.
- Reactor orders dispatch/escrows, captures correlated replies before publication
  and returns decision data. Network waits stay outside protocol turns/transactions.
- CLI and hosts start the same component workers. Finite commands use accepted-state
  predicates and elapsed deadlines, then join workers. Phase-specific tests use
  actual owners; no serial runtime or finite mailbox polling API remains.
- Lower TCP lends actual sockets. Application composition owns parsing/dispatch
  and concurrent native RX/TX without an AgentRuntime dependency in byte transport.

Use native stream/socket backpressure. No application estimates, quotas, leases,
credits, no-op policy or synthetic record lifecycle. Only an observed production
problem could justify a minimal private socket constraint; it must not spread
configuration or outcomes upward. Keep real deadlines, I/O granularity, file
extents and reader/socket/store cleanup.

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

## Retained acceptance floor

Ownership migration is not a second workstream to recreate. Audit residual
facades/options only for a demonstrated current responsibility, and retain the
above boundaries while qualifying composed HTTP/TCP/SSE and command workflows.
Keep one implementation PR active; use cohesive cuts under the roadmap's review
allowance rather than temporary replacement APIs.

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
