import { assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { Cipher } from "../../../src/primitives/cipher.ts";
import { MtrDex } from "../../../src/primitives/codex.ts";
import { Decrypter } from "../../../src/primitives/decrypter.ts";
import { Encrypter } from "../../../src/primitives/encrypter.ts";
import { Salter } from "../../../src/primitives/salter.ts";
import { Signer } from "../../../src/primitives/signer.ts";
import { Streamer } from "../../../src/primitives/streamer.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";

function makeParityEncrypter(): Encrypter {
  return new Encrypter({ qb64: KERIPY_MATTER_VECTORS.encrypterX25519 });
}

Deno.test("decrypter: supports raw X25519 private and Ed25519-seed-derived construction", () => {
  const direct = new Decrypter({
    qb64: KERIPY_MATTER_VECTORS.decrypterX25519Private,
  });
  assertEquals(direct.qb64, KERIPY_MATTER_VECTORS.decrypterX25519Private);

  const derived = new Decrypter({
    seed: KERIPY_MATTER_VECTORS.keeperCryptSeedEd25519,
  });
  assertEquals(derived.qb64, direct.qb64);
});

Deno.test("decrypter: decrypts KERIpy stable seed and salt ciphers from cipher, qb64, and qb2 inputs", () => {
  const decrypter = new Decrypter({
    qb64: KERIPY_MATTER_VECTORS.decrypterX25519Private,
  });
  const seedCipher = new Cipher({ qb64: KERIPY_MATTER_VECTORS.cipherSeedVector });
  const saltCipher = new Cipher({ qb64: KERIPY_MATTER_VECTORS.cipherSaltVector });

  const signerFromCipher = decrypter.decrypt({ cipher: seedCipher });
  assertInstanceOf(signerFromCipher, Signer);
  assertEquals(
    signerFromCipher.qb64,
    KERIPY_MATTER_VECTORS.signerSeedEd25519Vector,
  );

  const signerFromQb64 = decrypter.decrypt({
    qb64: KERIPY_MATTER_VECTORS.cipherSeedVector,
  });
  assertInstanceOf(signerFromQb64, Signer);
  assertEquals(signerFromQb64.qb64, signerFromCipher.qb64);

  const signerFromQb2 = decrypter.decrypt({ qb2: seedCipher.qb2 });
  assertInstanceOf(signerFromQb2, Signer);
  assertEquals(signerFromQb2.qb64, signerFromCipher.qb64);

  const salter = decrypter.decrypt({ cipher: saltCipher });
  assertInstanceOf(salter, Salter);
  assertEquals(salter.qb64, KERIPY_MATTER_VECTORS.salterCipherPlain);
});

Deno.test("decrypter: preserves requested signer transferability on fixed seed ciphers", () => {
  const encrypter = makeParityEncrypter();
  const decrypter = new Decrypter({
    qb64: KERIPY_MATTER_VECTORS.decrypterX25519Private,
  });
  const cipher = encrypter.encrypt({
    prim: new Signer({ qb64: KERIPY_MATTER_VECTORS.signerSeedEd25519Vector }),
  });

  const transferable = decrypter.decrypt({ cipher, transferable: true });
  assertInstanceOf(transferable, Signer);
  assertEquals(transferable.verfer.code, MtrDex.Ed25519);

  const nonTransferable = decrypter.decrypt({ cipher, transferable: false });
  assertInstanceOf(nonTransferable, Signer);
  assertEquals(nonTransferable.verfer.code, MtrDex.Ed25519N);
});

Deno.test("decrypter: requires ctor for variable qb64 and qb2 but defaults stream family to Streamer", () => {
  const encrypter = makeParityEncrypter();
  const decrypter = new Decrypter({
    qb64: KERIPY_MATTER_VECTORS.decrypterX25519Private,
  });
  const texter = new Texter({
    raw: new TextEncoder().encode("The quick brown fox jumps over the lazy dog"),
    code: MtrDex.Bytes_L0,
  });
  const qb64Cipher = encrypter.encrypt({
    prim: texter,
    code: MtrDex.X25519_Cipher_QB64_L0,
  });
  const qb2Cipher = encrypter.encrypt({
    prim: texter,
    code: MtrDex.X25519_Cipher_QB2_L0,
  });
  const streamCipher = encrypter.encrypt({
    prim: new Streamer({ stream: new Uint8Array([0xaa, 0xbb, 0xcc]) }),
    code: MtrDex.X25519_Cipher_L0,
  });

  assertThrows(() => decrypter.decrypt({ cipher: qb64Cipher }), UnknownCodeError);
  assertThrows(() => decrypter.decrypt({ cipher: qb2Cipher }), UnknownCodeError);

  const streamer = decrypter.decrypt({ cipher: streamCipher });
  assertInstanceOf(streamer, Streamer);
});

Deno.test("decrypter: rejects non-X25519 private codes", () => {
  assertThrows(
    () => new Decrypter({ qb64: KERIPY_MATTER_VECTORS.encrypterX25519 }),
    UnknownCodeError,
  );
});
