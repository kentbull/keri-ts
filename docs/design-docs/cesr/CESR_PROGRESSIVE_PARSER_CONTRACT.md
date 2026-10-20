# CESR finite decoding and evidence contract

The filename is retained for existing documentation links.
[ADR-0012](../../adr/adr-0012-progressive-nested-parser.md) replaces progressive
traversal with buffered finite decoding. The
[state-machine contract](CESR_PARSER_STATE_MACHINE_CONTRACT.md) owns completion,
genus scope and source lifecycle; the
[plan](../../plans/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md) owns remaining work.
[ADR-0013](../../adr/adr-0013-simple-component-flows.md) prohibits application
accounting. There are no parser byte, frame, tree, depth or ESSR quotas.

## Codec correctness

Serdery owns exactly one declared body copy and delegates hydration to Serder.
JSON uses native syntax and value semantics. MessagePack uses private standard
extensions (timestamp/ExtData) with shared key caching disabled. Binary fields,
Unicode, maps, tags and extension values retain their native codec shapes; Serder
validates the named protocol fields. No lexical heap estimates, workspace formulas,
capacity callbacks or speculative tag allowlist may be restored.

Wrapped non-native material falls back to opaque bytes only for intrinsic syntax
failures. MessagePack/CBOR token-extent inspection runs after native decode failure
solely to distinguish known incomplete/trailing boundaries from unexpected errors.
It does not reject valid input or run before allocation. Source, decoder and actual I/O cleanup failures retain their identities.

CBOR decoding restores map mode and resets message-bearing decoder globals before
returning. The captured native decode of private fixed null clears source, strings,
packed values, structures and references, replacing DataView backing with one byte.
Nested helpers defer reset until outermost completion. Primary and cleanup failures
retain identity in an AggregateError. The collection regression verifies that both
successful and malformed source backing becomes collectible; deleting reset fails it.
Keep the pinned MessagePack 3.1.3 and cbor-x 1.6.0 dependencies while these codec
and reset assumptions depend on their source. cbor-x extension shapes do not claim
byte or semantic parity with KERIpy cbor2 unknown-tag representations.

## Ordinary ESSR evidence

`CesrFrame.essrs` stores ordered Texters. Preserve qualified codes, fragmentation
and duplicates, including a big code carrying a small value. The signed ESSR
commitment covers concatenated raw bytes; fragment boundaries do not create
separate ciphertexts. The finite primitive reader validates alphabet, declared
extent and zero lead padding before admitting an incoming Texter.

ESSR evidence is an ordinary Texter array; consumers access raw or qualified
bytes directly. ESSR-specific content-reader adapters and staging owners are removed.
`essrChunks(texters, { gvrsn, domain })` synchronously yields counters and chunks
derived from the actual array and primitive extents. It has no lifetime policy;
actual Payload.open readers and replay operations check before publishing each
chunk. Finite stored-nest and resident-token hydration likewise take no signal. There is no caller-supplied count/size
manifest, lazy parser source, sink factory or discardFrame lifecycle.

`annotateFrames` and `annotate` are synchronous finite operations. Rendering walks
each hydrated node exactly once inside its original enclosure, preserving
headers, indentation, signatures, scoped selectors and ESSR order. GenericGroup
children get independent root ordinals. Deannotation restores original qualified
text, including from qb2 input. Parsed values remain usable after rendering.

## Real resource boundaries

`Payload { size, open(signal) }` describes an actual transport or serialized frame
source. Unused memory/file sinks and owned-payload disposal interfaces are removed.
`collectPayload` enforces its source's declared extent and joins its reader;
that is framing, not an allocation quota. Consumers own cancellation and cleanup
of actual files, sockets, readers and database work. Ordinary parsed values do
not acquire synthetic resource lifetimes.

The receiving loop preserves input order and successive open-connection messages.
It does not guarantee early children of incomplete groups or constant memory for
arbitrary groups. The Effection bridge is removed; concrete callers own and join
their actual I/O.

## Related contracts

- [Serialization](SERIALIZATION.md): counters and complete trees.
- [ESSR recipient](../essr/RECIPIENT.md): authenticated plaintext.
- [Exchange proofs](../exchange/EXCHANGE_PROOFS.md): independent authentication.
- [Payload storage](../db/PAYLOAD_STORAGE.md): durable publication and recovery.
- [Runtime ingress/egress](../runtime/INGRESS_AND_EGRESS.md): transport ownership.
