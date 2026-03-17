import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Cipher } from "../../../src/primitives/cipher.ts";
import { token } from "../../fixtures/counter-token-fixtures.ts";
import {
  KERIPY_CODE_VECTORS,
  KERIPY_MATTER_VECTORS,
} from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("cipher: hydrates KERIpy cipher-seed code family", () => {
  const cipher = new Cipher({
    qb64: token(KERIPY_CODE_VECTORS.cipherSeedCode),
  });
  assertEquals(cipher.code, KERIPY_CODE_VECTORS.cipherSeedCode);
});

Deno.test("cipher: supports KERIpy X25519 cipher code variants", () => {
  const cipher = new Cipher({ qb64: `4C${"A".repeat(6)}` });
  assertEquals(cipher.code, "4C");
});

Deno.test("cipher: rejects non-cipher code families", () => {
  assertThrows(
    () => new Cipher({ qb64: KERIPY_MATTER_VECTORS.signerSeedR1 }),
    UnknownCodeError,
  );
});
