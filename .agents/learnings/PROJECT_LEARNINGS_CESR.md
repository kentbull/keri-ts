# PROJECT_LEARNINGS_CESR

## Purpose

Persistent CESR parser, primitive, and serder memory for `keri-ts`.

## Current State

SAID exclusion is a hash-input rule: size the complete versioned SAD first,
then omit ignored fields only from the digest serialization. Keep ignored fields
in the returned SAD/raw. Frozen `927c0cb8` literals cover JSON, CBOR, and MGPK for
both protocol versions, with and without exclusions. A missing ignored field
rejects instead of silently changing the commitment contract.

`Tholder.maxWeights` (1,000) and `maxSithLength` (65,536) are process-wide
deployment settings, not protocol maxima; configure them before admitting work.
Weighted input counts every term, including nested outer weights, before fraction
conversion. JSON length includes whitespace. Numeric thresholds keep their full
domain. Unlike frozen Python927's `limen` bypass, the TS weight cap also applies
to qualified text/binary input; deployments can raise both limits together.

The CESR package is framework-neutral: progressive parsing uses async iterables
and AbortSignal. The optional `cesr-ts/effection` entrypoint supplies FrameChannel
and toEffectionFrames with scope-owned cancellation and joined cleanup; importing
the package root does not load Effection. KERI and Tufa embrace Operation scopes
and use this supplementary adapter at their parsing boundary.

1. The historical parser completeness `GO` predates the count-unit correction
   and genus-context correction; current parity claims must name
   their tested reference and version combinations.
2. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md` is the
   normative lifecycle contract. Parser behavior changes should stay mapped to
   that contract and its tests.
3. One progressive async engine owns parsing in `parser/progressive.ts`.
   `parser/complete.ts` provides async finite `parseBytes`; `parser/body.ts` owns
   finite body hydration and frame-counter recognition. The old atomic walker,
   push API, event wrappers, and atomic ESSR adapter have been removed.
   KERI and Tufa consume sources through optional Effection channels. Current-main
   parity, shared runtime reservations, and final benchmark qualification remain
   explicit follow-ons; their target obligations are not yet implementation claims.
   `parser/cursor.ts` prepares that input boundary: segmented storage drops consumed
   buffers, scope ends limit all reads, and accepted producer backing buffers count
   toward resource policy. Demand and cancellation belong to the shared cursor;
   generator locals now own nested parse progress in `parser/progressive.ts`.
   Progressive body hydration and frame-counter recognition live in `parser/body.ts`;
   that engine no longer calls the atomic frame walker. CESR tests exercise the
   async engine directly, including terminal rejection and independent genus vectors.
   The async `parse()` entrypoint and frame adapters yield complete GenericGroup
   children early; they retain Serder/ordinary leaf hydration under cursor and `maxFrameBytes`
   limits. Progressive ESSR stores one owned canonical Texter wire sequence with
   a reopenable decoded view, shared parent-tree byte/item limits, and awaited sink writes.
   Serialization exposes non-owning `framePayload`/`attachmentPayload` views and
   shared `essrChunks` output. Normalize known leaves to one output genus/domain per message:
   current KERIpy allows one initial attachment GVC, not selectors between leaves
   or nested attachment wrappers. Preserve small inner transferable-signature
   counters; reject unsafe opaque genus changes and inner-counter overflow.
   Internal one-frame candidates remain parser-owned until the public yield;
   malformed enclosures abort all undelivered stages. Runtime consumers use the progressive engine; shared admission and final
   qualification remain, so parser measurements alone are not an end-to-end memory claim.
   `CesrFrame` carries the hydrated body, attachments, resolved genus, optional owned
   ESSR, and parent-owned `nests`. Enclosed child messages retain their own evidence;
   GenericGroup siblings remain independently progressive. Shared tree credit caps
   ordinary bytes/leaves, decoded ESSR/items, and 256 message nodes; cursor depth
   remains 64. `discardFrame` claims all descendant owners before awaited cleanup,
   preventing duplicate releases from overlapping consumer scopes. A failed later
   child or finish releases the entire undelivered tree. Serialization preserves owned trees through reopenable payload views. Each child
   has a body-with-attachments enclosure and a scope-local genus selector when
   needed; non-native child bodies use Texters. Default output retains each node's
   genus, explicit output genus applies across the tree, and all ESSR stays borrowed.
   Ordinary leaves, child order, and ESSR item order survive category normalization.
   Finite annotation preserves original wire within root-owned entries. KERI
   normalization admits v2 `/fwd` trees through bounded exchange storage and
   replay; other routes and HTTP inspection retain their consumer guards. Parsing returns frames directly and rejects on errors. Recursive
   attachment tuples are `GroupTuple`, guarded by `isGroupTuple`.
   Opaque wire payloads are one `OpaqueSpan` of original bytes plus domain, not
   arrays of fabricated primitives. Same-domain serialization preserves the bytes.
   `CesrDomain` names qb64/qb2 domains; `tokenSize` and `unitBytes` own byte widths.
   Parser genus context uses `gvrsn`/`streamGvrsn`; protocol metadata keeps `pvrsn`.
4. Chunk exhaustion never completes an open attachment set. A following body,
   complete frame/attachment enclosure, or source EOF does. Terminal partial
   attachments reject without yielding their pending frame. Earlier completed
   siblings stay delivered if a later body fails. Each parse invocation starts
   fresh; there is no reset, flush, framed cadence, or compatibility push API.
5. Attachment dispatch decodes only the selected genus version; unknown codes
   and primitive failures never trigger a cross-major retry. Malformed wrapper
   tails are errors; there is no strict/compat parser mode. Explicit genus selectors and
   legacy frame-start recognition remain separate from attachment dispatch.
   Malformed input throws and terminates the iterator; recovery has no separate
   diagnostic callback API. V1 signature/tuple counters count
   items; v2 payload counters count quadlets/triplets, including nested signature
   groups. Complete sized payloads with incomplete items are boundary errors, not
   transport shortages. Fixtures must encode payload lengths, not item counts.
   Direct handler maps select separate v1 item-count and v2 payload-exhaustion handlers;
   single-entry parsing and primitive rehydration remain shared. Known attachment
   roles hydrate narrow primitives at the CESR boundary. Ordinals use
   `NumberPrimitive`, accepting fixed-width `0A` and compact numeric codes in
   both genera. Table baseline 450ae1c used Seqner; live CLI interop baseline
   98b88cf uses Number. Do not mistake the old reader for the full wire surface.
   ESSR respects v1 item counts and v2 payload lengths while staging canonical
   wire without per-item arrays. KERI envelopes reuse hydrated Serders and primitives, validating
   roles at the public frame boundary. Structing views use existing Matter instances
   when their semantic class differs, never a qb64 round trip. Nested transferable signatures require the controller
   counter, matching the pinned reference (including its exclusion of big inner
   counters). Genus selectors decode both minor sextets and reject unsupported
   versions inside wrappers as well.
6. Counter parsing validates genus versions through codex registries before
   choosing an attachment handler from the v1/v2 maps. Stream genus is independent of protocol
   metadata: null selection permits legacy inference, explicit selectors persist,
   and enclosure context is authoritative for children. Version compatibility
   checks precede non-native opaque recovery. Selected counter probes never
   retry another major. Selector fixtures use `Counter.makeGVC`.
7. Frame starts dispatch directly after domain/counter recognition. Native bodies
   hydrate once through Serder; annotation owns token walking and label comments.
   Async annotation validates once with progressive finite parsing, then renders
   original admitted wire to preserve wrapper headers, scoped selectors, and ESSR
   ordering. Annotation emits one entry per independently delivered root, with
   descendant lines in that entry; child iterators follow ownership rather than
   a flattened body list. Each hydrated node must be consumed exactly once in
   its owning scope. Rendering hydrated frame attachments alone loses wire details.
   LabelCodex values may be routes or empty text, so native annotation only treats
   attribute-safe text as a candidate label; Serder remains validation authority.
   Annotation and replay benchmarks have explicit configurable finite-input budgets;
   streaming CLI validation releases delivered payloads before pulling another frame.
   There is no parser-native sidecar or advisory metadata agreement pass. A
   shortage inside a complete body payload is an immediate boundary error.
8. Binary serder cold-start support exists for JSON, MGPK, and CBOR. Local Deno
   source graphs must carry CESR-owned npm/import-map entries when they load
   local CESR source.
9. Table generation and verification read immutable KERIpy source at
   `927c0cb8794d7c84fc17143c67df64aab9deda6c`; runtime pins remain independent.
   V2 `-N`/`--N` mean nonce seals and Matter GramHead uses `b`. Retained historical
   v1 `-D`/`-J`/`-K` belong to explicit protocol extensions outside the current
   reference codex. Structing admits nonce seals; attachment dispatch and native
   event seal lists do not. The reference's native Serder registry omits them.
   See `CESR_CURRENT_REFERENCE_TABLES.md` for the audit and independent wire evidence.
   Generated KERIpy-parity codex objects such as `MtrDex`, `PreDex`, `DigDex`,
   `IdrDex`, `IdxSigDex`, and `TraitDex` are the primary authority. Helper sets
   in `primitives/codex.ts` are derived readability views.
10. Primitive text readers inspect bounded hard/soft headers before decoding only
    the declared token; never convert the remaining stream to a string. Byte-to-text
    and base64 conversion must cap argument spreads, preserve byte values, and
    report incomplete headers as shortages.
    Bexter and Labeler share current KERIpy's single-hyphen escape convention:
    escape leading `-`, and leading `A` only when length padding is ambiguous.
    Pather disables that convention because it owns path separators and its
    double-hyphen escape. Frozen `927c0cb8` literals and reverse Python probes cover
    both wire domains; big Bexter decoding uses byte buffers without expanded arrays.
    `Matter` and `Indexer` are low-level CESR bases. When semantics are known,
    construct the narrow primitive directly instead of returning the superclass.
11. The same codex-layer rule applies to non-cryptographic and singleton-ish
    primitives such as `Dater`, `Seqner`, `Ilker`, `Verser`, `Noncer`, and
    `Traitor`.
12. CESR-native serder behavior is organized around one shared support matrix in
    `packages/cesr/src/serder/native.ts`, keyed by protocol/version/ilk and
    field-family semantics. Extend that matrix rather than adding sidecar
    branches. Native event `a` lists now encode and project the frozen `927c0cb8`
    seven seal families with consecutive homogeneous runs and typed field roles;
    only `icp/rot/ixn/dip/drt` admit these lists. Mapper-valued `a` stays a mapper.
    Nonce/big seal counters remain outside the reference native registry. Unknown
    maps and reordered seal keys fail early: Python can silently discard them.
    `NumberPrimitive.fromNum` owns compact `M/R/N/S/T/U` automatic encoding
    for seal, Serder, and threshold projections;
    explicit `0H/0A` primitive decoding is unchanged.
13. Top-level native KERI messages are fixed-body only. Message-shaped native
    map bodies belong to ACDC or lower-level mapping surfaces and should be
    rejected at the KERI serder boundary.
14. Native route bytes are a `Pather` problem, not a `Labeler` problem; byte
    parity depends on real path semantics.
15. ACDC verification is explicitly two-track: the visible raw body must still
    round-trip from the visible SAD, but compactable top-level ACDC SAIDs must
    also verify against the most compact variant. Section identifiers remain
    label-aware (`$id`, `d`, `agid`).
16. `Mapper`, `Compactor`, and `Aggor` own semantic disclosure. `Aggor` is
    independent of counted transport wrappers and commits to its declared
    CESR/JSON/CBOR/MGPK framing. Generic list/map attachment projections live
    in `Serder.projectStructors().generic` as `Structor` values. Future ACDC
    work should extend semantic primitives instead of rebuilding section
    semantics inside generic serder helpers.
17. Long-tail KERI serder parity includes wrapper accessors, not just scalar
    projections: helpers such as `sner`, `tholder`, `ntholder`, `bner`, and the
    typed `berfers` surface are part of the real subtype contract.
18. Deprecated intive `bt` input is still part of the compatibility surface:
    `SerderKERI.bner` must normalize lowercase-hex text, `bigint`, and old
    JSON-number inputs the way KERIpy still does.
19. Weighted thresholds are now semantic CESR primitives through `Tholder`,
    including weighted/nested normalization, `limen`/`sith` projection, exact
    threshold sizing, left-to-right signer-slot consumption across clauses, and
    `satisfy(indices)` behavior.
20. Fixed-field `structing.py` values belong to CESR through
    `packages/cesr/src/primitives/structing.ts`: the right TypeScript mental
    model is plain frozen records plus companion helpers/registries, not a mini
    class hierarchy. Those descriptors now own raw-SAD guards/hydration
    (`isSad`, `fromSad`, `toSad`), `SerderKERI` keeps raw `a`/`seals` but adds
    explicit typed seal projections, and `packages/keri` runtime dispatch now
    consumes CESR structing records directly instead of local wrapper classes.
    Frozen `927c0cb8` casts `SealKind.d` as `Noncer` (qualified empty, salt, or
    digest); attachment hydration and TS tuple storage retain that role. Python's
    `kramTDCS` still casts `Diger`, so TS empty/salt storage readback is an explicit
    consistency repair, not a claim of Python database interoperability.
    `FirstSeen` owns `f: NumberPrimitive` / `dt: Dater` with hexadecimal/ISO crew
    projections; runtime dispatch uses this plain record. `Dater.dts` is canonical
    ISO text and replaces the old TS `iso8601` accessor.
21. `Verser` parity is slightly broader than the top-level message-protocol
    model: auxiliary four-char tags such as `OCSR` must remain accepted because
    KERIpy uses them in typed-digest seal families even though native message
    bodies still only speak `KERI|ACDC`.
22. KERIpy attachment parity belongs in `Counter` for generic CESR framing:
    `Counter.makeGVC(version)` emits the genus-version selector, and
    `Counter.enclose(...)` owns text/binary alignment checks, quadlet/triplet
    count derivation, and small-to-big counter promotion.

## Use This Doc For

1. Parser lifecycle, recovery, and bounded-substream rules.
2. Primitive/codex parity and semantic construction guidance.
3. Serder/native/ACDC compactification behavior.

## Key Docs

1. `docs/design-docs/cesr/CESR_PARSER_STATE_MACHINE_CONTRACT.md` (current behavior)
   and `CESR_PROGRESSIVE_PARSER_CONTRACT.md` (accepted target).
   `docs/design-docs/cesr/CESR_PROGRESSIVE_PARSER_PLAN.md` tracks execution;
   `docs/adr/adr-0012-progressive-nested-parser.md` records the replacement decision.
2. `docs/design-docs/cesr/CESR_ATOMIC_BOUNDED_PARSER_ARCHITECTURE.md`
3. `docs/archived-plan-docs/cesr/cesr-parser/CESR_PARSER_COMPLETENESS_DECISION_2026-03-01.md`
4. `docs/archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_WALKTHROUGH.md`
5. `docs/archived-plan-docs/cesr/cesr-primitives/CESR_PRIMITIVES_KERIPY_PARITY_MATRIX.md`
6. `docs/design-docs/keri/WEIGHTED_THRESHOLD_PARITY.md`

## Current Follow-Ups

`core/payload.ts` owns the filesystem-neutral payload contract: reopenable reads,
explicit limited collection, and bounded memory staging. Sink completion transfers
ownership; abort cannot revoke an already returned payload. KERI's file store owns
file promotion and disposal, independently of parser and crypto policy.

1. Execute the progressive parser plan with explicit checkpoint evidence. Keep
   current behavior accurate through the remaining follow-ons, preserve version/count/boundary
   regressions, and distinguish ESSR fragments from logical sealed messages.
2. Preserve parser boundary, partition, external-vector and lifecycle coverage
   under `packages/cesr/test/unit/parser`; serder and table tests have their own
   sibling owners. Test labels describe current behavior, not development phases.
   Shared fixture provenance remains independent of the tested runtime version.
3. Keep `packages/cesr/scripts/verify-tables.ts` green whenever parity work
   touches code tables or codex-family consumers.
4. Extend native and ACDC support only through the shared native matrix and the
   CESR-native semantic primitive layer.
5. Preserve maintainer-oriented docs and keep local-source Deno config handling
   aligned whenever CESR source is loaded across package boundaries.
6. Keep KERI tuple-storage aliases derived from `primitives/structing.ts` and do
   not recreate wrapper families or ad hoc raw-SAD seal parsing above that
   boundary.

## Milestone Rollup

### 2026-02-28 to 2026-03-02 - Parser Contract, Readability, And Formal Closure

- Published the canonical parser state-machine contract and aligned tests to it.
- Decomposed parser control flow into more reviewable collaborators and strategy
  seams.
- Closed the tracked P2 hardening breadth and recorded a formal completeness
  decision against the current KERIpy baseline.

### 2026-03-03 to 2026-03-16 - Primitive-First Parity, Docs, And Codex Closure

- Refreshed primitive semantics against KERIpy `main`, completed the
  per-primitive test migration, and closed key projection/serialization gaps.
- Added maintainers-first primitive walkthrough/parity docs.
- Made generated codex families the primary authority and demoted local helper
  sets to derived views, including singleton and trait-family migration.

### 2026-03-17 - Non-Native `Serder` Construction And Verification Landed

- Expanded `Serder` into a real makify/verify surface for JSON, CBOR, and MGPK
  KERI/ACDC bodies.
- Moved local KERI construction onto `SerderKERI` semantics instead of raw
  saidify helpers.

### 2026-03-17 - Native Serder And ACDC Compactification Converged

- Introduced the shared native support matrix for parser hydration, `Serdery`,
  and native inhale/exhale behavior.
- Tightened the top-level contract so native KERI message bodies are fully
  hydrated serders or parse errors, not metadata-only partial successes.
- Landed explicit ACDC compactification and section-identifier rules, and fixed
  native route-byte parity around real `Pather` semantics.

### 2026-03-27 to 2026-04-02 - Long-Tail Serder And Threshold Parity Closed

- Closed indexed-signature round-trip mid-pad behavior and deprecated intive
  `bt` normalization in `SerderKERI.bner`.
- Turned `Tholder` into the real semantic threshold primitive and widened
  serder/native handling so weighted `kt` / `nt` forms survive round-trip.

### 2026-04-04 - Fixed-Field Structing Values Moved Into CESR

- Added CESR-owned fixed-field structing records/descriptors for seal,
  blind-state, bound-state, and typed-media values, plus KERIpy-style
  clan/cast/coden registries.
- Preserved the existing counted-group wrapper ownership split:
  `Structor`/`Sealer`/`Blinder`/`Mediar` still own grouped serialization, while
  `structing.ts` now owns the named value layer inside those groups.
- Simplified that named value layer back toward KERIpy's actual shape: plain
  frozen records with companion helpers replaced the earlier
  inheritance/generic-heavy class design.
- Broadened `Verser` parity enough to accept KERIpy's auxiliary `OCSR` tag so
  typed-digest seal vectors no longer need a fake protocol workaround.
- Completed the next boundary step: the descriptors now own raw-SAD
  recognition/hydration, `SerderKERI` stays raw-SAD-first with explicit
  `sealRecords` / `eventSeals` projections, and the KERI runtime envelope uses
  CESR structing records directly while LMDB tuple aliases stay storage-only.

### 2026-04-04 - Disclosure Helpers Should Be Pure Functions Over Structing Records

- The durable KERIpy `Blinder` / `Mediar` substance is deterministic UUID
  derivation plus saidive commitment recomputation, not the wrapper classes.
- In `keri-ts`, keep that behavior as pure helpers over plain structing records,
  but house those verbs in `primitives/disclosure.ts`, not in
  `primitives/structing.ts`: `makeBlindUuid`, `commitBlindState`,
  `makeBlindState`, `unblindBlindState`, `commitBoundState`, `makeBoundState`,
  `unblindBoundState`, and `commitTypeMedia` / `makeTypeMedia`.
- Commitment recomputation must use the real primitive `qb64` tuple body with a
  dummied `d` field. Using crew/SAD strings changes the bytes for empty noncers,
  `Labeler.text`, and `Texter.text`, and therefore breaks KERIpy parity.
- Keep raw structural checks raw. `SerderKERI` should reject non-transferable
  inception seal payloads based on the raw `a` list being non-empty, even when
  the entries are malformed and would later fail typed seal projection.
- `blinder.ts` and `mediar.ts` stay transport-only counted-group wrappers. Do
  not hang semantic disclosure verbs on them just because KERIpy's richer
  `Blinder` class bundled both roles together.

### 2026-05-06 - Annotation Opaque Fallback Must Preserve Text-Domain Raw

- `annotate()` is part of the CESR round-trip surface: even fallback paths must
  emit the original text-domain frame bytes before the comment so `denot()` can
  reconstruct the input.
- For `NonNativeBodyGroup` bodies that cannot become a `Serder`, keep the full
  counter+payload span as `body.raw`; rendering the decoded `Texter/Matter.raw`
  leaks binary/null bytes into annotation and breaks text-domain parity.
- Interop parity for KERIpy `kli annotate` should compare structural labels and
  denotation, not exact prose comments, because KERIpy and tufa intentionally
  render different human-facing details.
