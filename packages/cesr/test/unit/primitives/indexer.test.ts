import { assertEquals, assertThrows } from "jsr:@std/assert";
import { codeB64ToB2, decodeB64 } from "../../../src/core/bytes.ts";
import { ShortageError, UnknownCodeError } from "../../../src/core/errors.ts";
import {
  Indexer,
  parseIndexer,
  parseIndexerFromBinary,
  parseIndexerFromText,
} from "../../../src/primitives/indexer.ts";
import { KERIPY_INDEXER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertQb64Qb2Parity, assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("indexer: parses key KERIpy indexed-signature vectors", () => {
  const vectors = [
    KERIPY_INDEXER_VECTORS.ed25519SigIdx0,
    KERIPY_INDEXER_VECTORS.ed25519SigIdx5,
    KERIPY_INDEXER_VECTORS.ed25519BigSigIdx67,
    KERIPY_INDEXER_VECTORS.ed25519BigSigIdx90Ondex65,
    KERIPY_INDEXER_VECTORS.ed25519CrtSigIdx3,
    KERIPY_INDEXER_VECTORS.ed25519BigCrtSigIdx68,
    KERIPY_INDEXER_VECTORS.tbd0Label,
  ];

  for (const qb64 of vectors) {
    const indexer = parseIndexerFromText(txt(qb64));
    assertEquals(indexer.qb64, qb64);
    assertQb64Qb2Parity(indexer);
  }
});

Deno.test("indexer: txt/qb2 parity and index/ondex invariants", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_INDEXER_VECTORS.ed25519BigSigIdx90Ondex65,
    parseIndexer,
  );

  assertEquals(txtValue.index, 90);
  assertEquals(txtValue.ondex, 65);
  assertEquals(bnyValue.index, 90);
  assertEquals(bnyValue.ondex, 65);
});

Deno.test("indexer: constructor roundtrip and qb2 trimming", () => {
  const src = new Indexer({ qb64: KERIPY_INDEXER_VECTORS.ed25519SigIdx5 });
  const rebuilt = new Indexer({ qb64: src.qb64 });
  assertEquals(rebuilt.qb64, src.qb64);

  const qb2 = codeB64ToB2(src.qb64);
  const longQb2 = new Uint8Array(qb2.length + 4);
  longQb2.set(qb2, 0);
  const parsed = parseIndexerFromBinary(longQb2);
  assertEquals(parsed.qb64, src.qb64);
});

Deno.test("indexer: rejects invalid inputs", () => {
  assertThrows(
    () => parseIndexerFromText(txt("?AAA")),
    UnknownCodeError,
  );

  assertThrows(
    () => parseIndexerFromText(txt("A")),
    ShortageError,
  );

  assertThrows(
    () => parseIndexerFromBinary(new Uint8Array()),
    ShortageError,
  );

  assertThrows(
    () => new Indexer({ qb64: "AAAA" }),
    ShortageError,
  );
});

Deno.test("indexer: rejects non-indexer qb64 family", () => {
  assertThrows(
    () => new Indexer({ qb64: "BKxy2sgzfplyr-tgwIxS19f2OchFHtLwPWD3v4oYimBx" }),
    ShortageError,
  );
});
