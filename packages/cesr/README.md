# cesr-ts

TypeScript/JavaScript CESR package for parser primitives, stream parsing, and
CESR annotation.

## Install

```bash
npm install cesr-ts
```

## Library quick start

```ts
import { annotate, parseBytes } from "cesr-ts";

const text = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
const frames = parseBytes(new TextEncoder().encode(text));
console.log(frames[0].body.ilk);
const annotated = annotate(text, { pretty: true });
```

## Buffered decoding

`parse(source)` consumes an async byte iterable and yields complete frames with
pull backpressure. Counted enclosures are buffered completely before their children
are decoded. Consuming operations own cancellation; actual byte readers interrupt
pending I/O and join their cleanup. CESR has no scheduler integration or Effection
subpath.

`parseBytes(bytes)` synchronously decodes complete finite input. Hydrated frames,
including ordered ESSR Texters and nested children, are ordinary values that need
no disposal. Both APIs reject malformed or truncated framing.

## Finite annotation and benchmark helpers

`annotate()` and `annotateFrames()` synchronously validate with the same finite
decoder. Wire sniffing selects text or binary automatically. Annotation retains
its input and rendered output and has no cancellation option.

`benchmarkParser()` and `countFrames()` are asynchronous. The benchmark retains
one replayable corpus and rejects malformed or truncated runs instead of reporting
partial throughput. Annotation, collection and benchmark helpers have no input
quota or max-bytes flag. `tephra validate` reads incrementally and validates each
frame before requesting the next.

## CLI usage

```bash
npm exec --package cesr-ts -- tephra annotate --in mystream.cesr --pretty
npm exec --package cesr-ts -- tephra validate --in mystream.cesr
npm exec --package cesr-ts -- tephra bench --in mystream.cesr --iterations 20 --warmup 3
```

After global install:

```bash
tephra annotate --in mystream.cesr --pretty
tephra validate --in mystream.cesr
tephra bench --in mystream.cesr --iterations 20 --warmup 3
```

## Deno CLI usage (from repository root)

```bash
deno task tephra:annotate --in mystream.cesr --pretty
deno task tephra:validate --in mystream.cesr
```

## Benchmarking (from repository root)

Run standard parser benchmark baselines:

```bash
deno task bench:cesr
```

Run a benchmark on an arbitrary stream:

```bash
deno task tephra:bench --in ../../samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr
cat ../../samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr | deno task tephra:bench --iterations 20 --warmup 3
```

## Using cesr-ts through tufa

`keri-ts` exposes CESR annotation through `tufa annotate`, which is often the
easiest on-ramp:

```bash
tufa version
tufa annotate --in mystream.cesr --pretty
```

## Source organization

`src/primitives` groups encoding bases in `base`, keys/digests/signatures and
ciphers in `crypto`, scalar/text/tag values in `values`, and counted structures,
mapping and disclosure in `structuring`. Primitive tests use the same categories.
Parsing, body serialization, annotation, generated tables and CLI adapters retain
their own directories. Consumers import supported names from `cesr-ts`.

## License

Licensed under the Apache License, Version 2.0 (`Apache-2.0`). See the top-level
`LICENSE` file in this repository.
