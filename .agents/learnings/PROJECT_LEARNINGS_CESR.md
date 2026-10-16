# CESR learnings

ADR-0012 now requires buffered complete-enclosure decoding. The progressive
decoder now replaces the progressive engine/cursor/staging lifecycle. Keep real wire rules and actual I/O cleanup.

## Removal precedence (2026-10-15)

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) now requires removal
of all application budgeting and unsupported outbox, mailbox consumer-ack and
KRAM ready/snapshot durability. Any descriptions below of credits, reservations,
capacity admission or those delivery guarantees describe transitional code, not
instructions to preserve it. Remove those passages with their owning code rounds.
Preserve independent wire/crypto/transaction correctness and actual cleanup.
Only a minimal private socket constraint justified by production evidence may
remain; no parser, domain, storage, runtime or CLI accounting exception exists.

## Parser and evidence

- One synchronous finite decoder serves parseBytes and the async receiving loop.
  Receive complete counted enclosures before decoding children. Accept group-sized
  memory/latency; no early child or giant-transfer gate.
- Chunk boundaries never complete attachments. Keep real framing, exact enclosure
  exhaustion, scoped genus, terminal truncation and fresh invocation selection.
- ESSR is ordered Texter evidence. Preserve code, order, duplicates and padding
  validation in the finite primitive reader. Derive raw/wire Payload views and
  serialized counts from that representation; ordinary values need no disposal.
- Annotation is synchronous and walks original wire scopes with each hydrated
  node once. Rendering does not acquire parser payload owners.
- parse(source) has no options; annotation is presentation-only. Input operations
  check before/after pulls and stop buffered/waiting dispatch on cancellation.
  Benchmark cancellation is a direct operation signal, never parser configuration.
- Files, crypto, sockets and actual Payload readers retain their own cleanup.
  The Effection bridge and subpath are removed. Sources cooperate with their
  owner's signal. Finite essrChunks/chunk formatting and stored-nest/resident-token
  hydration have no lifetime options; Payload.open and replay owners check before
  each publication. Archive/file-backed ESSR retrieval keeps its actual I/O signal.
- Async parse wraps intrinsic wire failures; source, unexpected codec and abort
  failures retain identity. Finite parseBytes throws its underlying error.
- MessagePack uses private standard extensions with key caching disabled. CBOR
  retains native values, resets message globals and restores map mode. Keep the
  pinned codecs and collection regressions; no heap estimates or tag allowlist.
  Opaque fallback requires intrinsic syntax failure. Serdery owns exact body bytes.
- Public CBOR exports remain encodeKeriCbor/decodeKeriCbor; no unused async alias.

## Wire and version rules

- `gvrsn` is attachment genus; `pvrsn` is body protocol. Explicit selection and
  enclosure scope control decoding. Only unselected legacy streams infer genus.
  Never retry malformed data under another major version.
- V1 tuple/signature counts are items; v2 counts are payload quadlets/triplets.
  Sized wrappers still count payload units. Selectors carry versions, not sizes.
- Hydrate native bodies once through Serder and known attachments through narrow
  primitives. `GroupTuple` represents semantic tuple recursion; `OpaqueSpan`
  preserves original bytes/domain without fabricated primitives.
- Serialization borrows complete trees. Each child uses one body-with-attachments
  enclosure; parent signatures and child evidence share the parent enclosure.
  Preserve child/leaf/item order while normalizing attachment categories.
- The frozen reference permits an initial attachment selector and small inner
  controller signature counters. Reject unsafe opaque genus conversion and inner
  overflow. Native body genus changes may require reconstruction and reject.
- Annotation validates once then renders original admitted wire, one entry per
  independently owned root. Walking a flattened child list loses enclosure scope.
  Opaque fallback must preserve text-domain raw for deannotation, including qb2.

## Primitive and Serder rules

- Generated codices from pinned upstream `71438328` own table meaning; helper sets derive
  from them. Table membership is not context admission. Historical v1 `-D/-J/-K`
  extensions are explicit; v2 nonce seals belong to structing, not every reader.
- Decode bounded headers and only the declared token, never the remaining stream.
  Bexter/Labeler use current single-hyphen escapes; Pather owns its separate path
  escape grammar. Cap byte-to-text/base64 spreads.
- `Matter`/`Indexer` are infrastructure bases; use semantic primitives when known.
  Variable-family promotion belongs in Matter. `NumberPrimitive.fromNum` owns
  compact numeric choices; v2 ordinals must not be forced into Seqner.
- Extend the shared `serder/native.ts` protocol/version/ilk matrix. Top-level
  native KERI uses fixed bodies; native map-shaped messages belong to ACDC/mapping.
  Route bytes use Pather. Reject unknown/reordered native seals instead of silently
  dropping them as the reference sometimes does.
- Structing uses frozen records plus descriptors, with semantic disclosure verbs
  in `disclosure.ts` and transport in Structor/Blinder/Mediar. Reuse hydrated
  primitives; do not serialize solely to parse again. Keep raw `SerderKERI.a`
  checks distinct from typed projections.
- `SealKind.d` remains Noncer-capable, including empty/salt values. TS storage
  retaining those roles is a documented correction to frozen Python's Diger cast.
  `FirstSeen` owns Number/Dater projections; `Dater.dts` is canonical ISO text.
  Auxiliary Verser tags such as OCSR do not widen native message protocols.
- SAID exclusions omit fields only from hashing after complete SAD size calculation;
  the returned SAD/raw retains them. Missing ignored fields reject.
- Tholder uses exact semantic thresholds and left-to-right clause slots. Its
  1,000-weight/65,536-character defaults are deployment limits, including qualified
  input (an intentional correction to frozen Python's limen bypass). Numeric
  thresholds retain their domain. Configure before admitting work.
- Accessor parity includes wrapper projections (`sner`, `tholder`, `ntholder`,
  `bner`, `berfers`), and legacy intive `bt` needs normalization. `SerderKERI.uuid`
  reads `u`, falling back to `n` only for v1.0 `vcp`; `nonce` is its alias, as in 714.
  `sner` reads raw string `s`; `snh` projects its canonical lowercase hex without
  leading zeros, so source-seal comparisons share the same ordinal domain.
  Remaining accessor
  audit stays an explicit plan obligation. Standalone saidive Mapper verification
  checks configured top-level claims in the selected format as well as wire
  round trips; makify replaces claims and verify:false explicitly skips checks.
  Compactor retains disclosure wire checks without flat-map claim verification;
  expanded disclosures are checked by their credential/aggregate owners.

## Owners and follow-ups

[State-machine contract](../../docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md),
[progressive contract](../../docs/design-docs/cesr/CESR_PROGRESSIVE_PARSER_CONTRACT.md),
[serialization](../../docs/design-docs/cesr/SERIALIZATION.md),
[table reference](../../docs/reference/cesr/CESR_CURRENT_REFERENCE_TABLES.md).
The [parser plan](../../docs/plans/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md) owns remaining
work. [ACDC learnings](PROJECT_LEARNINGS_ACDC.md) own disclosure semantics;
[exchange learnings](PROJECT_LEARNINGS_EXCHANGE.md) own runtime route admission.
Historical completeness decisions do not qualify a newer reference or runtime.
