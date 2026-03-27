import { assertEquals, assertThrows } from "jsr:@std/assert";
import { codeB64ToB2, decodeB64 } from "../../../src/core/bytes.ts";
import { ShortageError, UnknownCodeError } from "../../../src/core/errors.ts";
import { Matter, parseMatter, parseMatterFromBinary, parseMatterFromText } from "../../../src/primitives/matter.ts";
import { token } from "../../fixtures/counter-token-fixtures.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertQb64Qb2Parity, assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("matter: parses canonical KERIpy qb64 vectors", () => {
  const vectors = [
    KERIPY_MATTER_VECTORS.prefixerEd25519N,
    KERIPY_MATTER_VECTORS.verferEcdsaR1,
    KERIPY_MATTER_VECTORS.digerBlake3,
    "1___YWJj", // test_coring.py variable-size example
    "2___AGFi", // test_coring.py variable-size example
    "3___AAB6", // test_coring.py variable-size example
  ];

  for (const qb64 of vectors) {
    const matter = parseMatterFromText(txt(qb64));
    assertEquals(matter.qb64, qb64);
    assertQb64Qb2Parity(matter);
  }
});

Deno.test("matter: txt/qb2 parity for KERIpy vector", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_MATTER_VECTORS.prefixerEd25519N,
    parseMatter,
  );

  assertEquals(txtValue.code, bnyValue.code);
});

Deno.test("matter: constructor roundtrip from qb64 to raw+code", () => {
  const src = new Matter({ qb64: KERIPY_MATTER_VECTORS.verferEcdsaR1 });
  const rebuilt = new Matter({ raw: src.raw, code: src.code });
  assertEquals(rebuilt.qb64, src.qb64);
});

Deno.test("matter: parses fixed-size token and trims trailing bytes", () => {
  const qb64 = token("A");
  const parsed = parseMatterFromText(txt(`${qb64}ABCD`));
  assertEquals(parsed.qb64, qb64);

  const qb2 = codeB64ToB2(qb64);
  const longQb2 = new Uint8Array(qb2.length + 5);
  longQb2.set(qb2, 0);
  const parsedBny = parseMatterFromBinary(longQb2);
  assertEquals(parsedBny.qb64, qb64);
});

Deno.test("matter: rejects unknown codes and shortage inputs", () => {
  assertThrows(
    () => parseMatterFromText(txt("?AAA")),
    UnknownCodeError,
  );

  assertThrows(
    () => parseMatterFromText(txt("A")),
    ShortageError,
  );

  assertThrows(
    () => parseMatterFromBinary(new Uint8Array()),
    ShortageError,
  );
});

Deno.test("matter: rejects malformed binary payloads", () => {
  // malformed payload size for code-exfil stage
  const bad2 = decodeB64("2____2Fi").slice(0, 1);
  assertThrows(() => parseMatterFromBinary(bad2), ShortageError);
});
