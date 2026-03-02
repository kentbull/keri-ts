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

const text = '{"v":"KERI10JSON00002e_","t":"rpy","d":"Eabc"}';
const annotated = annotate(text, { domainHint: "txt", pretty: true });
```

## CLI usage

```bash
npx cesr-annotate --in mystream.cesr --pretty
```

## Deno CLI usage (from source)

```bash
deno task cesr:annotate --in mystream.cesr --pretty
```

## Benchmarking (from source)

Run standard parser benchmark baselines:

```bash
deno task bench:cesr
```

Run a benchmark on an arbitrary stream:

```bash
deno task bench:cesr:parser --in ../../samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr
cat ../../samples/cesr-streams/CESR_1_0-oor-auth-vc.cesr | deno task bench:cesr:parser --iterations 20 --warmup 3
```

## Using cesr-ts through tufa

`keri-ts` exposes CESR annotation through `tufa annotate`, which is often the
easiest on-ramp:

```bash
tufa version
tufa annotate --in mystream.cesr --pretty
```
