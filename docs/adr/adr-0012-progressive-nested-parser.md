# ADR-0012: Buffered CESR Decoding and Concrete Input Ownership

- Status: Accepted; finite decoding implemented, transport migration pending
- Updated: 2026-10-15
- Scope: CESR framing, decoding, ESSR evidence and transport integration
- Related: [simple component flows](adr-0013-simple-component-flows.md)
- Execution: [parser replacement plan](../plans/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md)

## Decision and tradeoff

Replace progressive traversal with one synchronous finite decoder shared by
complete input and a small network receiving loop. The receiving boundary buffers
incomplete input and enters a counted enclosure only after its entire declared
extent arrives. Decode nested enclosures using local offsets and finite ranges.
Continue processing successive messages on an open connection.

Memory use and first-message latency may grow with the complete enclosing group.
Early GenericGroup child delivery and constant-memory processing of arbitrarily
large groups are no longer goals. Do not restore progressive traversal, scoped
parser cursors, strategies, parser-owned staging or accounting to recover them.
Historical measurements describe the former design, not acceptance requirements.
Do not restore an old parser wholesale or discard later wire-correctness fixes.

## Framing and evidence

Network chunks never delimit messages. A body does not necessarily complete its
attachments: unenclosed messages need an actual attachment/following-message
boundary or applicable EOF. Completed wire framing must not wait for connection
EOF. A truncated item inside a complete enclosure is malformed; later bytes
cannot repair it. Preserve scoped genus, both protocol versions and domains,
parent-owned nests and independently authenticated child evidence.

Extract ESSR as ordinary Texter values and qualified/raw bytes with one
authoritative parsed representation. Preserve qualified evidence for verification,
relay, persistence and replay. Texter fragmentation never introduces independent
encryption messages. Authenticate logical plaintext before publication.

## Ownership

Transport owns blocked reads, EOF, cancellation, deadlines and real resource
closure. The host operation scope connects received bytes to the decoder and
complete messages to protocol processing. CESR decoding has no Effection
dependency. Remove FrameIntake, TcpRead, custom frame channels, parser option
forwarding, provenance callbacks and iterator machinery made unnecessary by this
separation. Choose one cancellation owner; transport readers cooperate with it.

Remove parser sink factories, EssrWriter staging, pending/finished owner registries,
parallel pending trees, cursor reopening and mandatory disposal of ordinary parsed
values. Real file storage/reopenable payloads remain only where current storage
consumers need them. Do not redesign storage merely to mirror parser changes.

TCP send and receive can progress concurrently. Receive EOF must not destroy the
connection before a queued response drains. Local transmission, protocol
acceptance and remote acknowledgement remain distinct. Buffering adds no
whole-enclosure database transaction or rollback framework.

## Migration and qualification

Finite decoding and ordinary ESSR evidence replace the progressive engine.
TcpRead and the Effection bridge remain transport migration work. First establish finite
decoding responsibility, then switch behavior and delete its cursor/staging and
dependent contracts in cohesive cuts. Keep one engine, no compatibility aliases
or alternate strategy. The old early-delivery tests must become complete-enclosure
checks when production behavior switches; retain fragmentation, framing, evidence,
real network cleanup and current KERIpy interoperability coverage.

Application accounting is prohibited by ADR-0013. Full maintained integration,
e2e, interop and installed-package qualification, including live disclosure/KRAM,
remains required before publication. Giant-transfer performance matrices are not
architecture gates.
