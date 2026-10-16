# CESR Parser Maintainer Guide

Read the [state-machine contract](CESR_PARSER_STATE_MACHINE_CONTRACT.md) for
completion/genus rules and the [evidence contract](CESR_PROGRESSIVE_PARSER_CONTRACT.md)
for codec and ESSR semantics. One finite decoder serves complete input and the
buffered receiving loop.

| Module                    | Responsibility                                                            |
| ------------------------- | ------------------------------------------------------------------------- |
| parser/decoder.ts         | Decode complete finite ranges, enclosure bounds and local genus scopes.   |
| parser/parser.ts          | Accumulate fragments and request more bytes on shortage; join the source. |
| parser/complete.ts        | Synchronous parseBytes through the same finite decoder.                   |
| parser/body.ts            | Decode native, non-native or opaque body framing.                         |
| parser/attachments.ts     | Hydrate finite v1/v2 evidence leaves and tuples.                          |
| parser/essr.ts            | Derive raw/qualified byte views from ordered Texters.                     |
| primitives/texter.ts      | Validate qualification and zero lead padding.                             |
| parser/serialize.ts       | Derive output counters and lengths from complete evidence.                |
| annotate/render.ts        | Render each node within its original wire scope.                          |
| keri/src/app/parsering.ts | Project hydrated values into protocol envelopes.                          |

## Follow a message

1. For finite bytes, call parseBytes. For transport input, parse receives fragments
   from a source that cooperates with its owner's cancellation signal.
2. Receive a complete counted enclosure before decoding its first child. Open
   attachments need a following body, a closed enclosure or applicable real EOF.
3. Decode local finite scopes and exact count units. Parent-owned nests retain
   independent bodies/signatures; their proofs are never inherited from parents.
4. Carry ESSR as ordered Texters. No parser sink, cursor, owner registry or ordinary
   frame disposal exists. Storage and crypto own their actual file work.
5. Dispatch verifies policy/proofs and publishes protocol state. Parsing alone
   authenticates nothing. A received group creates no database transaction.

Async parse marks intrinsic wire failures with WireParseError and preserves the
finite cause. Source, codec infrastructure and abort failures retain identity.
Finite parseBytes throws directly. Annotation is synchronous and retains ordinary
parsed values after rendering. Buffering accepts enclosure-sized memory/latency;
no early-child or giant-transfer performance gate applies.

## Extend only at existing boundaries

Check pinned KERIpy first. Add finite leaves to HANDLERS_V1/HANDLERS_V2 and
structural framing to decoder.ts. Use narrow primitive readers and actual tuple
helpers, without a descriptor factory, parser strategy or compatibility engine.
Keep item counts separate from quadlet/triplet counts and genus separate from
body protocol. Selected input never retries under another major version.

Validate frozen vectors, text/binary domains, fragmented input, terminal shortages,
scoped genus and nested proofs. Generated tables target KERIpy
7143832813cac6a394ab1faf9be83bb3372be87c; live fork pins remain explicitly separate.
The Effection bridge/TcpRead and scheduler subpath are removed. Applications own
actual I/O and consume parse(source) directly; see the
[parser plan](../../plans/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md).
