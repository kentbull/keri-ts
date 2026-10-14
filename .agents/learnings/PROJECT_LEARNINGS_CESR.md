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
  account for all hydrated copies or heap overhead.
- `discardFrame` claims all descendants before awaiting cleanup and attempts each
  owner once, including shared credit on ordinary frames. A suspended generator
  also retains its output: credit returns after consumer disposal and generator
  resumption/closure. Sink finish transfers ownership; abort cannot revoke it.
- `Payload.open(signal)` must cooperate with cancellation. Generator return alone
  cannot interrupt blocked I/O. CESR root has no Effection import; its optional
  adapter owns one subscription, abort and joined cleanup.

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

- Generated codices from upstream `927c0cb8` own table meaning; helper sets derive
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
  `bner`, `berfers`), and legacy intive `bt` needs normalization. Remaining accessor
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
