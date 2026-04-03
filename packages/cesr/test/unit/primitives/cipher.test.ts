import { assert, assertEquals, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { DeserializeError, UnknownCodeError } from "../../../src/core/errors.ts";
import { Cipher } from "../../../src/primitives/cipher.ts";
import { CIPHER_X25519_VARIABLE_STREAM_CODES, CiXDex, MtrDex } from "../../../src/primitives/codex.ts";
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

function makeParityDecrypter(): Decrypter {
  return new Decrypter({ qb64: KERIPY_MATTER_VECTORS.decrypterX25519Private });
}

Deno.test("cipher: exposes KERIpy codex attributes and hydrates stable vectors", () => {
  assertEquals(Cipher.Codex, CiXDex);
  assertEquals(Cipher.Codes.X25519_Cipher_Seed, MtrDex.X25519_Cipher_Seed);
  assertEquals(Cipher.Codes.X25519_Cipher_Salt, MtrDex.X25519_Cipher_Salt);

  const cipher = new Cipher({ qb64: KERIPY_MATTER_VECTORS.cipherSeedVector });
  assertEquals(cipher.code, MtrDex.X25519_Cipher_Seed);
});

Deno.test("cipher: infers fixed seed and salt codes from raw ciphertext size", () => {
  const encrypter = makeParityEncrypter();
  const seedCipher = encrypter.encrypt({
    prim: new Signer({ qb64: KERIPY_MATTER_VECTORS.signerSeedEd25519Vector }),
  });
  const saltCipher = encrypter.encrypt({
    prim: new Salter({ qb64: KERIPY_MATTER_VECTORS.salterFixed }),
  });

  assertEquals(new Cipher({ raw: seedCipher.raw }).code, MtrDex.X25519_Cipher_Seed);
  assertEquals(new Cipher({ raw: saltCipher.raw }).code, MtrDex.X25519_Cipher_Salt);

  assertThrows(
    () => new Cipher({ raw: seedCipher.raw.slice(1) }),
    DeserializeError,
  );
  assertThrows(
    () =>
      new Cipher({
        raw: new Uint8Array([...saltCipher.raw, 0x00]),
      }),
    DeserializeError,
  );
});

Deno.test("cipher: normalizes variable-family codes from raw size like KERIpy Matter", () => {
  assertEquals(
    new Cipher({ raw: new Uint8Array(108), code: MtrDex.X25519_Cipher_QB64_L0 }).code,
    MtrDex.X25519_Cipher_QB64_L0,
  );
  assertEquals(
    new Cipher({ raw: new Uint8Array(116), code: MtrDex.X25519_Cipher_QB64_L0 }).code,
    MtrDex.X25519_Cipher_QB64_L1,
  );
  assertEquals(
    new Cipher({ raw: new Uint8Array(112), code: MtrDex.X25519_Cipher_QB64_L0 }).code,
    MtrDex.X25519_Cipher_QB64_L2,
  );
  assertEquals(
    new Cipher({ raw: new Uint8Array(12696), code: MtrDex.X25519_Cipher_L0 }).code,
    MtrDex.X25519_Cipher_Big_L0,
  );
  assertEquals(
    new Cipher({ raw: new Uint8Array(12696), code: MtrDex.X25519_Cipher_QB64_L0 }).code,
    MtrDex.X25519_Cipher_QB64_Big_L0,
  );
  assertEquals(
    new Cipher({ raw: new Uint8Array(12696), code: MtrDex.X25519_Cipher_QB2_L0 }).code,
    MtrDex.X25519_Cipher_QB2_Big_L0,
  );
});

Deno.test("cipher: decrypts KERIpy stable seed and salt vectors via prikey and seed", () => {
  const decrypter = makeParityDecrypter();
  const seedCipher = new Cipher({ qb64: KERIPY_MATTER_VECTORS.cipherSeedVector });
  const saltCipher = new Cipher({ qb64: KERIPY_MATTER_VECTORS.cipherSaltVector });

  const signerFromPrikey = seedCipher.decrypt({
    prikey: KERIPY_MATTER_VECTORS.decrypterX25519Private,
  });
  assertInstanceOf(signerFromPrikey, Signer);
  assertEquals(
    signerFromPrikey.qb64,
    KERIPY_MATTER_VECTORS.signerSeedEd25519Vector,
  );
  assertEquals(
    seedCipher.decrypt({
      prikey: KERIPY_MATTER_VECTORS.decrypterX25519Private,
      bare: true,
    }),
    signerFromPrikey.qb64b,
  );

  const signerFromSeed = seedCipher.decrypt({
    seed: KERIPY_MATTER_VECTORS.keeperCryptSeedEd25519,
  });
  assertInstanceOf(signerFromSeed, Signer);
  assertEquals(signerFromSeed.qb64, signerFromPrikey.qb64);

  const salterFromPrikey = saltCipher.decrypt({
    prikey: decrypter.qb64,
  });
  assertInstanceOf(salterFromPrikey, Salter);
  assertEquals(salterFromPrikey.qb64, KERIPY_MATTER_VECTORS.salterCipherPlain);
  assertEquals(
    saltCipher.decrypt({ seed: KERIPY_MATTER_VECTORS.keeperCryptSeedEd25519, bare: true }),
    salterFromPrikey.qb64b,
  );
});

Deno.test("cipher: requires ctor for variable qb64 and qb2 ciphers but defaults stream ciphers to Streamer", () => {
  const encrypter = makeParityEncrypter();
  const decrypter = makeParityDecrypter();

  const texter = new Texter({
    raw: new TextEncoder().encode("The quick brown fox jumps over the lazy dogcats"),
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
  const streamer = new Streamer({ stream: new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x01]) });
  const streamCipher = encrypter.encrypt({
    prim: streamer,
    code: MtrDex.X25519_Cipher_L0,
  });

  assertThrows(
    () => decrypter.decrypt({ cipher: qb64Cipher }),
    UnknownCodeError,
  );
  assertThrows(
    () => decrypter.decrypt({ cipher: qb2Cipher }),
    UnknownCodeError,
  );

  const qb64Out = decrypter.decrypt({ cipher: qb64Cipher, ctor: Texter });
  assertInstanceOf(qb64Out, Texter);
  assertEquals(qb64Out.text, texter.text);
  assertEquals(
    decrypter.decrypt({ cipher: qb64Cipher, ctor: Texter, bare: true }),
    texter.qb64b,
  );

  const qb2Out = decrypter.decrypt({ cipher: qb2Cipher, ctor: Texter });
  assertInstanceOf(qb2Out, Texter);
  assertEquals(qb2Out.text, texter.text);
  assertEquals(
    decrypter.decrypt({ cipher: qb2Cipher, ctor: Texter, bare: true }),
    texter.qb2,
  );

  assert(CIPHER_X25519_VARIABLE_STREAM_CODES.has(streamCipher.code));
  const streamOut = decrypter.decrypt({ cipher: streamCipher });
  assertInstanceOf(streamOut, Streamer);
  assertEquals(streamOut.stream, streamer.stream);
});

Deno.test("cipher: rejects non-cipher code families", () => {
  assertThrows(
    () => new Cipher({ qb64: KERIPY_MATTER_VECTORS.signerSeedR1 }),
    UnknownCodeError,
  );
});
