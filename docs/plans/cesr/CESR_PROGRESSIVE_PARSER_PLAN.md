# Buffered CESR parser replacement plan

[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) replaces the progressive
architecture. [ADR-0013](../../adr/adr-0013-simple-component-flows.md) prohibits
application accounting and governs concrete component ownership. Old keri-ts API
and data compatibility is not required.

## Current state

The single progressive engine remains production code. Codec estimators, parser
quotas, source slots and frame-credit side tables are removed. This is an interim
removal checkpoint, not completion of the buffered replacement. Real sources,
payload stages and readers still need their current cleanup until callers move.

## Remaining cuts

1. Establish synchronous finite decoding responsibility using existing primitive,
   counter, body and attachment correctness. Do not restore the old parser wholesale.
2. Feed partial input into one buffered boundary. Decode counted enclosures only
   when complete; complete-byte and network input share that decoder. Delete
   progressive recursive traversal, its cursor and suspended parse state.
3. Choose one ordinary ESSR evidence representation. Remove parser sink factories,
   pending trees/stage registries and parser-only reopening/disposal wrappers.
   Retain storage files and cleanup only for demonstrated storage consumers.
4. Remove FrameIntake, TcpRead, frame channels and caller parser-option forwarding.
   The host scope owns concrete transport cancellation and joined cleanup.
5. Condense contracts, learnings and exports; replace early-delivery tests with
   complete-enclosure delivery checks. No second engine or compatibility aliases.

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
