import { assertEquals } from "jsr:@std/assert";
import { parseVerser } from "../../src/primitives/verser.ts";
import { parseIlker } from "../../src/primitives/ilker.ts";
import { parseLabeler } from "../../src/primitives/labeler.ts";
import { parseTexter } from "../../src/primitives/texter.ts";
import { parseBexter } from "../../src/primitives/bexter.ts";
import { parsePather } from "../../src/primitives/pather.ts";
import { parseMapperBody } from "../../src/primitives/mapper.ts";
import { parseNumber } from "../../src/primitives/number.ts";
import { parseSeqner } from "../../src/primitives/seqner.ts";
import { parseDater } from "../../src/primitives/dater.ts";
import { parseDiger } from "../../src/primitives/diger.ts";
import { parsePrefixer } from "../../src/primitives/prefixer.ts";
import { parseNoncer } from "../../src/primitives/noncer.ts";
import { parseSaider } from "../../src/primitives/saider.ts";
import { parseCigar } from "../../src/primitives/cigar.ts";
import { parseVerfer } from "../../src/primitives/verfer.ts";
import { parseTraitor } from "../../src/primitives/traitor.ts";
import { parseTholder } from "../../src/primitives/tholder.ts";
import { parseSealer } from "../../src/primitives/sealer.ts";
import { parseBlinder } from "../../src/primitives/blinder.ts";
import { parseMediar } from "../../src/primitives/mediar.ts";
import { parseCompactor } from "../../src/primitives/compactor.ts";
import { parseAggor } from "../../src/primitives/aggor.ts";
import { intToB64 } from "../../src/core/bytes.ts";
import { MATTER_SIZES } from "../../src/tables/matter.tables.generated.ts";
import { COUNTER_SIZES_V2 } from "../../src/tables/counter.tables.generated.ts";
import { CtrDexV2 } from "../../src/tables/counter-codex.ts";
import {
  KERIPY_NATIVE_V2_ICP_FIX_BODY,
  PARSIDE_GROUP_VECTORS,
} from "../fixtures/external-vectors.ts";

function encode(input: string): Uint8Array {
  return new TextEncoder().encode(input);
}

function token(code: string): string {
  const sizage = MATTER_SIZES.get(code);
  if (!sizage || sizage.fs === null) {
    throw new Error(`Need fixed-size code ${code}`);
  }
  return code + "A".repeat(sizage.fs - code.length);
}

function counterV2(code: string, count: number): string {
  const sizage = COUNTER_SIZES_V2.get(code);
  if (!sizage) throw new Error(`Unknown counter code ${code}`);
  return `${code}${intToB64(count, sizage.ss)}`;
}

Deno.test("verser parses KERI v2 token", () => {
  const verser = parseVerser(encode("0OKERICAACAA"), "txt");
  assertEquals(verser.proto, "KERI");
  assertEquals(verser.pvrsn.major, 2);
  assertEquals(verser.pvrsn.minor, 0);
});

Deno.test("ilker parses native ilk token", () => {
  const ilker = parseIlker(encode("Xicp"), "txt");
  assertEquals(ilker.ilk, "icp");
});

Deno.test("labeler parses map label token", () => {
  const labeler = parseLabeler(encode("VAAA"), "txt");
  assertEquals(labeler.code, "V");
  assertEquals(labeler.token, "VAAA");
  assertEquals(labeler.label.length > 0, true);
  assertEquals(labeler.index, 0);
});

Deno.test("texter parses bytes token", () => {
  const texter = parseTexter(encode("4BABAAAA"), "txt");
  assertEquals(texter.code, "4B");
  assertEquals(texter.text.length > 0, true);
});

Deno.test("bexter parses strb64 token", () => {
  const bexter = parseBexter(encode("4AABabcd"), "txt");
  assertEquals(bexter.code, "4A");
  assertEquals(bexter.bext.length > 0, true);
});

Deno.test("pather parses strb64 token", () => {
  const pather = parsePather(encode("4AABabcd"), "txt");
  assertEquals(pather.code, "4A");
  assertEquals(pather.path, "ABabcd");
});

Deno.test("mapper parses map body with interleaved labels", () => {
  const payload = KERIPY_NATIVE_V2_ICP_FIX_BODY.slice(4);
  const mapPayload = `VAAA${payload.slice(0, 12)}VAAA${
    payload.slice(12, 16)
  }VAAA${payload.slice(16)}`;
  const sizage = COUNTER_SIZES_V2.get(CtrDexV2.MapBodyGroup)!;
  const mapBody = `${CtrDexV2.MapBodyGroup}${
    intToB64(mapPayload.length / 4, sizage.ss)
  }${mapPayload}`;

  const mapper = parseMapperBody(
    encode(mapBody),
    { major: 2, minor: 0 },
    "txt",
  );
  assertEquals(mapper.code, CtrDexV2.MapBodyGroup);
  assertEquals(mapper.fields.length > 0, true);
  assertEquals(mapper.fields.some((f) => f.label !== null), true);
});

Deno.test("mapper recursively parses nested map values", () => {
  const innerPayload = `VAAA${token("B")}`;
  const innerMap = `${
    counterV2(CtrDexV2.MapBodyGroup, innerPayload.length / 4)
  }${innerPayload}`;
  const outerPayload = `VAAA${innerMap}VAAA${token("E")}`;
  const outerMap = `${
    counterV2(CtrDexV2.MapBodyGroup, outerPayload.length / 4)
  }${outerPayload}`;

  const mapper = parseMapperBody(
    encode(outerMap),
    { major: 2, minor: 0 },
    "txt",
  );
  assertEquals(mapper.fields.length, 2);
  assertEquals(mapper.fields[0].isCounter, true);
  assertEquals((mapper.fields[0].children?.length ?? 0) > 0, true);
});

