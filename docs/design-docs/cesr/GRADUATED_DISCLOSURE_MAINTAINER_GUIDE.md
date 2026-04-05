# Graduated Disclosure Maintainer Guide

## Purpose

This guide is the active maintainer-oriented explanation of graduated disclosure
in `keri-ts`.

Read this if you need to understand:

- what problem the graduated-disclosure code is solving
- why there are several different disclosure mechanisms
- how `structing.ts`, `disclosure.ts`, counted-group wrappers, and map/list
  primitives fit together
- how the TypeScript architecture corresponds to, and intentionally differs
  from, KERIpy

Related design record:

- `docs/adr/adr-0007-graduated-disclosure-workflow-boundaries.md`

## The underlying problem

Graduated disclosure is about preserving cryptographic commitment integrity
while allowing different amounts of information to be revealed over time.

The same logical fact may need to exist in multiple forms:

1. semantic form for application logic
2. compact or blinded form for commitment and transport
3. partially re-expanded form for disclosure
4. fully expanded form for inspection or downstream processing

The hard part is not just serialization. The hard part is ensuring that every
revealed or compacted form still verifies against the same commitment anchor.

In KERIpy, Sam Smith spread that model across:

- `structing.py` for fixed-field values and fixed-field commitment helpers
- `mapping.py` for map/list graduated-disclosure mechanics
- tests that demonstrate the intended progression from compact to disclosed

`keri-ts` keeps the same substance, but separates the roles more explicitly.

## Three disclosure mechanisms

Do not collapse these into one mental bucket.

### 1. Fixed-field blinded disclosure

This is the `BlindState` / `BoundState` / `TypeMedia` path.

Use this when the disclosed thing is a small fixed-field record rather than a
general nested map or a list.

Examples:

- blinded transaction state
- bound blinded transaction state
- blinded typed media payload metadata/value pairs

Ownership in `keri-ts`:

- `packages/cesr/src/primitives/structing.ts`
  - defines the fixed-field record shapes and conversions
- `packages/cesr/src/primitives/disclosure.ts`
  - defines blind/unblind/commit workflow verbs over those records
- `packages/cesr/src/primitives/blinder.ts`
  - counted-group transport wrapper for blind/bound state payload groups
- `packages/cesr/src/primitives/mediar.ts`
  - counted-group transport wrapper for typed-media payload groups

### 2. Hierarchical graduated disclosure

This is the `Mapper` / `Compactor` path.

Use this when the disclosed thing is a nested field-map tree where submaps can
be compacted to their SAIDs and later re-expanded branch by branch.

Example:

- an ACDC section where nested submaps are progressively revealed while the
  top-level commitment stays stable

Ownership in `keri-ts`:

- `packages/cesr/src/primitives/mapper.ts`
- `packages/cesr/src/primitives/compactor.ts`

### 3. List/selective disclosure

This is the `Aggor` path.

Use this when the disclosed thing is a list whose aggregate commitment is stored
in slot zero and later elements may remain compact or be selectively revealed.

Example:

- a list of disclosable map elements where some elements remain compact SAIDs
  and selected elements are expanded

Ownership in `keri-ts`:

- `packages/cesr/src/primitives/aggor.ts`

## Representation ladder

The same committed value may move through four important representations.

### 1. Semantic record

This is the application-friendly form with real CESR primitive instances.

Example:

`BlindState = { d: Noncer, u: Noncer, td: Noncer, ts: Labeler }`

This is the form used for semantic comparisons and workflow logic.

### 2. Crew / SAD object

This is the string-projected object form.

`crew` means:

- same field names
- values converted to the string form specified by the field cast

Examples:

- `NumberPrimitive` projects through `.numh`
- `Noncer` projects through `.nonce`
- `Labeler` projects through `.text`
- other primitives default to `.qb64`

In `keri-ts`, `toCrew()` and `toSad()` are the descriptor-level projection
helpers for this layer.

### 3. CESR tuple body

This is the concatenated CESR primitive serialization of the record fields in
field order.

This layer matters for commitment computation on fixed-field disclosure records.
The commitment digest is computed over the primitive tuple body with a dummied
`d` field, not over the crew/SAD strings.

