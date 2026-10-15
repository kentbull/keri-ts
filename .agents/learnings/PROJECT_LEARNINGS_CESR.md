# CESR learnings

## Parser ownership

- `parse` is the sole progressive async engine; `parseBytes` is bounded async
  complete-input collection. There is no atomic/push compatibility engine.
- Chunk exhaustion is not frame completion. A body boundary, exact enclosure end
  or real EOF closes attachments. Complete-enclosure truncation is a boundary
  error; outside bytes cannot repair it.
- GenericGroup siblings may be delivered early. `CesrFrame.nests` are parent-owned
  evidence: finish the entire tree before yielding its parent. A failed later
  independent sibling cannot revoke earlier delivered owners.
- A shared cursor bounds consumption and input backing. Tree credits cover
  ordinary bytes/leaves, decoded ESSR/items, nodes and depth. No full raw envelope
  or per-Texter manifest is retained. Optional shared ordinary-wire and finite ESSR-stage reservations
  belong to delivered roots, never independently to nested children. They do not
  account for all hydrated copies or heap overhead. Progressive JSON/MGPK/CBOR separately
  admit lexical/token logical decoded/work charges before codec allocation, retaining
  them with root credit. CBOR-A covers base tokens/standard views and records; CBOR-B
  exhaustive arithmetic/share/extension accounting is deferred. B2 guards actual JS-only tag allocators;
  record IDs and 6/14/15 remain bounded Tags with definitions blocked/no private tables.
  cbor2 6.1.4 unknown tags are not mandatory JS expansion parity. CBOR-B1 resets configured message globals before
  helper return; injected tables/handlers, native residency and encoder caches remain open. Wrapped Matter, native, standalone
  verification and store/cache allocation boundaries remain open. Native syntax owns JSON
  semantics; MGPK uses private standard extensions and disables shared key caching.
  Pin the audited MessagePack 3.1.3 and cbor-x 1.6.0 versions exactly in source
  and emitted packages while decoder/reset assumptions depend on those implementations.
  Declaration preflight, codec workspace policy and intrinsic syntax provenance are
  separate responsibilities. MessagePack workspace uses an 8 KiB fixed allowance,
  256 bytes per nonempty container/extension and one raw copy, not private field/pool counts.
  CBOR uses a 4 KiB fixed workspace allowance and one raw copy; actual global reset
  and allocating-extension preflight remain required. Tight policies may refuse earlier.
  The body parser consults one codec syntax contract;
  only locally created intrinsic refusals permit opaque fallback for admitted codecs.
  Generic CBOR decode returns unknown; consumers validate the shape they need.
  Admitted map decoders retain schema-defined keys and extension values without
  pretending to validate named protocol fields owned by Serder.
- `discardFrame` claims all descendants before awaiting cleanup and attempts each
  owner once, including shared credit on ordinary frames. A suspended generator
  also retains its output: credit returns after consumer disposal and generator
  resumption/closure. Sink finish transfers ownership; abort cannot revoke it.
  A writer disposes its finished sink owner if ESSR qualification fails before
  transfer, and propagates joined disposal failures alongside the primary error.
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

Tree admission observers report only errors created by that parse invocation.
Reserve, source, sink and observer exceptions retain identity; preserve their
external provenance when intrinsic wire classification is enabled.

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
