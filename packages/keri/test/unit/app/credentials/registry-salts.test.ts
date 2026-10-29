import { Matter, MtrDex, Salter } from "cesr-ts";
import { assert, assertEquals, assertNotEquals, assertThrows } from "jsr:@std/assert";
import { bytesToHex, hexToBytes } from "npm:@noble/hashes@1.8.0/utils";
import { commitment, deriveRoot, generateKeypair } from "../../../../src/app/credentials/registry-salts.ts";
import vectors from "../../../fixtures/registry-salt-vectors-23f526b4.json" with { type: "json" };

const encoder = new TextEncoder();
const alice = new Matter({ raw: hexToBytes(vectors.rfc7748.alicePrivate), code: MtrDex.X25519_Private });
const alicePublic = new Matter({ raw: hexToBytes(vectors.rfc7748.alicePublic), code: MtrDex.X25519 });
const bob = new Matter({ raw: hexToBytes(vectors.rfc7748.bobPrivate), code: MtrDex.X25519_Private });
const bobPublic = new Matter({ raw: hexToBytes(vectors.rfc7748.bobPublic), code: MtrDex.X25519 });

Deno.test("registry salts: matches Python's primitive-only KDF boundary vector", () => {
  // Deliberately invalid reply bytes, kept distinct from the valid signed wire fixtures.
  const init = encoder.encode("{\"d\":\"init-said\",\"r\":\"/rnd/registry-salt/init\",\"a\":{\"nonce\":\"alice\"}}");
  const bind = encoder.encode("{\"d\":\"bind-said\",\"r\":\"/rnd/registry-salt/bind\",\"a\":{\"init\":\"init-said\"}}");
  const root = deriveRoot(alice, bobPublic, init, bind);
  assertEquals(bytesToHex(root.raw), "c6ab3018975c57c71b4a7cc3dfdf8963");
  assertEquals(root.code, MtrDex.Salt_128);
  assertEquals(
    bytesToHex(commitment(root, init, bind).raw),
    "b26b7caa16979162b61ff79a64be938bcc5c4a372d36283b614670acd7404c99",
  );
  assertEquals(commitment(root, init, bind).code, MtrDex.SHA2_256);
});

for (const [direction, vector] of Object.entries(vectors.cases)) {
  Deno.test(`registry salts: exact Python signed ${direction}-initiated bodies derive the same root`, () => {
    const init = encoder.encode(vector.messages[0].body.utf8);
    const bind = encoder.encode(vector.messages[1].body.utf8);
    const root = deriveRoot(alice, bobPublic, init, bind);
    assertEquals(root.qb64, vector.kdf.rootQb64);
    assertEquals(bytesToHex(root.raw), vector.kdf.rootHex);
    assertEquals(deriveRoot(bob.qb64, alicePublic.qb64b, init, bind).qb64, root.qb64);
    assertEquals(commitment(root, init, bind).qb64, vector.kdf.commitment);
    for (
      const [changedInit, changedBind] of [
        [new Uint8Array([...init, 32]), bind],
        [init, new Uint8Array([...bind, 32])],
        [bind, init],
        [init.subarray(0, init.length - 1), new Uint8Array([init[init.length - 1], ...bind])],
      ]
    ) {
      assertNotEquals(deriveRoot(alice, bobPublic, changedInit, changedBind).qb64, root.qb64);
      assertNotEquals(commitment(root, changedInit, changedBind).qb64, vector.kdf.commitment);
    }
    assertNotEquals(deriveRoot(alice, alicePublic, init, bind).qb64, root.qb64);
  });
}

Deno.test("registry salts: exact qualified codes, full text and byte inputs fail closed", () => {
  const init = encoder.encode("init"), bind = encoder.encode("bind");
  const expected = deriveRoot(alice, bobPublic, init, bind).qb64;
  assertEquals(deriveRoot(alice.qb64b, bobPublic.qb64, init, bind).qb64, expected);
  const seed = new Matter({ raw: alice.raw, code: MtrDex.Ed25519_Seed });
  const verifier = new Matter({ raw: bobPublic.raw, code: MtrDex.Ed25519 });
  for (
    const [privateKey, publicKey] of [
      [seed, bobPublic],
      [alice, verifier],
      [bobPublic, alice],
      [alice.qb64.slice(0, -1), bobPublic],
      [alice.qb64 + "AAAA", bobPublic],
      [alice, bobPublic.qb64.slice(0, -1)],
      [alice, bobPublic.qb64 + "AAAA"],
      [alice.qb64.slice(0, -1) + "!", bobPublic],
      [alice, ""],
    ] as const
  ) {
    const error = assertThrows(() => deriveRoot(privateKey, publicKey, init, bind));
    assert(error instanceof Error);
    assert(!error.message.includes(alice.qb64));
    assert(!error.message.includes(bytesToHex(alice.raw)));
  }
  for (const raw of [new Uint8Array(32), Uint8Array.of(1, ...new Uint8Array(31))]) {
    assertThrows(() => deriveRoot(alice, new Matter({ raw, code: MtrDex.X25519 }), init, bind));
  }
  // Exercise runtime boundaries without weakening the public typed contract.
  assertThrows(() => deriveRoot(null as unknown as Matter, bobPublic, init, bind), TypeError);
  assertThrows(() => deriveRoot(alice, bobPublic, "init" as unknown as Uint8Array, bind), TypeError);
  assertThrows(() => commitment(alice as unknown as Salter, init, bind), TypeError);
});

Deno.test("registry salts: generation qualifies distinct bilateral keypairs", () => {
  const [publicKey, privateKey] = generateKeypair();
  const [otherPublic, otherPrivate] = generateKeypair();
  assertEquals(publicKey.code, MtrDex.X25519);
  assertEquals(privateKey.code, MtrDex.X25519_Private);
  assertNotEquals(publicKey.qb64, otherPublic.qb64);
  assertNotEquals(privateKey.qb64, otherPrivate.qb64);
  const init = encoder.encode("init"), bind = encoder.encode("bind");
  assertEquals(
    deriveRoot(privateKey, otherPublic, init, bind).qb64,
    deriveRoot(otherPrivate, publicKey, init, bind).qb64,
  );
});