That distinction is essential because some crew projections differ from the
primitive canonical `qb64` field serialization.

### 4. Counted-group transport

This is the counter-framed attachment group on the wire.

Examples:

- `Blinder`
- `Mediar`
- `Sealer`

These wrappers own transport framing. They do not own the semantic meaning of
the fields they carry.

## Module ownership in `keri-ts`

### `structing.ts`

Role:

- fixed-field schema definitions
- field cast metadata
- crew/SAD conversion
- tuple serialization
- clan/cast/coden registries

This module owns nouns and representation conversions.

It does not own blind/unblind workflow.

### `disclosure.ts`

Role:

- deterministic disclosure UUID derivation
- fixed-field commitment recomputation
- helper workflows for building blinded/bound/media records
- reverse search helpers for reconstructing candidate disclosures

This module owns verbs over fixed-field disclosure records.

### `blinder.ts` and `mediar.ts`

Role:

- counted-group parsing and framing only

These are transport wrappers. They are not the semantic workflow owners even
though KERIpy bundles more behavior into classes with similar names.

### `mapper.ts`, `compactor.ts`, and `aggor.ts`

Role:

- general map/list disclosure semantics

These modules handle disclosure of arbitrary nested maps and aggregate lists.
They are not just “another way to blind a fixed record.”

## KERIpy correlation map

Use this as the fast translation layer when you are comparing `keri-ts` to
KERIpy source.

### Fixed-field schema layer

- `structing.ts` fixed-field descriptors correspond to the named fixed-field
  values in `keri.core.structing`
- `BlindState`, `BoundState`, and `TypeMedia` are the TypeScript plain-record
  correlate of KERIpy's named fixed-field data
- clan/cast/coden registries mirror KERIpy `ClanDom`, `CastDom`, `ClanToCodens`,
  and `CodenToClans`

### Fixed-field workflow layer

- `makeBlindUuid(...)`
  - KERIpy correlate: `Blinder.makeUUID(...)`
- `makeBlindState(...)`
  - KERIpy correlate: `Blinder.blind(..., bound=False)`
- `makeBoundState(...)`
  - KERIpy correlate: `Blinder.blind(..., bound=True)`
- `unblindBlindState(...)`
  - KERIpy correlate: `Blinder.unblind(..., bound=False)`
- `unblindBoundState(...)`
  - KERIpy correlate: `Blinder.unblind(..., bound=True)`
- `commitBlindState(...)` / `commitBoundState(...)` / `commitTypeMedia(...)`
  - KERIpy correlate: the saidive / `makify=True` commitment behavior KERIpy
    gets through richer `Structor` descendants
- `makeTypeMedia(...)`
  - KERIpy correlate: typed-media construction plus `makify=True` behavior that
    KERIpy expresses through `Mediar` / `Structor`, not a single dedicated
    public helper name

### Counted-group transport layer

- `Structor`
  - KERIpy correlate: `Structor`
- `Sealer`
  - KERIpy correlate: `Sealer`
- `Blinder`
  - KERIpy correlate: the transport/enclosure half of KERIpy `Blinder`
- `Mediar`
  - KERIpy correlate: the transport/enclosure half of KERIpy `Mediar`

### Map/list disclosure layer

- `Mapper`
  - KERIpy correlate: the native-map semantics spread across `mapping.py`
- `Compactor`
  - KERIpy correlate: `Compactor`
- `Aggor`
  - KERIpy correlate: `Aggor`

## Why `crew` exists

`crew` is easy to misunderstand if you come from normal JSON serialization.

`crew` is not:

- the same thing as the semantic record
- the same thing as the wire tuple bytes
- just “turn everything into qb64”

`crew` is:

- the object-shaped string projection of the record
- where each field uses the representation specified by `Castage.ipn`

That is why `SealEvent.s` becomes `numh` in crew/SAD form even though the
underlying record field is a real `NumberPrimitive`.

## Why `Noncer` appears in digest-like slots

`BlindState.d`, `BlindState.td`, `BoundState.d`, `BoundState.td`,
`BoundState.bd`, and `TypeMedia.d` look digest-like, but they are modeled as
`Noncer`, not `Diger`.

