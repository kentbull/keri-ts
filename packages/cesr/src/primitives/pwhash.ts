import sodium from "./sodium.ts";

/** The pinned libsodium-sumo 0.8.4 Emscripten wasm32 ABI, not a public provider interface.
 * The wrapper's crypto_pwhash allocates/free without wiping its output. Own these
 * three allocations explicitly so derived seeds do not remain in that freed range.
 */
interface PwhashModule {
  HEAPU8: Uint8Array;
  _malloc(length: number): number;
  _free(address: number): void;
  _crypto_pwhash(
    output: number,
    outputLengthLow: number,
    outputLengthHigh: number,
    password: number,
    passwordLengthLow: number,
    passwordLengthHigh: number,
    salt: number,
    operationsLow: number,
    operationsHigh: number,
    memoryBytes: number,
    algorithm: number,
  ): number;
}

/** Derive Argon2id13 bytes with owned wasm32 buffers; caller owns the returned JS bytes.
 * Tier policy belongs to Salter. WASM's high-water capacity is not reduced by free;
 * this erases the owned input/output ranges, not arbitrary JS or native temporaries.
 */
export function deriveArgon2id(
  password: Uint8Array,
  salt: Uint8Array,
  size: number,
  operations: number,
  memoryBytes: number,
): Uint8Array {
  const max = 0x7fffffff;
  if (!Number.isSafeInteger(size) || size < 16 || size > max) {
    throw new RangeError("Argon2id output size must be an integer from 16 through 2147483647");
  }
  if (
    !(password instanceof Uint8Array) || password.length > max
    || !(salt instanceof Uint8Array) || salt.length !== 16
    || !Number.isSafeInteger(operations) || operations < 1 || operations > max
    || !Number.isSafeInteger(memoryBytes) || memoryBytes < 8192 || memoryBytes > max
  ) {
    throw new RangeError("Invalid Argon2id wasm32 input");
  }
  const native = (sodium as unknown as { libsodium: PwhashModule }).libsodium;
  const owned: Array<{ address: number; length: number }> = [];
  const allocate = (length: number): number => {
    // Empty paths still own one initialized byte, while the C password length stays zero.
    const bytes = Math.max(1, length);
    const address = native._malloc(bytes);
    if (!address) throw new Error("Argon2id allocation failed");
    owned.push({ address, length: bytes });
    return address;
  };
  let result: Uint8Array | undefined;
  let failed = false, failure: unknown;
  try {
    const output = allocate(size), path = allocate(password.length), saltAddress = allocate(salt.length);
    // Any allocation, and crypto_pwhash itself, may grow memory and replace HEAPU8.
    native.HEAPU8.fill(0, path, path + Math.max(1, password.length));
    native.HEAPU8.set(password, path);
    native.HEAPU8.set(salt, saltAddress);
    const status = native._crypto_pwhash(
      output,
      size,
      0,
      path,
      password.length,
      0,
      saltAddress,
      operations,
      0,
      memoryBytes,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    if (status !== 0) throw new Error("Argon2id derivation failed");
    result = native.HEAPU8.slice(output, output + size);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    for (const { address, length } of owned.reverse()) {
      try {
        native.HEAPU8.fill(0, address, address + length);
        native._free(address);
      } catch (error) {
        // One failed release must not skip the other owned buffers.
        if (!failed) failure = error;
        failed = true;
      }
    }
  }
  if (failed) {
    result?.fill(0);
    throw failure;
  }
  return result!;
}
