import { assertEquals, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Cigar } from "../../../src/primitives/cigar.ts";
import { IdrDex, MtrDex } from "../../../src/primitives/codex.ts";
import { parseSiger, Siger } from "../../../src/primitives/siger.ts";
import { Signer } from "../../../src/primitives/signer.ts";
import { KERIPY_INDEXER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";
import { assertTxtBnyQb64Parity, txt } from "../../fixtures/primitive-test-helpers.ts";

Deno.test("siger: parses KERIpy siger vector", () => {
  const siger = parseSiger(txt(KERIPY_INDEXER_VECTORS.sigerSample), "txt");
  assertEquals(siger.qb64, KERIPY_INDEXER_VECTORS.sigerSample);
  assertEquals(siger.verfer, undefined);
});

Deno.test("siger: txt/qb2 parity", () => {
  const { txtValue, bnyValue } = assertTxtBnyQb64Parity(
    KERIPY_INDEXER_VECTORS.sigerSample,
    parseSiger,
  );
  assertEquals(txtValue.index, bnyValue.index);
});

Deno.test("siger: constructor preserves signature raw through qb64 roundtrip", () => {
  const src = new Siger({ qb64: KERIPY_INDEXER_VECTORS.sigerSample });
  const rebuilt = new Siger({ qb64: src.qb64 });
  assertEquals(rebuilt.qb64, src.qb64);
  assertEquals(rebuilt.raw, src.raw);
});

Deno.test("siger: fromCigar derives suite-correct indexed signature codes from verifier context", () => {
  const ser = new TextEncoder().encode("keri-ts-siger-from-cigar");
  const suites = [
    {
      signerCode: MtrDex.Ed25519_Seed,
      bothCode: IdrDex.Ed25519_Sig,
      bigBothCode: IdrDex.Ed25519_Big_Sig,
      bigCurrentOnlyCode: IdrDex.Ed25519_Big_Crt_Sig,
      seedFill: 11,
    },
    {
      signerCode: MtrDex.ECDSA_256k1_Seed,
      bothCode: IdrDex.ECDSA_256k1_Sig,
      bigBothCode: IdrDex.ECDSA_256k1_Big_Sig,
      bigCurrentOnlyCode: IdrDex.ECDSA_256k1_Big_Crt_Sig,
      seedFill: 12,
    },
    {
      signerCode: MtrDex.ECDSA_256r1_Seed,
      bothCode: IdrDex.ECDSA_256r1_Sig,
      bigBothCode: IdrDex.ECDSA_256r1_Big_Sig,
      bigCurrentOnlyCode: IdrDex.ECDSA_256r1_Big_Crt_Sig,
      seedFill: 13,
    },
  ] as const;

  for (const suite of suites) {
    const signer = new Signer({
      code: suite.signerCode,
      raw: new Uint8Array(32).fill(suite.seedFill),
      transferable: false,
    });
    const cigar = signer.sign(ser) as Cigar;

    const both = Siger.fromCigar(cigar, { index: 0 });
    const bigBoth = Siger.fromCigar(cigar, { index: 1, ondex: 2 });
    const currentOnly = Siger.fromCigar(cigar, { index: 68, only: true });

    assertEquals(both.code, suite.bothCode);
    assertEquals(bigBoth.code, suite.bigBothCode);
    assertEquals(bigBoth.ondex, 2);
    assertEquals(currentOnly.code, suite.bigCurrentOnlyCode);
    assertEquals(currentOnly.ondex, 68);
    assertEquals(both.verfer?.qb64, signer.verfer.qb64);
    assertEquals(bigBoth.verfer?.qb64, signer.verfer.qb64);
    assertEquals(currentOnly.verfer?.qb64, signer.verfer.qb64);
    assertEquals(both.raw, cigar.raw);
  }
});

Deno.test("siger: fromCigar requires verifier context", () => {
  const cigar = new Cigar({
    code: MtrDex.Ed25519_Sig,
    raw: new Uint8Array(64),
  });

  assertThrows(
    () => Siger.fromCigar(cigar, { index: 0 }),
    Error,
    "verifier context",
  );
});

Deno.test("siger: rejects non-signature indexer families", () => {
  assertThrows(
    () => parseSiger(txt(KERIPY_INDEXER_VECTORS.tbd0Label), "txt"),
    UnknownCodeError,
  );
});