Why:

- KERIpy allows these positions to be empty placeholders during the build/commit
  workflow
- `Noncer` covers the digest code space plus empty-placeholder cases
- `Diger` would be too narrow because it cannot represent the empty pre-commit
  placeholder state

So in these records, “digest-like” really means “digest-capable,
placeholder-capable CESR material.”

## Why fixed-field commitments use tuple bytes, not SAD strings

For fixed-field disclosure records, commitment recomputation works like this:

1. start from the semantic record
2. serialize the tuple fields in order using their primitive `qb64`
3. replace `d` with a dummy string of the right width
4. digest those bytes
5. rehydrate the record with the computed `d`

This is intentionally not the same as hashing the crew/SAD projection.

Why:

- crew fields can use alternate projections like `.numh`, `.nonce`, or `.text`
- those projections are for SAD/object representation, not for the fixed-field
  commitment algorithm
- hashing the wrong representation breaks KERIpy parity

This is one of the most important invariants in the whole disclosure surface.

## Why `SerderKERI.a` and `SerderKERI.seals` stay raw

`SerderKERI` follows a raw-first boundary rule:

- `a` is the raw SAD field
- `seals` is the raw list projection when `a` is a list
- `sealRecords` is the explicit typed semantic projection
- `eventSeals` is the narrowed semantic projection for anchor/delegation logic

The point is to avoid pretending every `a` payload in KERI is a typed seal
record family. The raw field stays raw until a caller explicitly asks for the
semantic projection.

## Invariants and failure conditions

These are the rules most likely to get broken by a well-intentioned refactor.

### Invariant 1: fixed-field commitments use tuple primitive bytes

Do not compute `BlindState` / `BoundState` / `TypeMedia` commitments from
crew/SAD strings.

Failure mode:

- the digest changes
- KERIpy parity breaks
- placeholder-capable fields stop round-tripping correctly

### Invariant 2: placeholder-capable fields must stay placeholder-capable

Digest-like fixed-field disclosure slots remain `Noncer`, not `Diger`.

Failure mode:

- empty pre-commit values can no longer be represented truthfully
- blind/unblind search no longer matches KERIpy behavior

### Invariant 3: raw `a` stays raw until explicitly projected

Do not eagerly type `SerderKERI.a` or `SerderKERI.seals`.

Failure mode:

- non-seal `a` payloads get misinterpreted
- raw message fidelity is lost
- the serder boundary starts doing semantic work it does not own

### Invariant 4: `unblind*` is search, not decryption

The unblind helpers verify candidate disclosures by recomputing commitments.

Failure mode:

- maintainers invent a fake “decrypt” mental model
- callers expect hidden material to be recoverable without a candidate search

### Invariant 5: transport wrappers are not workflow owners

`Blinder` and `Mediar` transport grouped payloads. They do not own the
blind/unblind/commit algorithms.

Failure mode:

- schema, workflow, and transport start collapsing back into one abstraction
- future ACDC work becomes harder to place cleanly

## Worked example: `BlindState`

### Semantic record

The semantic form is a fixed record:

- `d`: blinded commitment
- `u`: deterministic disclosure UUID
- `td`: associated ACDC SAID or placeholder
- `ts`: state string such as `issued` or `revoked`

### Build flow

`makeBlindState(...)` does this:

1. resolve or derive `u` via `makeBlindUuid(...)`
2. create a placeholder record with `d=""`
3. recompute `d` from the tuple-body serialization with dummied `d`
4. return the rehydrated committed record

### Unblind flow

`unblindBlindState(...)` does not decrypt anything.

It searches candidate combinations:

- given or placeholder `acdc`
- each provided state plus the empty placeholder state

For each candidate it recomputes the commitment and compares the resulting
`d.nonce` to the target `said`.

If one matches, that candidate is the verified disclosure.

## Worked example: `BoundState`

`BoundState` is `BlindState` plus:

- `bn`: issuee key-state sequence number
- `bd`: issuee key-state event SAID

Those extra fields cross-anchor the issuee’s key state to the issuer’s blinded
state update.

This is why `BoundState` is not just “BlindState with extra metadata.” The extra
pair changes the commitment meaning by binding the issuee state at the time of
update.

