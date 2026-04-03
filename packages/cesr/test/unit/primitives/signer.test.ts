import { assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Cigar } from "../../../src/primitives/cigar.ts";
import { MtrDex } from "../../../src/primitives/codex.ts";
import { Siger } from "../../../src/primitives/siger.ts";
import { Signer } from "../../../src/primitives/signer.ts";
import { KERIPY_CODE_VECTORS, KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";

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

Deno.test("signer: derives transferable and non-transferable verfers from the same Ed25519 seed", () => {
  const seed = new Uint8Array(32).fill(7);
  const transferable = new Signer({
    code: MtrDex.Ed25519_Seed,
    raw: seed,
    transferable: true,
  });
  const nonTransferable = new Signer({
    code: MtrDex.Ed25519_Seed,
    raw: seed,
    transferable: false,
  });

  assertEquals(transferable.verfer.code, MtrDex.Ed25519);
  assertEquals(nonTransferable.verfer.code, MtrDex.Ed25519N);
  assertEquals(transferable.verfer.qb64 === nonTransferable.verfer.qb64, false);
  assertEquals(transferable.verfer.raw, nonTransferable.verfer.raw);
});

Deno.test("signer: signs messages as detached cigars and indexed sigers with verifier linkage", () => {
  const signer = new Signer({
    code: MtrDex.Ed25519_Seed,
    raw: new Uint8Array(32).fill(8),
    transferable: true,
  });
  const ser = new TextEncoder().encode("keri-ts-signer");

  const cigar = signer.sign(ser);
  const siger = signer.sign(ser, { index: 0 });
  const currentOnly = signer.sign(ser, { index: 68, only: true });

  assertInstanceOf(cigar, Cigar);
  assertInstanceOf(siger, Siger);
  assertInstanceOf(currentOnly, Siger);
  assertEquals(cigar.verfer?.qb64, signer.verfer.qb64);
  assertEquals(siger.verfer?.qb64, signer.verfer.qb64);
  assertEquals(currentOnly.verfer?.qb64, signer.verfer.qb64);
  assertEquals(siger.code, "A");
  assertEquals(currentOnly.code, "2B");
  assertEquals(signer.verfer.verify(cigar.raw, ser), true);
  assertEquals(signer.verfer.verify(siger.raw, ser), true);
});

Deno.test("signer: explicit random factory honors the requested suite", () => {
  const signer = Signer.random({
    code: MtrDex.ECDSA_256k1_Seed,
    transferable: false,
  });

  assertEquals(signer.code, MtrDex.ECDSA_256k1_Seed);
  assertEquals(signer.transferable, false);
  assertEquals(signer.seed.length, 32);
  assertEquals(signer.verfer.code, MtrDex.ECDSA_256k1N);
});

Deno.test("signer: rejects non-seed code families", () => {
  assertThrows(
    () => new Signer({ qb64: KERIPY_MATTER_VECTORS.salterFixed }),
    UnknownCodeError,
  );
});
