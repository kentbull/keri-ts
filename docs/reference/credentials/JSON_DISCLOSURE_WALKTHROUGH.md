# JSON disclosure walkthrough

Companion to the [disclosure contract](../../design-docs/credentials/GRADUATED_DISCLOSURE.md).

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

For a specific disclosure, start from a fresh expanded mapping and request its
SAD paths directly:

```ts
const targeted = new Compactor({ mad: semantic, verify: false });
const paths = ["a/role/"];
targeted.compact(paths, "a");
const revealRoleMad = targeted.partials?.[paths.join("|")]?.mad;
```

`root` filters the section prefix; a trailing separator selects the entire node.
A scalar path retains its canonical ancestor maps while leaving unrelated
branches compact. Numeric components select fields by insertion order. Multiple
paths produce one combined partial. Empty or wholly out-of-section selections
produce no partial. A targeted call consumes the expanded input; another target
requires a fresh instance. `expand()` still provides the staged expansion path.
Exact internal label paths distinguish a literal dotted label from nested labels.

These operations construct canonical disclosure shapes. They do not authenticate
a credential or its issuer. IPEX must still compare the actual disclosed shape,
verify each node's proofs, and resolve the relevant workflow dependencies.

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

`Mapper` and `Compactor` support CESR, JSON, CBOR and MGPK. Select `kind`
explicitly when handling a non-native credential section: the serialization
format is part of its commitment. `parseCompactor()` remains the native CESR
hydration entry point.

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

The examples show semantic maps; `kind: "CESR"` preserves exact native map-body
bytes. Independent frozen-Python fixtures cover canonical maps and serialized
partials in all four formats. Frozen `927c0cb8` leaves `Compactor.raw` at its
pre-compaction snapshot; keri-ts keeps its existing current-map serialization
behavior. Canonical raw comparisons therefore use Python `Mapper(mad=c.mad)`,
while partial bytes come directly from the reference partials. This is an
explicit snapshot-behavior difference, not a claim of identical object state.

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
