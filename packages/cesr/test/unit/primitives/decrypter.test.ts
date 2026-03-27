import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Decrypter } from "../../../src/primitives/decrypter.ts";
import { KERIPY_CODE_VECTORS, KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("decrypter: hydrates KERIpy X25519 private vector", () => {
  const decrypter = new Decrypter({
    qb64: KERIPY_MATTER_VECTORS.decrypterX25519Private,
  });
  assertEquals(decrypter.qb64, KERIPY_MATTER_VECTORS.decrypterX25519Private);
  assertEquals(decrypter.code, KERIPY_CODE_VECTORS.decrypterCode);
});

Deno.test("decrypter: rejects non-X25519 private codes", () => {
  assertThrows(
    () => new Decrypter({ qb64: KERIPY_MATTER_VECTORS.encrypterX25519 }),
    UnknownCodeError,
  );
});
