/** pysodium/KERIpy byte-parity for every primitive seam in cesr that libsodium once backed.
 *
 * Vectors come from `packages/cesr/scripts/reference-sodium-parity-vectors.py`.
 * Medium/high-memory Argon2id vectors run in `scripts/qualify-salter-derivation.ts`.
 */
import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { MtrDex } from "../../../../src/primitives/base/codex.ts";
import { Decrypter } from "../../../../src/primitives/crypto/decrypter.ts";
import { Encrypter } from "../../../../src/primitives/crypto/encrypter.ts";
import { Salter } from "../../../../src/primitives/crypto/salter.ts";
import {
  boxKeyPairFromEd25519Seed,
  boxPublicKeyFromEd25519Verfer,
  boxPublicKeyFromPrivateKey,
  openSealedBox,
  sealBox,
  sealBoxWithEphemeral,
} from "../../../../src/primitives/crypto/sealed-box.ts";
import { Signer } from "../../../../src/primitives/crypto/signer.ts";
import { x25519PublicKey, x25519SharedSecret } from "../../../../src/primitives/crypto/x25519.ts";
import vectors from "../../../fixtures/sodium-parity-vectors.json" with { type: "json" };

export function hex(text: string): Uint8Array {
  return text.length ? Uint8Array.from(text.match(/../g)!, (n) => parseInt(n, 16)) : new Uint8Array(0);
}

Deno.test("sodium parity: Ed25519 seed keypair and X25519 conversions match pysodium", () => {
  for (const v of vectors.ed25519_to_x25519) {
    const seed = hex(v.seed);
    assertEquals(new Signer({ raw: seed, code: MtrDex.Ed25519_Seed }).verfer.raw, hex(v.ed25519_pk));
    assertEquals(boxPublicKeyFromEd25519Verfer(hex(v.ed25519_pk)), hex(v.x25519_pk));
    const pair = boxKeyPairFromEd25519Seed(seed);
    assertEquals(pair.publicKey, hex(v.x25519_pk));
    assertEquals(pair.privateKey, hex(v.x25519_sk));
    assertEquals(boxPublicKeyFromPrivateKey(pair.privateKey), hex(v.x25519_pk));
  }
});

Deno.test("sodium parity: raw X25519 derivation, agreement and low-order rejection match pysodium", () => {
  const publics = new Map(vectors.x25519.public_keys.map((v) => [v.scalar, hex(v.public)]));
  for (const v of vectors.x25519.public_keys) assertEquals(x25519PublicKey(hex(v.scalar)), hex(v.public));
  for (const v of vectors.x25519.agreements) {
    assertEquals(x25519SharedSecret(hex(v.a), publics.get(v.b)!), hex(v.shared));
    assertEquals(x25519SharedSecret(hex(v.b), publics.get(v.a)!), hex(v.shared));
  }
  const scalar = hex(vectors.x25519.public_keys[0].scalar);
  for (const v of vectors.x25519.low_order_peers) {
    assertEquals(v.rejects, true);
    assertEquals(x25519SharedSecret(scalar, hex(v.public)), null, `low-order ${v.public}`);
  }
});

Deno.test("sodium parity: opens pysodium sealed boxes and rejects tampering", () => {
  const keys = new Map(vectors.ed25519_to_x25519.map((v) => [v.seed, v]));
  for (const v of [...vectors.sealed_boxes, ...vectors.deterministic_sealed_boxes]) {
    const key = keys.get(v.recipient_seed)!;
    const ciphertext = hex(v.ciphertext);
    assertEquals(openSealedBox(ciphertext, hex(key.x25519_pk), hex(key.x25519_sk)), hex(v.plaintext), v.name);
    assertEquals(new Decrypter({ raw: hex(key.x25519_sk) }).open(ciphertext), hex(v.plaintext), v.name);
    const tampered = ciphertext.slice();
    tampered[tampered.length - 1] ^= 1;
    assertEquals(openSealedBox(tampered, hex(key.x25519_pk), hex(key.x25519_sk)), null, v.name);
  }
});

Deno.test("sodium parity: fixed-ephemeral sealed-box construction is byte-identical to libsodium", () => {
  const keys = new Map(vectors.ed25519_to_x25519.map((v) => [v.seed, v]));
  for (const v of vectors.deterministic_sealed_boxes) {
    const key = keys.get(v.recipient_seed)!;
    assertEquals(x25519PublicKey(hex(v.ephemeral_sk)), hex(v.ephemeral_pk));
    assertEquals(
      sealBoxWithEphemeral(hex(v.plaintext), hex(key.x25519_pk), hex(v.ephemeral_sk)),
      hex(v.ciphertext),
      v.name,
    );
  }
});

Deno.test("sodium parity: sealed boxes produced here open with the same keys and have libsodium framing", () => {
  for (const key of vectors.ed25519_to_x25519) {
    for (const v of vectors.sealed_boxes.filter((s) => s.recipient_seed === key.seed)) {
      const ciphertext = sealBox(hex(v.plaintext), hex(key.x25519_pk));
      assertEquals(ciphertext.length, hex(v.plaintext).length + 48);
      assertNotEquals(ciphertext, hex(v.ciphertext)); // fresh ephemeral key
      assertEquals(openSealedBox(ciphertext, hex(key.x25519_pk), hex(key.x25519_sk)), hex(v.plaintext));
    }
  }
});

Deno.test("sodium parity: qualified Encrypter/Decrypter/Cipher match KERIpy", () => {
  for (const v of vectors.qualified) {
    const encrypter = new Encrypter({ verkey: v.verfer_qb64 });
    assertEquals(encrypter.qb64, v.encrypter_qb64);
    assertEquals(encrypter.verifySeed(v.signer_qb64), true);
    const decrypter = new Decrypter({ seed: v.signer_qb64 });
    assertEquals(decrypter.qb64, v.decrypter_qb64);
    for (const [name, c] of Object.entries(v.ciphers)) {
      assertEquals(decrypter.decrypt({ qb64: c.cipher_qb64, bare: true }), hex(c.plaintext!), name);
    }
  }
});

for (const v of vectors.argon2id.cases.filter((c) => c.mode === "temp" || c.mode === "low")) {
  Deno.test(`sodium parity: KERIpy Salter.stretch ${v.mode} path ${JSON.stringify(v.path)} size ${v.size}`, () => {
    const salter = new Salter({ raw: hex(vectors.argon2id.salt), code: MtrDex.Salt_128 });
    assertEquals(salter.stretch({ path: v.path, size: v.size, temp: v.mode === "temp" }), hex(v.hex));
  });
}
