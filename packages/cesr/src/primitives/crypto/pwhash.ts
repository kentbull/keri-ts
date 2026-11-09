import { createArgon2 } from "npm:@keri-ts/hash-wasm@4.14.0";

// Instantiating WebAssembly is the only asynchronous step, so it happens once when
// this module initializes and every derivation after that is synchronous.
const hasher = await createArgon2();

const MAX_LENGTH = 0x7fffffff;

/** Derive Argon2id13 bytes; the caller owns the returned array.
 *
 * Tier policy belongs to Salter. The shared hasher keeps its WebAssembly memory at
 * the largest size used so far and does not erase input or derived bytes from it.
 */
export function deriveArgon2id(
  password: Uint8Array,
  salt: Uint8Array,
  size: number,
  operations: number,
  memoryBytes: number,
): Uint8Array {
  if (!Number.isSafeInteger(size) || size < 16 || size > MAX_LENGTH) {
    throw new RangeError("Argon2id output size must be an integer from 16 through 2147483647");
  }
  if (
    !(password instanceof Uint8Array) || password.length > MAX_LENGTH
    || !(salt instanceof Uint8Array) || salt.length !== 16
    || !Number.isSafeInteger(operations) || operations < 1 || operations > MAX_LENGTH
    || !Number.isSafeInteger(memoryBytes) || memoryBytes < 8192 || memoryBytes > MAX_LENGTH
  ) {
    throw new RangeError("Invalid Argon2id input");
  }
  return hasher.argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: operations,
    // libsodium's crypto_pwhash truncates to whole KiB the same way.
    memorySize: Math.floor(memoryBytes / 1024),
    hashLength: size,
    outputType: "binary",
  });
}
