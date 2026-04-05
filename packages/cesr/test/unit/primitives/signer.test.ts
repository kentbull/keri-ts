import { assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Cigar } from "../../../src/primitives/cigar.ts";
import { IdrDex, MtrDex } from "../../../src/primitives/codex.ts";
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

  assertEquals(transferable.transferable, true);
  assertEquals(nonTransferable.transferable, false);
  assertEquals(transferable.verfer.code, MtrDex.Ed25519);
  assertEquals(nonTransferable.verfer.code, MtrDex.Ed25519N);
  assertEquals(transferable.verfer.qb64 === nonTransferable.verfer.qb64, false);
  assertEquals(transferable.verfer.raw, nonTransferable.verfer.raw);
});

Deno.test("signer: exposes primitive-owned suite metadata helpers", () => {
  assertEquals(Signer.seedSizeForCode(MtrDex.Ed25519_Seed), 32);
  assertEquals(Signer.seedSizeForCode(MtrDex.ECDSA_256k1_Seed), 32);
  assertEquals(Signer.seedSizeForCode(MtrDex.ECDSA_256r1_Seed), 32);
  assertEquals(
    Signer.seedCodeForVerferCode(MtrDex.Ed25519),
    MtrDex.Ed25519_Seed,
  );
  assertEquals(
    Signer.seedCodeForVerferCode(MtrDex.Ed25519N),
    MtrDex.Ed25519_Seed,
  );
  assertEquals(
    Signer.seedCodeForVerferCode(MtrDex.ECDSA_256k1),
    MtrDex.ECDSA_256k1_Seed,
  );
  assertEquals(
    Signer.seedCodeForVerferCode(MtrDex.ECDSA_256k1N),
    MtrDex.ECDSA_256k1_Seed,
  );
  assertEquals(
    Signer.seedCodeForVerferCode(MtrDex.ECDSA_256r1),
    MtrDex.ECDSA_256r1_Seed,
  );
  assertEquals(
    Signer.seedCodeForVerferCode(MtrDex.ECDSA_256r1N),
    MtrDex.ECDSA_256r1_Seed,
  );
  assertThrows(
    () => Signer.seedSizeForCode(MtrDex.Ed25519),
    UnknownCodeError,
  );
  assertThrows(
    () => Signer.seedCodeForVerferCode(MtrDex.Ed25519_Seed),
    UnknownCodeError,
  );
});

Deno.test("signer: emits suite-correct detached and indexed signature codes with verifier linkage", () => {
  const ser = new TextEncoder().encode("keri-ts-signer");
  const suites = [
    {
      signerCode: MtrDex.Ed25519_Seed,
      cigarCode: MtrDex.Ed25519_Sig,
      bothCode: IdrDex.Ed25519_Sig,
      bigBothCode: IdrDex.Ed25519_Big_Sig,
      bigCurrentOnlyCode: IdrDex.Ed25519_Big_Crt_Sig,
      seedFill: 8,
    },
    {
      signerCode: MtrDex.ECDSA_256k1_Seed,
      cigarCode: MtrDex.ECDSA_256k1_Sig,
      bothCode: IdrDex.ECDSA_256k1_Sig,
      bigBothCode: IdrDex.ECDSA_256k1_Big_Sig,
      bigCurrentOnlyCode: IdrDex.ECDSA_256k1_Big_Crt_Sig,
      seedFill: 9,
    },
    {
      signerCode: MtrDex.ECDSA_256r1_Seed,
      cigarCode: MtrDex.ECDSA_256r1_Sig,
      bothCode: IdrDex.ECDSA_256r1_Sig,
      bigBothCode: IdrDex.ECDSA_256r1_Big_Sig,
      bigCurrentOnlyCode: IdrDex.ECDSA_256r1_Big_Crt_Sig,
      seedFill: 10,
    },
  ] as const;

  for (const suite of suites) {
    const signer = new Signer({
      code: suite.signerCode,
      raw: new Uint8Array(32).fill(suite.seedFill),
      transferable: true,
    });

    const cigar = signer.sign(ser);
    const siger = signer.sign(ser, { index: 0 });
    const bigBoth = signer.sign(ser, { index: 1, ondex: 2 });
    const currentOnly = signer.sign(ser, { index: 68, only: true });

    assertInstanceOf(cigar, Cigar);
    assertInstanceOf(siger, Siger);
    assertInstanceOf(bigBoth, Siger);
    assertInstanceOf(currentOnly, Siger);
    assertEquals(cigar.verfer?.qb64, signer.verfer.qb64);
    assertEquals(siger.verfer?.qb64, signer.verfer.qb64);
    assertEquals(bigBoth.verfer?.qb64, signer.verfer.qb64);
    assertEquals(currentOnly.verfer?.qb64, signer.verfer.qb64);
    assertEquals(cigar.code, suite.cigarCode);
    assertEquals(siger.code, suite.bothCode);
    assertEquals(bigBoth.code, suite.bigBothCode);
    assertEquals(bigBoth.ondex, 2);
    assertEquals(currentOnly.code, suite.bigCurrentOnlyCode);
    assertEquals(currentOnly.ondex, 68);
    assertEquals(signer.verfer.verify(cigar.raw, ser), true);
    assertEquals(signer.verfer.verify(siger.raw, ser), true);
    assertEquals(signer.verfer.verify(bigBoth.raw, ser), true);
    assertEquals(signer.verfer.verify(currentOnly.raw, ser), true);
  }
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
