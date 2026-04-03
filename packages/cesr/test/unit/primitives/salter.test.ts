import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Tiers } from "../../../src/core/vocabulary.ts";
import { MtrDex } from "../../../src/primitives/codex.ts";
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

Deno.test("salter: stretch is deterministic for the same path and distinct for different paths", () => {
  const salter = new Salter({
    qb64: KERIPY_MATTER_VECTORS.salterFixed,
    tier: Tiers.low,
  });

  const first = salter.stretch({ path: "a", size: 32, temp: true });
  const second = salter.stretch({ path: "a", size: 32, temp: true });
  const third = salter.stretch({ path: "b", size: 32, temp: true });

  assertEquals(first, second);
  assertEquals(
    Array.from(first).join(",") === Array.from(third).join(","),
    false,
  );
});

Deno.test("salter: signer derives an executable Ed25519 signer", () => {
  const salter = new Salter({
    qb64: KERIPY_MATTER_VECTORS.salterFixed,
    tier: Tiers.low,
  });
  const signer = salter.signer({
    code: MtrDex.Ed25519_Seed,
    transferable: false,
    path: "01",
    temp: true,
  });
  const ser = new TextEncoder().encode("salter-signer");
  const cigar = signer.sign(ser);

  assertEquals(signer.verfer.code, MtrDex.Ed25519N);
  assertEquals(cigar.verfer?.qb64, signer.verfer.qb64);
  assertEquals(signer.verfer.verify(cigar.raw, ser), true);
});

Deno.test("salter: signers uses hex-suffixed path progression and supports code lists", () => {
  const salter = new Salter({
    qb64: KERIPY_MATTER_VECTORS.salterFixed,
    tier: Tiers.low,
  });
  const same = salter.signers({
    count: 2,
    start: 1,
    path: "stem",
    code: MtrDex.Ed25519_Seed,
    temp: true,
  });
  const mixed = salter.signers({
    start: 1,
    path: "stem",
    codes: [MtrDex.Ed25519_Seed, MtrDex.ECDSA_256k1_Seed],
    temp: true,
  });

  assertEquals(same.length, 2);
  assertEquals(same[0].qb64 === same[1].qb64, false);
  assertEquals(
    salter.signer({
      code: MtrDex.Ed25519_Seed,
      path: "stem1",
      temp: true,
    }).qb64,
    same[0].qb64,
  );
  assertEquals(mixed[0].code, MtrDex.Ed25519_Seed);
  assertEquals(mixed[1].code, MtrDex.ECDSA_256k1_Seed);
});
