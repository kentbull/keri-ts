import { assertEquals } from "jsr:@std/assert";
import { codeB64ToB2 } from "../../src/core/bytes.ts";
import { parseAttachmentDispatch } from "../../src/parser/group-dispatch.ts";
import { parseCounterFromBinary, parseCounterFromText } from "../../src/primitives/counter.ts";
import { parseIndexerFromBinary, parseIndexerFromText } from "../../src/primitives/indexer.ts";
import { parseMatterFromBinary, parseMatterFromText } from "../../src/primitives/matter.ts";
import {
  KERIPY_COUNTER_VECTORS,
  KERIPY_INDEXER_VECTORS,
  KERIPY_MATTER_VECTORS,
} from "../fixtures/keripy-primitive-vectors.ts";
import { txt } from "../fixtures/primitive-test-helpers.ts";

const V2 = { major: 2, minor: 0 } as const;

Deno.test("qb2 smoke: matter txt/bny parity", () => {
  const qb64 = KERIPY_MATTER_VECTORS.prefixerEd25519N;
  const txtParsed = parseMatterFromText(txt(qb64));
  const bnyParsed = parseMatterFromBinary(codeB64ToB2(qb64));

  assertEquals(bnyParsed.qb64, txtParsed.qb64);
  assertEquals(bnyParsed.code, txtParsed.code);
});

Deno.test("qb2 smoke: counter/indexer txt/bny parity", () => {
  const counter64 = KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1;
  const counterTxt = parseCounterFromText(txt(counter64), V2);
  const counterBny = parseCounterFromBinary(codeB64ToB2(counter64), V2);
  assertEquals(counterBny.qb64, counterTxt.qb64);
  assertEquals(counterBny.count, counterTxt.count);

  const indexer64 = KERIPY_INDEXER_VECTORS.ed25519SigIdx0;
  const indexerTxt = parseIndexerFromText(txt(indexer64));
  const indexerBny = parseIndexerFromBinary(codeB64ToB2(indexer64));
  assertEquals(indexerBny.qb64, indexerTxt.qb64);
  assertEquals(indexerBny.index, indexerTxt.index);
});

Deno.test("qb2 smoke: attachment dispatch", () => {
  const qb64 = `${KERIPY_COUNTER_VECTORS.v2ControllerIdxSigsCount1}${KERIPY_INDEXER_VECTORS.ed25519SigIdx0}`;
  const parsed = parseAttachmentDispatch(codeB64ToB2(qb64), V2, "bny");

  assertEquals(parsed.group.code, "-K");
  assertEquals(parsed.group.count, 1);
  assertEquals(parsed.group.items.length, 1);
});
