import { assert, assertEquals, assertFalse, assertInstanceOf, assertThrows } from "jsr:@std/assert";
import { UnknownCodeError } from "../../../src/core/errors.ts";
import { CIPHER_X25519_VARIABLE_STREAM_CODES, MtrDex } from "../../../src/primitives/codex.ts";
import { Counter } from "../../../src/primitives/counter.ts";
import { Decrypter } from "../../../src/primitives/decrypter.ts";
import { Encrypter } from "../../../src/primitives/encrypter.ts";
import { Prefixer } from "../../../src/primitives/prefixer.ts";
import { Salter } from "../../../src/primitives/salter.ts";
import { Signer } from "../../../src/primitives/signer.ts";
import { Streamer } from "../../../src/primitives/streamer.ts";
import { Texter } from "../../../src/primitives/texter.ts";
import { KERIPY_MATTER_VECTORS } from "../../fixtures/keripy-primitive-vectors.ts";

Deno.test("encrypter: supports raw and verifier-derived X25519 initialization", () => {
  const raw = new Encrypter({
    qb64: KERIPY_MATTER_VECTORS.encrypterX25519,
  });
  assertEquals(raw.qb64, KERIPY_MATTER_VECTORS.encrypterX25519);

  const transferable = new Signer({
    qb64: KERIPY_MATTER_VECTORS.keeperCryptSeedEd25519,
    transferable: true,
  });
  const nonTransferable = new Signer({
    qb64: KERIPY_MATTER_VECTORS.keeperCryptSeedEd25519,
    transferable: false,
  });

  assertEquals(
    new Encrypter({ verkey: transferable.verfer.qb64 }).qb64,
    raw.qb64,
  );
  assertEquals(
    new Encrypter({ verkey: nonTransferable.verfer.qb64b }).qb64,
    raw.qb64,
  );
  assertEquals(
    new Encrypter({
      verkey: new Prefixer({ qb64: transferable.verfer.qb64 }).qb64b,
    }).qb64,
    raw.qb64,
  );
});

Deno.test("encrypter: verifies matching Ed25519 seed material", () => {
  const encrypter = new Encrypter({
    qb64: KERIPY_MATTER_VECTORS.encrypterX25519,
  });

  assert(encrypter.verifySeed(KERIPY_MATTER_VECTORS.keeperCryptSeedEd25519));
  assertFalse(encrypter.verifySeed(KERIPY_MATTER_VECTORS.signerSeedEd25519Vector));
});

Deno.test("encrypter: encrypts raw plaintext, infers signer and salt codes, and round-trips typed primitives", () => {
  const encrypter = new Encrypter({
    qb64: KERIPY_MATTER_VECTORS.encrypterX25519,
  });
  const decrypter = new Decrypter({
    qb64: KERIPY_MATTER_VECTORS.decrypterX25519Private,
  });

  const seedSigner = new Signer({
    qb64: KERIPY_MATTER_VECTORS.signerSeedEd25519Vector,
  });
  const salter = new Salter({ qb64: KERIPY_MATTER_VECTORS.salterFixed });

  const rawCipher = encrypter.encrypt({ ser: "cesr-stream" });
  assert(CIPHER_X25519_VARIABLE_STREAM_CODES.has(rawCipher.code));
  assertEquals(
    decrypter.decrypt({ cipher: rawCipher, bare: true }),
    new TextEncoder().encode("cesr-stream"),
  );

  const seedCipher = encrypter.encrypt({ prim: seedSigner });
  assertEquals(seedCipher.code, MtrDex.X25519_Cipher_Seed);
  assertEquals(
    (decrypter.decrypt({ cipher: seedCipher }) as Signer).qb64,
    seedSigner.qb64,
  );

  const saltCipher = encrypter.encrypt({ prim: salter });
  assertEquals(saltCipher.code, MtrDex.X25519_Cipher_Salt);
  assertEquals(
    (decrypter.decrypt({ cipher: saltCipher }) as Salter).qb64,
    salter.qb64,
  );

  const texter = new Texter({
    raw: new TextEncoder().encode("The quick brown fox jumps over the lazy dog"),
    code: MtrDex.Bytes_L0,
  });
  const qb64Cipher = encrypter.encrypt({
    prim: texter,
    code: MtrDex.X25519_Cipher_QB64_L0,
  });
  assertEquals(
    (decrypter.decrypt({ cipher: qb64Cipher, ctor: Texter }) as Texter).text,
    texter.text,
  );

  const qb2Cipher = encrypter.encrypt({
    prim: texter,
    code: MtrDex.X25519_Cipher_QB2_L0,
  });
  assertEquals(
    (decrypter.decrypt({ cipher: qb2Cipher, ctor: Texter }) as Texter).text,
    texter.text,
  );

  const counter = new Counter({
    code: "-K",
    count: 5,
    version: { major: 2, minor: 0 },
  });
  const counterCipher = encrypter.encrypt({
    prim: counter,
    code: MtrDex.X25519_Cipher_QB64_L0,
  });
  const counterOut = decrypter.decrypt({ cipher: counterCipher, ctor: Counter });
  assertInstanceOf(counterOut, Counter);
  assertEquals(counterOut.qb64, counter.qb64);

  const stream = new Streamer({ stream: new Uint8Array([0x01, 0x02, 0x03, 0x04]) });
  const streamCipher = encrypter.encrypt({
    prim: stream,
    code: MtrDex.X25519_Cipher_L0,
  });
  const streamOut = decrypter.decrypt({ cipher: streamCipher });
  assertInstanceOf(streamOut, Streamer);
  assertEquals(streamOut.stream, stream.stream);
});

Deno.test("encrypter: rejects non-X25519 codes", () => {
  assertThrows(
    () => new Encrypter({ qb64: KERIPY_MATTER_VECTORS.salterFixed }),
    UnknownCodeError,
  );
});
