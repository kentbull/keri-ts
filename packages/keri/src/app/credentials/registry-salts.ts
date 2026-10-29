/**
 * Pure root derivation for the local registry-salt/1 profile, not a KERI standard.
 * Source: https://github.com/kentbull/keripy/blob/23f526b49be5d9b03606f1563ad59958c5ab1adc/src/keri/app/registry_salts.py
 * X25519: https://www.rfc-editor.org/rfc/rfc7748#section-6.1
 * HKDF: https://www.rfc-editor.org/rfc/rfc5869
 * Callers authenticate the exact ordered reply bodies and representative
 * authorization before deriving. Never parse and reserialize those body bytes.
 */
import {
  bytesEqual,
  concatBytes,
  deriveX25519SharedSecret,
  Diger,
  generateX25519KeyPair,
  Matter,
  MtrDex,
  Salter,
} from "cesr-ts";
import { hkdf } from "npm:@noble/hashes@1.8.0/hkdf";
import { sha256 } from "npm:@noble/hashes@1.8.0/sha2";

/** One existing CESR primitive or its complete qualified text/ASCII bytes. */
export type RegistrySaltKey = Matter | string | Uint8Array;
const encoder = new TextEncoder();
const TRANSCRIPT = encoder.encode("keri-rnd/registry-salt/1/transcript\0");
const INFO = encoder.encode("keri-rnd/registry-salt/1/root");
const COMMITMENT = encoder.encode("keri-rnd/registry-salt/1/commitment\0");

/** Read one exact qualified key and reject unsupported inputs without exposing material in errors. */
function key(material: RegistrySaltKey, code: string): Matter {
  let parsed: Matter;
  if (material instanceof Matter) parsed = material;
  else if (typeof material === "string" || material instanceof Uint8Array) {
    try {
      const encoded = typeof material === "string" ? encoder.encode(material) : material;
      parsed = new Matter({ qb64b: encoded });
      if (!bytesEqual(parsed.qb64b, encoded)) throw new Error();
    } catch {
      throw new Error("Invalid qualified registry-salt key");
    }
  } else throw new TypeError("Registry-salt keys must be Matter or qualified text/bytes");
  if (parsed.code !== code || parsed.raw.length !== 32) {
    throw new Error("Incorrect registry-salt key code or length");
  }
  return parsed;
}

/** Encode LP(init) || LP(bind) using unsigned 32-bit big-endian byte lengths. */
function bodies(init: Uint8Array, bind: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = [];
  for (const body of [init, bind]) {
    if (!(body instanceof Uint8Array)) throw new TypeError("Registry-salt reply bodies must be exact bytes");
    if (body.byteLength > 0xffffffff) throw new RangeError("Registry-salt reply body exceeds uint32 length");
    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, body.byteLength, false);
    chunks.push(length, body);
  }
  return concatBytes(...chunks);
}

/**
 * Return fresh [public, private] CESR Matter keys for one negotiation.
 * Codes are X25519 and X25519_Private. Existing Matter inspection can expose
 * material: never log the private primitive or its raw/qb64 properties. This
 * helper supplies no storage or lifecycle policy. Backend failures propagate.
 */
export function generateKeypair(): readonly [publicKey: Matter, privateKey: Matter] {
  const pair = generateX25519KeyPair();
  return [
    new Matter({ raw: pair.publicKey, code: MtrDex.X25519 }),
    new Matter({ raw: pair.privateKey, code: MtrDex.X25519_Private }),
  ];
}

/**
 * Derive a Salt_128 Salter from exact authenticated init then bind body bytes.
 * privateKey and remotePublic are complete qualified keys with their exact
 * private/public CESR codes. Both peers use the same body order. Invalid keys,
 * low-order agreement, non-byte bodies and oversized LP inputs throw; backend
 * failures propagate. This verifies neither signatures nor caller authorization.
 */
export function deriveRoot(
  privateKey: RegistrySaltKey,
  remotePublic: RegistrySaltKey,
  init: Uint8Array,
  bind: Uint8Array,
): Salter {
  const local = key(privateKey, MtrDex.X25519_Private);
  const remote = key(remotePublic, MtrDex.X25519);
  const transcript = concatBytes(TRANSCRIPT, bodies(init, bind));
  const shared = deriveX25519SharedSecret(local.raw, remote.raw);
  try {
    return new Salter({ raw: hkdf(sha256, shared, sha256(transcript), INFO, 16), code: MtrDex.Salt_128 });
  } finally {
    shared.fill(0); // Release this owned temporary; no process-wide erasure guarantee.
  }
}

/**
 * Return the SHA2_256 Diger confirming root and the same exact ordered bodies.
 * root must be a 16-byte Salt_128 Salter. Invalid root/bodies throw. A later
 * issuer confirmation carries this commitment; computing it authenticates nobody.
 */
export function commitment(root: Salter, init: Uint8Array, bind: Uint8Array): Diger {
  if (!(root instanceof Salter) || root.code !== MtrDex.Salt_128 || root.raw.length !== 16) {
    throw new TypeError("Registry-salt commitment requires a Salt_128 Salter");
  }
  return new Diger({
    raw: Diger.digest(concatBytes(COMMITMENT, bodies(init, bind), root.raw), MtrDex.SHA2_256),
    code: MtrDex.SHA2_256,
  });
}
