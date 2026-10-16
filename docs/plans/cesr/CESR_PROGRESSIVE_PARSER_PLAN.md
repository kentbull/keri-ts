# Buffered CESR parser replacement plan

[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) replaces the progressive
architecture. [ADR-0013](../../adr/adr-0013-simple-component-flows.md) prohibits
application accounting and governs concrete component ownership. Old keri-ts API
and data compatibility is not required.

## Current state

One synchronous finite decoder now serves parseBytes and the small buffered
receiving loop. Counted groups arrive completely before decoding children.
Cursor, EssrWriter, parser sink factories/staging, ordinary-frame disposal and
FrameIntake are removed. Dispatch, serialization, annotation and exchange storage
use ordered Texter evidence. Existing file storage/crypto cleanup remains real.
PR #459 merged the decoder after scoped validation. PR #461 moved Reactor,
finite receipt/legacy multisig inspection and CLI grant scans off the custom
frame channel. HTTP, witness and stored-replay inputs now own their iterators
at the composition point. TCP applications now compose real connections with
native receive/send tasks; the frame bridge, TcpRead and exported adapter are removed.

## Delivered sequence

Concrete input cancellation/join, runtime/transport accounting removal, direct
output ownership and the reverse HTTP genus correction are delivered. Maintained
successive-message, same-socket reply, half-close, failure and disclosure/KRAM
cases pass the complete 1.0.0 release qualification. The
[release report](../../reports/parity/CLEANUP_RELEASE_2026-10-16.md) owns evidence
and limits; do not reopen the old migration sequence. Refactor responsibilities
before future behavior changes, and retain the regression floor below.

## Regression floor

Keep exact enclosure exhaustion, terminal truncation, every chunk split, local
genus scopes, both wire domains, v1 item/v2 byte counts, unsupported-version
rejection and independent nested proof verification. Chunk boundaries never
complete attachments. Unenclosed messages need real wire boundaries or applicable
EOF. Preserve successive messages on open TCP connections, same-socket replies,
half-close and actual I/O failure/cancellation cleanup.

Current-reference accessor/projection audits and structural consumer guards
remain protocol obligations. Preserve native codec semantics, exact body ownership
and proven CBOR reset. The full maintained release battery and live graduated
disclosure/KRAM gates remain in the [parity roadmap](../PARITY_ROADMAP.md).
