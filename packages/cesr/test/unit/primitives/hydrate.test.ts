import { assertEquals, assertInstanceOf, assertNotInstanceOf } from "jsr:@std/assert";
import { b } from "../../../src/core/bytes.ts";
import { Cigar } from "../../../src/primitives/cigar.ts";
import { Dater } from "../../../src/primitives/dater.ts";
import { Decimer } from "../../../src/primitives/decimer.ts";
import {
  hydrateIndexer,
  hydrateMatter,
  parseQualifiedIndexer,
  parseQualifiedMatter,
} from "../../../src/primitives/hydrate.ts";
import { Indexer } from "../../../src/primitives/indexer.ts";
import { Matter } from "../../../src/primitives/matter.ts";
import { Salter } from "../../../src/primitives/salter.ts";
import { Siger } from "../../../src/primitives/siger.ts";

Deno.test("hydrate: narrows unambiguous matter/indexer families", () => {
  const dater = new Dater({ qb64: "1AAG2024-01-02T03c04c05d000000p00c00" });
  const decimer = new Decimer({ decimal: 3.14 });
  const cigar = new Cigar({ code: "0B", raw: new Uint8Array(64) });
  const siger = new Siger({ code: "A", raw: new Uint8Array(64), index: 1 });

  assertInstanceOf(hydrateMatter(new Matter({ qb64: dater.qb64 })), Dater);
  assertInstanceOf(hydrateMatter(new Matter({ qb64: decimer.qb64 })), Decimer);
  assertInstanceOf(hydrateMatter(new Matter({ qb64: cigar.qb64 })), Cigar);
  assertInstanceOf(parseQualifiedMatter(b(cigar.qb64), "txt"), Cigar);
  assertInstanceOf(hydrateIndexer(new Indexer({ qb64: siger.qb64 })), Siger);
  assertInstanceOf(parseQualifiedIndexer(b(siger.qb64), "txt"), Siger);
});

Deno.test("hydrate: leaves ambiguous matter families generic until context narrows them", () => {
  const salt = new Salter({ code: "0A", raw: new Uint8Array(16) });
  const hydrated = hydrateMatter(new Matter({ qb64: salt.qb64 }));

  assertInstanceOf(hydrated, Matter);
  assertNotInstanceOf(hydrated, Salter);
  assertEquals(hydrated.qb64, salt.qb64);
});
