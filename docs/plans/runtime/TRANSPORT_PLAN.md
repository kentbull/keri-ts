# Production transport and backpressure plan

Owner: roadmap **6**. Progressive HTTP/file intake, serialization, lazy replay,
query delivery and mailbox SSE exist. Their [runtime contract][runtime] records
current finite guards. Shared admission and complete path qualification remain.

## Review units

Use [small stacked PRs](../PARITY_ROADMAP.md) after their resource/storage
dependencies, preserving the current transport engine:

1. Ingress read credit and bounded handoff through verification/storage.
2. Forwarding/replay/egress credit through a slow sink.
3. Cancellation, disconnect and failed-processing ownership cleanup.
4. Shutdown/EOF/late-malformed-child reconciliation.

Extend existing maintained transport cases where possible. Use uncommitted real
path probes to measure parsed versus verified-usable children and pressure. New
permanent integration coverage needs a demonstrated uncovered happy path or a
strong regression justification. Keep review diffs within the roadmap target.

## Required path

Qualify actual HTTP/file/TCP integrations through parsing, normalization,
application verification, durable storage, forwarding/replay and egress. Await
processing and sink credit; bound queues by both bytes and items. Streaming routes
must avoid `arrayBuffer()` and hidden transfer-sized joins/arrays. Finite convenience
collectors must declare and enforce their caps.

## Acceptance

- A deliberately slow real HTTP consumer stops upstream reads and storage growth.
- Measure first **parsed** child separately from first **verified usable** child.
  Prove an independent GenericGroup child is usable before its enclosing transfer
  finishes. Parent-owned nested children are never independent accepted messages.
- Exercise cancellation, disconnect, malformed late children, EOF, processing
  failure and shutdown. Keep already delivered independent children; dispose all
  unclaimed owners and join I/O before releasing runtime/store resources.
- Verify actual serializer output bidirectionally with the declared Python
  environment. Preserve parent signatures, child evidence and local genus scopes.

Run this against shared resource/storage work (4–5), then preserve measurements
in [final qualification](../qualification/QUALIFICATION_PLAN.md).

[runtime]: ../../design-docs/runtime/INGRESS_AND_EGRESS.md
