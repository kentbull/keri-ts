# ADR-0007: Graduated Disclosure Workflow Boundaries

- Status: Accepted
- Date: 2026-04-05
- Scope: `packages/cesr` fixed-field graduated disclosure architecture
- Related:
  - `packages/cesr/src/primitives/structing.ts`
  - `packages/cesr/src/primitives/disclosure.ts`
  - `packages/cesr/src/primitives/structor.ts`
  - `packages/cesr/src/primitives/blinder.ts`
  - `packages/cesr/src/primitives/mediar.ts`
  - `packages/cesr/src/primitives/mapper.ts`
  - `packages/cesr/src/primitives/compactor.ts`
  - `packages/cesr/src/primitives/aggor.ts`
  - `docs/design-docs/cesr/GRADUATED_DISCLOSURE_MAINTAINER_GUIDE.md`
  - `keripy/src/keri/core/structing.py`
  - `keripy/src/keri/core/mapping.py`

## Context

KERIpy's graduated-disclosure model is spread across two main files:

- `structing.py` for fixed-field named values plus blind/bound/media workflow
- `mapping.py` for hierarchical map disclosure and aggregate-list disclosure

That Python design is coherent in its own ecosystem because KERIpy leans on
richer classes that bundle:

- semantic data
- crew/SAD conversion
- tuple serialization
- counted-group enclosure
- saidive / makify commitment logic
- workflow verbs such as `blind(...)` and `unblind(...)`

During the `keri-ts` port, we had to choose how much of that bundling to keep.
Several bad options appeared:

1. put fixed-field workflow methods back onto `Blinder` and `Mediar`
2. keep the helpers in `structing.ts`, mixing record schema and workflow verbs
3. recreate richer KERIpy-style wrapper classes around every fixed-field value
4. separate fixed-field schema, workflow, and counted-group transport

The real problem being solved is not "model lots of seal classes." The problem
is preserving commitment integrity across multiple representations:

- semantic record
- crew/SAD object
- CESR tuple body
- counted-group transport

If those layers blur together, maintainers misread transport wrappers as the
owners of semantic workflow, or they compute disclosure commitments over the
wrong representation.

## Decision

`keri-ts` keeps fixed-field graduated-disclosure workflow verbs as standalone
exported functions in `disclosure.ts`.

Concretely:

- `structing.ts` owns fixed-field schema and representation conversions
- `disclosure.ts` owns workflow verbs such as:
  - `makeBlindUuid`
  - `makeBlindState`
  - `makeBoundState`
  - `makeTypeMedia`
  - `commitBlindState`
  - `commitBoundState`
  - `commitTypeMedia`
  - `unblindBlindState`
  - `unblindBoundState`
- `Blinder` and `Mediar` remain counted-group transport wrappers only
- `Mapper`, `Compactor`, and `Aggor` continue to own map/list disclosure

This is the authoritative boundary rule for future work.

## Rationale

### Why Not Put Workflow Methods On `Blinder` / `Mediar`?

Because in `keri-ts`, those classes are transport wrappers.

They know:

- which counter family a grouped payload belongs to
- how the enclosed tuple/list serializes as one counted group
- how to rehydrate that group after parsing

They do not own:

- the semantic meaning of `BlindState`, `BoundState`, or `TypeMedia`
- deterministic UUID derivation
- blind/unblind search
- commitment recomputation rules

Putting workflow methods on them would conflate transport ownership with
semantic workflow ownership.

### Why Not Leave The Helpers In `structing.ts`?

Because `structing.ts` is the schema module.

Its job is:

- plain record shapes
- field casts
- crew/SAD conversion
- tuple serialization
- clan/cast/coden registries

If workflow verbs stay there, the file becomes both noun layer and verb layer,
which weakens the representation-boundary model we intentionally introduced in
TypeScript.

### Why Not Recreate KERIpy's Richer Wrapper Classes?

Because that would push `keri-ts` toward a mini framework that fights the
language.

KERIpy idiom favors:

- richer objects
- keyword-argument constructors
- classmethods that bundle data creation and workflow
- one larger class carrying multiple kinds of responsibility

TypeScript idiom favors:

- plain records for nouns
- module functions for verbs
- explicit option interfaces
- smaller runtime objects
- composition over inheritance

The Python approach is not wrong. It is simply optimized for different language
affordances and different maintainability tradeoffs.

## Python Vs TypeScript Tradeoffs

### KERIpy / idiomatic Python approach

Strengths:

- strong one-object discoverability through methods and classmethods
- convenient keyword-argument construction
- close bundling of data, serialization, and workflow
- fewer top-level symbols to import

Costs:

- transport, schema, and workflow responsibilities are easier to conflate
- inheritance becomes part of the mental model
- runtime object identity does more architectural work
- it is harder to see which layer truly owns a representation change

### `keri-ts` / idiomatic TypeScript approach

Strengths:

- semantic records stay plain data
- schema and workflow can evolve independently
- transport wrappers remain narrow and honest
- functions are easy to unit test and compose
- callers can import only the verb surface they need

Costs:

- less one-to-one method parity with KERIpy
- more module symbols to discover
- more explicit imports for callers
- weaker "dot discoverability" than instance methods

## Consequences

Positive:

- clearer ownership boundaries
- fewer misleading "mini-framework" abstractions
- easier maintenance because schema docs and workflow docs live in different
  modules
- easier future ACDC work because fixed-field schema can remain stable while
  disclosure workflows expand
- more direct unit testing of the exact commit/blind/unblind algorithms

Negative:

- maintainers coming from KERIpy must learn where the workflow moved
- API discovery is less centralized than Python class methods
- some KERIpy concepts map to functions plus option interfaces instead of a
  single classmethod call

## Rejected Alternatives

### Put Workflow Methods On `Blinder` / `Mediar`

Rejected because it would make transport wrappers look like semantic workflow
owners.

### Keep Workflow Helpers In `structing.ts`

Rejected because it would collapse schema and workflow concerns into one file
and weaken the representation-boundary model.

### Recreate Rich KERIpy Wrapper Classes In TypeScript

Rejected because it would import Python's object-shape tradeoffs into a language
where plain records plus module functions are the clearer fit.

## Rules For Future Contributors

- New fixed-field disclosure verbs belong in `disclosure.ts`.
- New fixed-field seal/blind/media shapes belong in `structing.ts`.
- Counted-group transport behavior belongs in `Structor`, `Sealer`, `Blinder`,
  `Mediar`, or `Aggor` as appropriate.
- Hierarchical map disclosure belongs in `Mapper` / `Compactor`.
- Aggregate-list disclosure belongs in `Aggor`.
- Do not move raw `SerderKERI.a` / `seals` into eager semantic typing; use
  explicit projection helpers instead.

## Failure Conditions To Watch

- If a future change makes `Blinder` or `Mediar` responsible for semantic
  commitment recomputation, the transport boundary has been violated.
- If a future change makes `structing.ts` responsible for search workflows or
  blind/unblind policy, the schema boundary has been violated.
- If a future change computes fixed-field commitments from crew/SAD strings
  instead of tuple primitive bytes, KERIpy parity has been broken.
