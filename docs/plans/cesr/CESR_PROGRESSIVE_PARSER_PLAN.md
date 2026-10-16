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
at the composition point; the two TCP bridge callers remain transitional.

## Remaining cuts

1. Remove TcpRead, custom frame channels and caller parser-option forwarding.
   Concrete transport scopes own cancellation, blocked reads and joined cleanup.
2. Remove remaining runtime/transport accounting and delivery/pump indirection
   under ADR-0013 without weakening actual socket/file cleanup.
3. Resolve the reverse HTTP KERIpy genus contract and qualify successive messages,
   same-socket replies, half-close and failure paths.
4. Complete maintained composed disclosure/KRAM interoperability and final release
   qualification from the parity roadmap.

Combine cuts where separation would require temporary interfaces. Refactor
responsibilities before changing behavior. Buffering accepts memory and latency
proportional to complete groups; no giant-transfer performance gate remains.

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
