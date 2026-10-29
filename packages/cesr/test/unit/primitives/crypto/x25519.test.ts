import { assert, assertEquals, assertThrows } from "jsr:@std/assert";
import { hexToBytes } from "npm:@noble/hashes@1.8.0/utils";
import { boxPublicKeyFromPrivateKey } from "../../../../src/primitives/crypto/sealed-box.ts";
import { deriveX25519SharedSecret, generateX25519KeyPair } from "../../../../src/primitives/crypto/x25519.ts";

const ALICE = hexToBytes("77076d0a7318a57d3c16c17251b26645df4c2f87ebc0992ab177fba51db92c2a");
const ALICE_PUBLIC = hexToBytes("8520f0098930a754748b7ddcb43ef75a0dbf3a0d26381af4eba4a98eaa9b4e6a");
const BOB = hexToBytes("5dab087e624a8a4b79e17f8b83800ee66f3bb1292618b6fd1c2f8b27ff88e0eb");
const BOB_PUBLIC = hexToBytes("de9edb7d7b7dc1b4d35b61c2ece435373f8343c85b78674dadfc7e146f882b4f");

Deno.test("X25519: existing initialized backend matches RFC 7748 section 6.1", () => {
  assertEquals(boxPublicKeyFromPrivateKey(ALICE), ALICE_PUBLIC);
  assertEquals(boxPublicKeyFromPrivateKey(BOB), BOB_PUBLIC);
  const expected = hexToBytes("4a5d9d5ba4ce2de1728e3bf480350f25e07e21c947d19e3376f09b3c1e161742");
  assertEquals(deriveX25519SharedSecret(ALICE, BOB_PUBLIC), expected);
  assertEquals(deriveX25519SharedSecret(BOB, ALICE_PUBLIC), expected);
});

Deno.test("X25519: fresh pairs agree and invalid or low-order peer keys fail", () => {
  const first = generateX25519KeyPair();
  const second = generateX25519KeyPair();
  assertEquals(first.publicKey, boxPublicKeyFromPrivateKey(first.privateKey));
  const agreed = deriveX25519SharedSecret(first.privateKey, second.publicKey);
  assertEquals(agreed, deriveX25519SharedSecret(second.privateKey, first.publicKey));
  assert(agreed.some((byte) => byte !== 0));
  for (const point of [new Uint8Array(32), Uint8Array.of(1, ...new Uint8Array(31))]) {
    assertThrows(() => deriveX25519SharedSecret(ALICE, point));
  }
  assertThrows(() => deriveX25519SharedSecret(ALICE.subarray(1), BOB_PUBLIC), TypeError);
  assertThrows(() => deriveX25519SharedSecret(ALICE, BOB_PUBLIC.subarray(1)), TypeError);
});
