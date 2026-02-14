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
import { parseNumber } from "../../src/primitives/number.ts";
import { parseSeqner } from "../../src/primitives/seqner.ts";
import { parseDater } from "../../src/primitives/dater.ts";
import { parseDiger } from "../../src/primitives/diger.ts";
import { parsePrefixer } from "../../src/primitives/prefixer.ts";
import { parseNoncer } from "../../src/primitives/noncer.ts";
import { parseSaider } from "../../src/primitives/saider.ts";
import { parseBexter } from "../../src/primitives/bexter.ts";
import { parseCigar } from "../../src/primitives/cigar.ts";
import { parseVerfer } from "../../src/primitives/verfer.ts";
import { parseTraitor } from "../../src/primitives/traitor.ts";
import { parseTholder } from "../../src/primitives/tholder.ts";
import { parseLabeler } from "../../src/primitives/labeler.ts";
import { parseTexter } from "../../src/primitives/texter.ts";
import { parsePather } from "../../src/primitives/pather.ts";
import { parseSealer } from "../../src/primitives/sealer.ts";
import { parseBlinder } from "../../src/primitives/blinder.ts";
import { parseMediar } from "../../src/primitives/mediar.ts";
import { parseCompactor } from "../../src/primitives/compactor.ts";
import { parseAggor } from "../../src/primitives/aggor.ts";
import { parseAttachmentDispatch } from "../../src/parser/group-dispatch.ts";
import { PARSIDE_GROUP_VECTORS } from "../fixtures/external-vectors.ts";
import { COUNTER_SIZES_V2 } from "../../src/tables/counter.tables.generated.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import { intToB64 } from "../../src/core/bytes.ts";

function token(code: string): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage || sizage.fs === null) throw new Error(`Need fixed code ${code}`);
  return code + "A".repeat(sizage.fs - code.length);
}

function sigerToken(): string {
  return `A${"A".repeat(87)}`;
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
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

Deno.test("number qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("M");
  const qb2 = decodeB64(qb64);

  const txt = parseNumber(new TextEncoder().encode(qb64), "txt");
  const bny = parseNumber(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.num, txt.num);
  assertEquals(bny.numh, txt.numh);
});

Deno.test("seqner qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("0A");
  const qb2 = decodeB64(qb64);

  const txt = parseSeqner(new TextEncoder().encode(qb64), "txt");
  const bny = parseSeqner(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.sn, txt.sn);
  assertEquals(bny.snh, txt.snh);
});

Deno.test("dater qb2 parsing matches qb64 parsing", () => {
  const qb64 = PARSIDE_GROUP_VECTORS.attachmentGroup.slice(
    PARSIDE_GROUP_VECTORS.attachmentGroup.lastIndexOf("1AAG"),
  );
  const qb2 = decodeB64(qb64);

  const txt = parseDater(new TextEncoder().encode(qb64), "txt");
  const bny = parseDater(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.dts, txt.dts);
  assertEquals(bny.iso8601, txt.iso8601);
});

Deno.test("diger qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("E");
  const qb2 = decodeB64(qb64);

  const txt = parseDiger(new TextEncoder().encode(qb64), "txt");
  const bny = parseDiger(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.algorithm, txt.algorithm);
  assertEquals([...bny.digest], [...txt.digest]);
});

Deno.test("prefixer qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("B");
  const qb2 = decodeB64(qb64);

  const txt = parsePrefixer(new TextEncoder().encode(qb64), "txt");
  const bny = parsePrefixer(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.prefix, txt.prefix);
});

Deno.test("noncer qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("0A");
  const qb2 = decodeB64(qb64);

  const txt = parseNoncer(new TextEncoder().encode(qb64), "txt");
  const bny = parseNoncer(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals([...bny.nonce], [...txt.nonce]);
});

Deno.test("saider qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("E");
  const qb2 = decodeB64(qb64);

  const txt = parseSaider(new TextEncoder().encode(qb64), "txt");
  const bny = parseSaider(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.said, txt.said);
  assertEquals([...bny.digest], [...txt.digest]);
});

Deno.test("bexter qb2 parsing matches qb64 parsing", () => {
  const qb64 = "4AABabcd";
  const qb2 = decodeB64(qb64);

  const txt = parseBexter(new TextEncoder().encode(qb64), "txt");
  const bny = parseBexter(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.bext, txt.bext);
});

Deno.test("cigar qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("0B");
  const qb2 = decodeB64(qb64);

  const txt = parseCigar(new TextEncoder().encode(qb64), "txt");
  const bny = parseCigar(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.algorithm, txt.algorithm);
  assertEquals([...bny.sig], [...txt.sig]);
});

Deno.test("verfer qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("B");
  const qb2 = decodeB64(qb64);

  const txt = parseVerfer(new TextEncoder().encode(qb64), "txt");
  const bny = parseVerfer(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.algorithm, txt.algorithm);
  assertEquals([...bny.key], [...txt.key]);
});

Deno.test("traitor qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("X");
  const qb2 = decodeB64(qb64);

  const txt = parseTraitor(new TextEncoder().encode(qb64), "txt");
  const bny = parseTraitor(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.trait, txt.trait);
});

