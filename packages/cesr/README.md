# cesr-ts

TypeScript/JavaScript CESR package for parser primitives, stream parsing, and
CESR annotation.

## Install

```bash
npm install cesr-ts
```

## Library quick start

```ts
import { annotate, createParser } from "cesr-ts";

const parser = createParser();
const out = parser.feed(new TextEncoder().encode("...CESR..."));
const last = parser.flush();

const text = "{\"v\":\"KERI10JSON00002e_\",\"t\":\"rpy\",\"d\":\"Eabc\"}";
const annotated = annotate(text, { domainHint: "txt", pretty: true });
```

## Progressive parsing and optional Effection integration

`parse(source, options)` consumes an async byte iterable and yields complete
frames with pull backpressure. Pass an AbortSignal to the parser and the source
when cancellation must interrupt pending I/O. This core API requires no Effection
installation.

Applications using Effection can install Effection and import the supported
supplementary adapter from `cesr-ts/effection`:

```ts
import { each } from "effection";
import { toEffectionFrames } from "cesr-ts/effection";

// Inside an Operation, readChunks must honor the supplied signal.
const channel = yield* toEffectionFrames((signal) => readChunks(signal));
for (const frame of yield* each(channel.frames)) {
  yield* handleFrame(frame);
  yield* each.next();
}
```

A channel permits one subscription and does not queue frames ahead of demand.
Leaving its scope aborts pending input and joins source cleanup. KERI and Tufa
use this Operation model while the standalone CESR API stays framework-neutral.

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

## License

Licensed under the Apache License, Version 2.0 (`Apache-2.0`). See the top-level
`LICENSE` file in this repository.
