import { b } from "../../src/core/bytes.ts";
import type { Matter } from "../../src/primitives/base/matter.ts";
import { makePather } from "../../src/primitives/structuring/pather.ts";
import { Bexter } from "../../src/primitives/values/bexter.ts";
import { Labeler } from "../../src/primitives/values/labeler.ts";
import { wireHex } from "./current-reference-vectors.ts";
import vectors from "./current-text-vectors.json" with { type: "json" };

/** Encode TS-constructed primitives without copying Python's expected wire. */
function encoded(value: Matter) {
  return { qb64: value.qb64, qb2: wireHex(value.qb2) };
}

/** Emit semantic inputs through TS constructors for independent Python decoding. */
export function currentTextVectors() {
  return {
    bexters: vectors.bexters.map(({ text, escapive }) => ({
      text,
      escapive,
      ...encoded(new Bexter({ code: "4A", raw: Bexter.rawify(text, escapive) }, escapive)),
    })),
    labels: vectors.labels.map(({ text }) => ({
      text,
      ...encoded(new Labeler({ code: "4A", raw: Bexter.rawify(text) })),
    })),
    paths: vectors.paths.map(({ text, relative }) => {
      const pather = makePather(text, { relative });
      return { text, relative, path: pather.path, ...encoded(pather) };
    }),
  };
}

if (import.meta.main) {
  await Deno.stdout.write(b(JSON.stringify(currentTextVectors(), null, 2) + "\n"));
}
