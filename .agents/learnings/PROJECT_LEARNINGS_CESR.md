# CESR learnings

ADR-0012 now requires buffered complete-enclosure decoding. The progressive
engine/cursor/staging behavior below is transitional and must not be preserved as
a migration requirement. Remove parser-only lifetimes and keep real wire rules.

## Removal precedence (2026-10-15)

[ADR-0013](../../docs/adr/adr-0013-simple-component-flows.md) now requires removal
of all application budgeting and unsupported outbox, mailbox consumer-ack and
KRAM ready/snapshot durability. Any descriptions below of credits, reservations,
capacity admission or those delivery guarantees describe transitional code, not
instructions to preserve it. Remove those passages with their owning code rounds.
Preserve independent wire/crypto/transaction correctness and actual cleanup.
Only a minimal private socket constraint justified by production evidence may
remain; no parser, domain, storage, runtime or CLI accounting exception exists.

## Parser ownership

- Public CBOR exports are encodeKeriCbor/decodeKeriCbor only; body decode and
  syntax provenance are internal. Use parse directly; the unused toAsyncFrames alias is removed.
- `parse` is the sole progressive async engine; `parseBytes` is bounded async
  complete-input collection. There is no atomic/push compatibility engine.
- Chunk exhaustion is not frame completion. A body boundary, exact enclosure end
  or real EOF closes attachments. Complete-enclosure truncation is a boundary
  error; outside bytes cannot repair it.
- GenericGroup siblings may be delivered early. `CesrFrame.nests` are parent-owned
  evidence: finish the entire tree before yielding its parent. A failed later
  independent sibling cannot revoke earlier delivered owners.
- One input owner and immutable enclosure ends govern the shared cursor position.
  Parser tree/group/node/depth/ESSR/input limits, source-slot accounting and hidden
  frame-credit ownership are removed. PendingFrame and actual writer/owner sets
  retain unfinished payloads; complete roots transfer real owners at yield.
  Codec allocation estimation and DecodedBodyBudget are removed; decode supported
  wire without heap or workspace billing.
  MessagePack uses a private standard codec and disables shared key caching.
  Binary values, tags, maps, packed/record/bundle extensions and standard sharing
  retain native codec semantics; there is no speculative CBOR tag allowlist.
  Keep the pinned MessagePack 3.1.3 and cbor-x 1.6.0 while source-specific decoder
  behavior is relied on. Token-extent inspection runs only after native failure
  to establish syntax provenance, never to admit allocation. Opaque fallback
  requires intrinsic syntax failure; unexpected decoder errors propagate.
  CBOR resets actual message globals and restores map mode before returning.
  Its V8 collection regression proves successful/malformed backing is collectible
  and fails without reset. Generic CBOR returns unknown; consumers narrow shapes.
  Serdery owns one exact body copy, including suffix/shared/resizable input.
- `discardFrame` claims all descendants before awaiting cleanup and attempts each
  owner once. Ordinary frame records need no synthetic disposal credit. Sink finish transfers ownership; abort cannot revoke it.
  A writer disposes its finished sink owner if ESSR qualification fails before
  transfer, and propagates joined disposal failures alongside the primary error.
- `collectPayload(payload, signal)` uses Payload.size as exact framing, not a caller
  quota. Reject invalid numeric sizes and truncated/overlong readers; source cleanup
  and cancellation remain. MemoryPayloadSink and payloadSink factories take only
  cancellation, with no allocation ceiling. Fixed slabs are copy granularity.
- `Payload.open(signal)` must cooperate with cancellation. Generator return alone
  cannot interrupt blocked I/O. CESR root has no Effection import; its optional
  adapter owns one subscription, abort and joined cleanup. Its earlier next-scope
  resource joins the same close Promise, preserving late source failures through
  cancellation; only exact owned abort/already-reported failures are consumed.
  Discard, parser and source cleanup all run before distinct failures propagate.
- Host wire-refusal classification is opt-in at progressive decode only. Sources,
  custom staging, finalization, cancellation and cleanup preserve error provenance;
  a `ParserError` class alone never establishes a remote-input failure.
- Consumed-work scheduling belongs to the shared input owner, not each enclosure.
  After 64 KiB or 4,096 pull/consume operations, yield a host turn; empty producer
  chunks count. Abort clears the single checkpoint timer and retains source-error
  identity. This is local scheduling policy, not a wire limit or RSS guarantee.

Wire classification reports only intrinsic failures from that parse invocation.
Source, sink, decoder infrastructure and cleanup exceptions retain identity.

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