Deno.test("tholder qb2 parsing matches qb64 parsing", () => {
  const qb64 = token("M");
  const qb2 = decodeB64(qb64);

  const txt = parseTholder(new TextEncoder().encode(qb64), "txt");
  const bny = parseTholder(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.sith, txt.sith);
});

Deno.test("labeler qb2 parsing matches qb64 parsing", () => {
  const qb64 = "VAAA";
  const qb2 = decodeB64(qb64);

  const txt = parseLabeler(new TextEncoder().encode(qb64), "txt");
  const bny = parseLabeler(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.token, txt.token);
  assertEquals(bny.index, txt.index);
  assertEquals(bny.label, txt.label);
});

Deno.test("texter qb2 parsing matches qb64 parsing", () => {
  const qb64 = "4BABAAAA";
  const qb2 = decodeB64(qb64);

  const txt = parseTexter(new TextEncoder().encode(qb64), "txt");
  const bny = parseTexter(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.text, txt.text);
});

Deno.test("pather qb2 parsing matches qb64 parsing", () => {
  const qb64 = "4AABabcd";
  const qb2 = decodeB64(qb64);

  const txt = parsePather(new TextEncoder().encode(qb64), "txt");
  const bny = parsePather(qb2, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.path, txt.path);
});

Deno.test("sealer qb2 parsing matches qb64 parsing", () => {
  const qb64 = `${counterV2(CtrDexV2.SealSourceCouples, 1)}${token("B")}${
    token("E")
  }`;
  const qb2 = decodeB64(qb64);

  const txt = parseSealer(new TextEncoder().encode(qb64), {
    major: 2,
    minor: 0,
  }, "txt");
  const bny = parseSealer(qb2, { major: 2, minor: 0 }, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.count, txt.count);
  assertEquals(bny.items.length, txt.items.length);
});

Deno.test("blinder qb2 parsing matches qb64 parsing", () => {
  const qb64 = `${counterV2(CtrDexV2.BlindedStateQuadruples, 1)}${token("B")}${
    token("E")
  }${token("D")}${token("M")}`;
  const qb2 = decodeB64(qb64);

  const txt = parseBlinder(new TextEncoder().encode(qb64), {
    major: 2,
    minor: 0,
  }, "txt");
  const bny = parseBlinder(qb2, { major: 2, minor: 0 }, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.count, txt.count);
  assertEquals(bny.items.length, txt.items.length);
});

Deno.test("mediar qb2 parsing matches qb64 parsing", () => {
  const qb64 = `${counterV2(CtrDexV2.TypedMediaQuadruples, 1)}${token("B")}${
    token("E")
  }${token("D")}${token("M")}`;
  const qb2 = decodeB64(qb64);

  const txt = parseMediar(new TextEncoder().encode(qb64), {
    major: 2,
    minor: 0,
  }, "txt");
  const bny = parseMediar(qb2, { major: 2, minor: 0 }, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.count, txt.count);
  assertEquals(bny.items.length, txt.items.length);
});

Deno.test("compactor qb2 parsing matches qb64 parsing", () => {
  const payload = `VAAA${token("B")}VAAA${token("E")}`;
  const qb64 = `${
    counterV2(CtrDexV2.MapBodyGroup, payload.length / 4)
  }${payload}`;
  const qb2 = decodeB64(qb64);

  const txt = parseCompactor(new TextEncoder().encode(qb64), {
    major: 2,
    minor: 0,
  }, "txt");
  const bny = parseCompactor(qb2, { major: 2, minor: 0 }, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.count, txt.count);
  assertEquals(bny.fields.length, txt.fields.length);
});

Deno.test("mapper nested map qb2 parsing matches qb64 parsing", () => {
  const innerPayload = `VAAA${token("B")}`;
  const innerMap = `${
    counterV2(CtrDexV2.MapBodyGroup, innerPayload.length / 4)
  }${innerPayload}`;
  const outerPayload = `VAAA${innerMap}VAAA${token("E")}`;
  const qb64 = `${
    counterV2(CtrDexV2.MapBodyGroup, outerPayload.length / 4)
  }${outerPayload}`;
  const qb2 = decodeB64(qb64);

  const txt = parseCompactor(new TextEncoder().encode(qb64), {
    major: 2,
    minor: 0,
  }, "txt");
  const bny = parseCompactor(qb2, { major: 2, minor: 0 }, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.fields.length, txt.fields.length);
  assertEquals((bny.fields[0].children?.length ?? 0) > 0, true);
});

Deno.test("aggor qb2 parsing matches qb64 parsing", () => {
  const payload = "ABCDWXYZ";
  const qb64 = `${
    counterV2(CtrDexV2.GenericListGroup, payload.length / 4)
  }${payload}`;
  const qb2 = decodeB64(qb64);

  const txt = parseAggor(
    new TextEncoder().encode(qb64),
    { major: 2, minor: 0 },
    "txt",
  );
  const bny = parseAggor(qb2, { major: 2, minor: 0 }, "bny");

  assertEquals(bny.code, txt.code);
  assertEquals(bny.kind, txt.kind);
  assertEquals(bny.count, txt.count);
});