Deno.test("number parses numeric primitive", () => {
  const number = parseNumber(encode(token("M")), "txt");
  assertEquals(number.code, "M");
  assertEquals(number.num, 0n);
});

Deno.test("seqner parses Salt_128 sequence primitive", () => {
  const seqner = parseSeqner(encode(token("0A")), "txt");
  assertEquals(seqner.code, "0A");
  assertEquals(seqner.sn, 0n);
  assertEquals(seqner.snh.length, 32);
});

Deno.test("dater parses KERI datetime primitive", () => {
  const daterToken = PARSIDE_GROUP_VECTORS.attachmentGroup.slice(
    PARSIDE_GROUP_VECTORS.attachmentGroup.lastIndexOf("1AAG"),
  );
  const dater = parseDater(encode(daterToken), "txt");
  assertEquals(dater.code, "1AAG");
  assertEquals(dater.dts.length > 0, true);
  assertEquals(dater.iso8601.length > 0, true);
});

Deno.test("diger parses digest primitive", () => {
  const diger = parseDiger(encode(token("E")), "txt");
  assertEquals(diger.code, "E");
  assertEquals(diger.algorithm.startsWith("Blake"), true);
});

Deno.test("prefixer parses transferable prefix primitive", () => {
  const prefixer = parsePrefixer(encode(token("B")), "txt");
  assertEquals(prefixer.code, "B");
  assertEquals(prefixer.prefix.length > 0, true);
});

Deno.test("noncer parses nonce primitive", () => {
  const noncer = parseNoncer(encode(token("0A")), "txt");
  assertEquals(noncer.code, "0A");
  assertEquals(noncer.nonce.length > 0, true);
});

Deno.test("saider parses said digest primitive", () => {
  const saider = parseSaider(encode(token("E")), "txt");
  assertEquals(saider.code, "E");
  assertEquals(saider.said.length > 0, true);
});

Deno.test("cigar parses non-indexed signature primitive", () => {
  const cigar = parseCigar(encode(token("0B")), "txt");
  assertEquals(cigar.code, "0B");
  assertEquals(cigar.algorithm.includes("_Sig"), true);
});

Deno.test("verfer parses verification key primitive", () => {
  const verfer = parseVerfer(encode(token("B")), "txt");
  assertEquals(verfer.code, "B");
  assertEquals(verfer.key.length > 0, true);
});

Deno.test("traitor parses trait primitive", () => {
  const traitor = parseTraitor(encode(token("X")), "txt");
  assertEquals(traitor.code, "X");
  assertEquals(traitor.trait.startsWith("Tag"), true);
});

Deno.test("tholder parses threshold primitive", () => {
  const tholder = parseTholder(encode(token("M")), "txt");
  assertEquals(tholder.code, "M");
  assertEquals(tholder.sith.length > 0, true);
});

Deno.test("sealer parses seal source couples group", () => {
  const ims = `${counterV2(CtrDexV2.SealSourceCouples, 1)}${token("B")}${
    token("E")
  }`;
  const sealer = parseSealer(encode(ims), { major: 2, minor: 0 }, "txt");
  assertEquals(sealer.code, CtrDexV2.SealSourceCouples);
  assertEquals(sealer.count, 1);
  assertEquals(sealer.items.length, 1);
});

Deno.test("blinder parses blinded state quadruples group", () => {
  const ims = `${counterV2(CtrDexV2.BlindedStateQuadruples, 1)}${token("B")}${
    token("E")
  }${token("D")}${token("M")}`;
  const blinder = parseBlinder(encode(ims), { major: 2, minor: 0 }, "txt");
  assertEquals(blinder.code, CtrDexV2.BlindedStateQuadruples);
  assertEquals(blinder.count, 1);
  assertEquals(blinder.items.length, 1);
});

Deno.test("mediar parses typed media quadruples group", () => {
  const ims = `${counterV2(CtrDexV2.TypedMediaQuadruples, 1)}${token("B")}${
    token("E")
  }${token("D")}${token("M")}`;
  const mediar = parseMediar(encode(ims), { major: 2, minor: 0 }, "txt");
  assertEquals(mediar.code, CtrDexV2.TypedMediaQuadruples);
  assertEquals(mediar.count, 1);
  assertEquals(mediar.items.length, 1);
});

Deno.test("compactor parses map body group", () => {
  const payload = `VAAA${token("B")}VAAA${token("E")}`;
  const ims = `${
    counterV2(CtrDexV2.MapBodyGroup, payload.length / 4)
  }${payload}`;
  const compactor = parseCompactor(encode(ims), { major: 2, minor: 0 }, "txt");
  assertEquals(compactor.code, CtrDexV2.MapBodyGroup);
  assertEquals(compactor.fields.length >= 1, true);
});

Deno.test("aggor parses generic list group", () => {
  const payload = "ABCDWXYZ";
  const ims = `${
    counterV2(CtrDexV2.GenericListGroup, payload.length / 4)
  }${payload}`;
  const aggor = parseAggor(encode(ims), { major: 2, minor: 0 }, "txt");
  assertEquals(aggor.code, CtrDexV2.GenericListGroup);
  assertEquals(aggor.kind, "list");
  assertEquals((aggor.listItems?.length ?? 0) > 0, true);
});