## Worked example: `TypeMedia`

`TypeMedia` carries:

- `d`: media commitment
- `u`: disclosure UUID
- `mt`: media type
- `mv`: media value

This is the fixed-field media analogue of the blind-state flow:

- semantic record in `structing.ts`
- commit helper in `disclosure.ts`
- counted-group transport in `mediar.ts`

## Worked example: hierarchical disclosure with `Compactor`

Suppose a nested map has:

- a top-level `d`
- a nested child map `a` with its own `d`

`Compactor` can:

1. trace saidive leaves
2. compute the child-map SAID
3. replace the child map with that SAID
4. recompute the top-level SAID over the compacted branch
5. later re-expand selected branches into partial-disclosure variants

This is graduated disclosure by branch compaction and re-expansion, not by
blind-state placeholder search.

## Worked example: selective disclosure with `Aggor`

For an aggregate list:

- slot zero is the aggregate identifier (`agid`)
- later elements may be compact SAIDs or fully disclosed maps

`Aggor.disclose([indices])` reveals selected map elements while preserving the
same aggregate commitment in slot zero.

This is selective list disclosure, not fixed-field blinded disclosure and not
hierarchical branch compaction.

## Common confusions

### “Is `Blinder` the workflow owner?”

No.

In `keri-ts`, `Blinder` is the counted-group wrapper. The fixed-field workflow
verbs live in `disclosure.ts`.

### “Why not just put everything on classes like KERIpy?”

Because TypeScript benefits from separating:

- record schemas
- workflow verbs
- transport wrappers

KERIpy bundles more of those roles together because richer runtime classes and
keyword-heavy constructors are more idiomatic there.

### “Is `crew` the same as the tuple serialization?”

No.

`crew` is the object-shaped string projection. Tuple serialization is the
ordered primitive concatenation.

### “Why do raw `a` and typed seal records both exist?”

Because raw message fidelity and semantic projection are different jobs.
`SerderKERI` preserves both on purpose.

## How to extend this safely

When adding new graduated-disclosure features, place them by representation
ownership, not by convenience.

### Add to `structing.ts` when

- you are defining a new fixed-field semantic record
- you are adding cast metadata
- you are adding crew/SAD conversion or tuple serialization for a fixed-field
  record

### Add to `disclosure.ts` when

- you are adding a new fixed-field blind/unblind/commit verb
- you are adding deterministic UUID derivation logic
- you are adding candidate-search helpers over fixed-field records

### Add to `structor.ts`, `blinder.ts`, or `mediar.ts` when

- you are changing counted-group framing
- you are changing parser/group reconstruction for enclosed transport payloads
- you are not changing the semantic meaning of the carried fixed-field record

### Add to `mapper.ts`, `compactor.ts`, or `aggor.ts` when

- you are changing disclosure for nested maps or aggregate lists
- the disclosed thing is not a small fixed-field record

### Add typed serder projections only when a real caller needs them

Keep the raw-first boundary unless a concrete semantic use site exists.

## Reading order for maintainers

If you are new to this area, read in this order:

1. this guide
2. `packages/cesr/src/primitives/structing.ts`
3. `packages/cesr/src/primitives/disclosure.ts`
4. `packages/cesr/src/primitives/blinder.ts`
5. `packages/cesr/src/primitives/mediar.ts`
6. `packages/cesr/src/primitives/mapper.ts`
7. `packages/cesr/src/primitives/compactor.ts`
8. `packages/cesr/src/primitives/aggor.ts`
9. `packages/cesr/src/serder/serder.ts`
10. the unit tests for each of those modules

## Appendix A: Practical JSON-first example over three fields

This appendix is intentionally simplified.

It starts from ordinary JSON-shaped data because that is the easiest place to
build the right mental model before switching to CESR-native map bodies or
counted attachment groups.

### Scenario

Suppose we want to disclose three facts about a subject over time:

- `name`
- `role`
- `region`

We want all three facts to stay tied to one stable commitment, but we do not
want to reveal all three at once.

### Step 1: start from the semantic map

In JSON-primary form, a maintainable mental model is:

