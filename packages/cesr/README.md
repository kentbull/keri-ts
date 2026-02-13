# cesr-ts

TypeScript/JavaScript CESR package for parser primitives, stream parsing, and
CESR annotation.

## Install

```bash
npm install cesr-ts
```

## Library usage

```ts
import { createParser } from "cesr-ts";

const parser = createParser();
const out = parser.feed(new TextEncoder().encode("..."));
const last = parser.flush();
```

## CLI usage

```bash
npx cesr-annotate --in mystream.cesr --pretty
```

## Deno CLI usage (from source)

```bash
deno task cesr:annotate --in mystream.cesr --pretty
```
