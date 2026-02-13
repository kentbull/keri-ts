import { assertEquals } from "jsr:@std/assert";
import { MATTER_SIZES } from "../../src/tables/matter.tables.generated.ts";
import { decodeB64 } from "../../src/core/bytes.ts";
import {
  parseMatterFromBinary,
  parseMatterFromText,
} from "../../src/primitives/matter.ts";
import {
  parseCounterFromBinary,
  parseCounterFromText,
} from "../../src/primitives/counter.ts";
import {
  parseIndexerFromBinary,
  parseIndexerFromText,
} from "../../src/primitives/indexer.ts";
import { parseAttachmentDispatch } from "../../src/parser/group-dispatch.ts";

function token(code: string): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage || sizage.fs === null) throw new Error(`Need fixed code ${code}`);
  return code + "A".repeat(sizage.fs - code.length);
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

Deno.test("counter qb2 parsing matches qb64 parsing", () => {
  const qb64 = "-KAB";
  const qb2 = decodeB64(qb64);

  const txt = parseCounterFromText(new TextEncoder().encode(qb64), {
    major: 2,
    minor: 0,
  });
  const bny = parseCounterFromBinary(qb2, { major: 2, minor: 0 });

  assertEquals(bny.code, txt.code);
  assertEquals(bny.count, txt.count);
});

Deno.test("matter qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("A");
  const qb2 = decodeB64(qb64);

  const txt = parseMatterFromText(new TextEncoder().encode(qb64));
  const bny = parseMatterFromBinary(qb2);

  assertEquals(bny.code, txt.code);
  assertEquals(bny.qb64, txt.qb64);
  assertEquals([...bny.raw], [...txt.raw]);
});

Deno.test("attachment dispatch supports qb2 domain", () => {
  const qb64 = `-KAB${sigerToken()}`;
  const qb2 = decodeB64(qb64);

  const parsed = parseAttachmentDispatch(qb2, { major: 2, minor: 0 }, "bny");
  assertEquals(parsed.group.code, "-K");
  assertEquals(parsed.group.count, 1);
  assertEquals(parsed.group.items.length, 1);
});

Deno.test("indexer qb2 parsing matches qb64 parsing", () => {
  const qb64 =
    "AABg3q8uNg1A2jhEAdbKGf-QupQhNnmZQx3zIyPLWBe6qqLT5ynytivf9EwJhxyhy87a0x2cezDdil4SsM2xxs0O";
  const qb2 = decodeB64(qb64);

  const txt = parseIndexerFromText(new TextEncoder().encode(qb64));
  const bny = parseIndexerFromBinary(qb2);

  assertEquals(bny.code, txt.code);
  assertEquals(bny.qb64, txt.qb64);
  assertEquals([...bny.raw], [...txt.raw]);
});