```json
{
  "d": "",
  "name": {
    "d": "",
    "v": "Ada"
  },
  "role": {
    "d": "",
    "v": "Maintainer"
  },
  "region": {
    "d": "",
    "v": "US"
  }
}
```

Why this shape?

- the top-level map has its own `d`
- each discloseable branch has its own `d`
- each branch can therefore be compacted to its SAID and later re-expanded

This is the right `Compactor` mental model. If you keep the three fields as
plain scalars with no child-map SAIDs, there is nothing branch-shaped to compact
or reveal progressively.

Practical `keri-ts` callout:

```ts
const semantic = {
  d: "",
  name: { d: "", v: "Ada" },
  role: { d: "", v: "Maintainer" },
  region: { d: "", v: "US" },
};

const compactor = new Compactor({
  mad: semantic,
  saidive: true,
  verify: false,
});
```

Why `Compactor` and not just `Mapper.fromSad(...)`?

- `Mapper.fromSad(...)` can saidify one map
- `Compactor` is the class that understands nested leaf discovery, branch
  compaction, and staged re-expansion

### Step 1a: compute commitments while the map is still expanded

The first practically useful operation is:

```ts
const leafPaths = compactor.trace(true);
```

Conceptually, `leafPaths` is:

```ts
[".name", ".role", ".region"];
```

What `trace(true)` does for this example:

- discovers each discloseable leaf map
- uses `Mapper` logic internally to compute the child-map SAIDs
- updates the top-level `d` over the newly saidified structure

Useful inspection points:

```ts
compactor.leaves[".role"].said;
compactor.mad;
```

At this moment the map is still expanded, but each child branch now carries a
real commitment and the top-level map has been recomputed to match.

### Step 2: compact the branches

After saidification and compaction, the map becomes conceptually:

```json
{
  "d": "E_top_commitment",
  "name": "E_name_commitment",
  "role": "E_role_commitment",
  "region": "E_region_commitment"
}
```

Now the top-level map still commits to all three facts, but the facts themselves
are hidden behind the child commitments.

This is the "most compact" branch form.

Practical `keri-ts` callout:

```ts
compactor.compact();

const compactMad = compactor.mad;
const compactRole = compactor.getTail(".role");
```

What changed:

- `compact()` repeatedly calls `trace(true)` and replaces each leaf map with its
  SAID
- `compactor.mad` is now the compact semantic view
- `compactor.getTail(".role")` is now a compact commitment string, not a child
  map object

This is the clearest one-call API for “take the semantic tree to its most
compact committed form.”

### Step 3: reveal one field

If we only want to disclose `role`, a partial disclosure can look like:

```json
{
  "d": "E_top_commitment",
  "name": "E_name_commitment",
  "role": {
    "d": "E_role_commitment",
    "v": "Maintainer"
  },
  "region": "E_region_commitment"
}
```

What stays true:

- the top-level `d` is still the same
- the hidden branches are still represented by their compact commitments
- the revealed branch now shows its readable map form

This is hierarchical graduated disclosure by selective branch expansion.

Practical `keri-ts` callout:

```ts
compactor.expand();

const staged = Object.values(compactor.partials ?? {});
const revealRole = staged.find((partial) =>
  typeof partial.getTail(".role") === "object"
  && typeof partial.getTail(".name") === "string"
  && typeof partial.getTail(".region") === "string"
);

const revealRoleMad = revealRole?.mad;
```

Important realism note:

- today `Compactor` does not expose a polished `reveal([".role"])` helper
- instead, `expand()` precomputes staged partial variants in `partials`
- callers select the staged variant whose revealed-versus-compact branch pattern
  matches the disclosure they want

So the incremental “uncompaction” surface in current `keri-ts` is:

- `compact()` to reach the most compact state
- `expand()` to build staged re-expansions
- `partials` plus `getTail(path)` to choose the right variant

### Step 4: reveal two fields

Later we could disclose both `name` and `role`:

```json
{
  "d": "E_top_commitment",
  "name": {
    "d": "E_name_commitment",
    "v": "Ada"
  },
  "role": {
    "d": "E_role_commitment",
    "v": "Maintainer"
  },
  "region": "E_region_commitment"
}
```

