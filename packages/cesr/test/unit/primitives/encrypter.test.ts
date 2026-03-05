import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Encrypter } from "../../../src/primitives/encrypter.ts";
import {
  KERIPY_CODE_VECTORS,
  KERIPY_MATTER_VECTORS,
} from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("encrypter: hydrates KERIpy X25519 vector", () => {
  const encrypter = new Encrypter({ qb64: KERIPY_MATTER_VECTORS.encrypterX25519 });
  assertEquals(encrypter.qb64, KERIPY_MATTER_VECTORS.encrypterX25519);
  assertEquals(encrypter.code, KERIPY_CODE_VECTORS.encrypterCode);
});

Deno.test("encrypter: rejects non-X25519 codes", () => {
  assertThrows(
    () => new Encrypter({ qb64: KERIPY_MATTER_VECTORS.salterFixed }),
    UnknownCodeError,
  );
});
