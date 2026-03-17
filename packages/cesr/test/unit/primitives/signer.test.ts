import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Signer } from "../../../src/primitives/signer.ts";
import {
  KERIPY_CODE_VECTORS,
  KERIPY_MATTER_VECTORS,
} from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("signer: hydrates KERIpy signer seed vectors", () => {
  const sR1 = new Signer({ qb64: KERIPY_MATTER_VECTORS.signerSeedR1 });
  const sK1 = new Signer({ qb64: KERIPY_MATTER_VECTORS.signerSeedK1 });

  assertEquals(
    new Set<string>(KERIPY_CODE_VECTORS.signerSeedCodes).has(sR1.code),
    true,
  );
  assertEquals(
    new Set<string>(KERIPY_CODE_VECTORS.signerSeedCodes).has(sK1.code),
    true,
  );
  assertEquals(sR1.seed.length > 0, true);
  assertEquals(sK1.seed.length > 0, true);
});

Deno.test("signer: KERIpy deterministic seed vector is stable", () => {
  const signer = new Signer({ qb64: KERIPY_MATTER_VECTORS.signerSeedR1Vector });
  assertEquals(signer.qb64, KERIPY_MATTER_VECTORS.signerSeedR1Vector);
});

Deno.test("signer: rejects non-seed code families", () => {
  assertThrows(
    () => new Signer({ qb64: KERIPY_MATTER_VECTORS.salterFixed }),
    UnknownCodeError,
  );
});