The commitment story is unchanged. Only the amount of expansion changed.

Practical `keri-ts` callout:

```ts
const revealNameAndRole = staged.find((partial) =>
  typeof partial.getTail(".name") === "object"
  && typeof partial.getTail(".role") === "object"
  && typeof partial.getTail(".region") === "string"
);

const revealNameAndRoleMad = revealNameAndRole?.mad;
```

This is still the output of the same `expand()` call. We are simply selecting a
later staged variant where two branches have been re-expanded.

### Step 5: reveal all three fields

Full disclosure simply re-expands the last hidden branch:

```json
{
  "d": "E_top_commitment",
  "name": {
    "d": "E_name_commitment",
    "v": "Ada"
  },
  "role": {
    "d": "E_role_commitment",
    "v": "Maintainer"
  },
  "region": {
    "d": "E_region_commitment",
    "v": "US"
  }
}
```

Practical `keri-ts` callout:

```ts
const fullyExpanded = staged.find((partial) =>
  typeof partial.getTail(".name") === "object"
  && typeof partial.getTail(".role") === "object"
  && typeof partial.getTail(".region") === "object"
);

const fullyExpandedMad = fullyExpanded?.mad;
```

That final staged variant is the fully readable disclosure form while preserving
the same commitment lineage established by the compact state.

### One-screen summary of the actual API flow

```ts
const compactor = new Compactor({
  mad: semantic,
  saidive: true,
  verify: false,
});

compactor.trace(true); // compute child-map and top-level commitments
compactor.compact(); // replace leaf maps with their SAIDs
compactor.expand(); // precompute staged partial re-expansions

const staged = Object.values(compactor.partials ?? {});
```

If you want one sentence to remember:

- `trace(true)` computes commitments
- `compact()` contracts branches
- `expand()` materializes the staircase of readable disclosure variants

### What module owns this example?

This example belongs to the map/tree disclosure mechanism:

- semantic map ownership: `Mapper`
- compact / expand workflow: `Compactor`

It is not the fixed-field `BlindState` / `BoundState` / `TypeMedia` path.

### CESR native callout

In live `keri-ts`, `Mapper` and `Compactor` do not operate on JSON text bytes.
They operate on CESR-native map bodies and their semantic projections.

So the actual wire/body representation is CESR-native, not a JSON blob.

Practical `keri-ts` callout:

```ts
const nativeCompactor = new Compactor({
  mad: semantic,
  saidive: true,
  kind: "CESR",
  verify: false,
});

const qb64 = nativeCompactor.qb64;
const reparsed = parseCompactor(
  new TextEncoder().encode(qb64),
  { major: 2, minor: 0 },
  "txt",
);
```

So the JSON example in this appendix is teaching the semantic shape, while the
live CESR APIs still preserve exact native map-body bytes.

This appendix is still useful because the JSON-shaped semantic view is the
easiest way to understand:

- what stays committed
- what gets compacted
- what gets re-expanded

### CESR attachment callout

Now contrast that with fixed-field attachment disclosure.

If the discloseable thing is not a general map tree but a small fixed-field
record such as:

```json
{
  "d": "E_commitment",
  "u": "A_disclosure_uuid",
  "td": "E_acdc_said",
  "ts": "issued"
}
```

then the owners change:

- semantic record + conversion: `structing.ts`
- blind/unblind/commit workflow: `disclosure.ts`
- counted attachment transport: `Blinder` or `Mediar`

That is not branch expansion. That is fixed-field blinded disclosure.

Practical `keri-ts` callout:

```ts
const blind = makeBlindState({
  acdc: "E_acdc_said",
  state: "issued",
});
```

That one call already means something different from the `Compactor` flow:

- it builds one fixed-field record
- it commits one fixed-field tuple
- it does not traverse or stage a nested tree

### Practical rule of thumb

Use this checklist:

- if you are progressively revealing branches of a nested map, think `Mapper` /
  `Compactor`
- if you are progressively revealing selected elements of a committed list,
  think `Aggor`
- if you are progressively revealing a small fixed-field tuple with placeholder-
  capable commitment fields, think `structing.ts` + `disclosure.ts`
