import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Salter } from "../../../src/primitives/salter.ts";
import { KERIPY_CODE_VECTORS, KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("salter: hydrates KERIpy salt vector", () => {
  const salter = new Salter({ qb64: KERIPY_MATTER_VECTORS.salterFixed });
  assertEquals(salter.qb64, KERIPY_MATTER_VECTORS.salterFixed);
  assertEquals(
    new Set<string>(KERIPY_CODE_VECTORS.salterCodes).has(salter.code),
    true,
  );
  assertEquals(salter.salt.length, 16);
});

Deno.test("salter: rejects Salt_256 because KERIpy Salter only supports Salt_128", () => {
  assertThrows(
    () => new Salter({ qb64: `a${"A".repeat(43)}` }),
    UnknownCodeError,
  );
});

Deno.test("salter: rejects non-salt code families", () => {
  assertThrows(
    () => new Salter({ qb64: KERIPY_MATTER_VECTORS.signerSeedR1 }),
    UnknownCodeError,
  );
});
