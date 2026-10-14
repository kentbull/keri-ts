/** Supply Node 18's native secure randomness before evaluating the pinned sodium wrapper. */
if (globalThis.crypto === undefined && globalThis.process?.versions?.node) {
  const { webcrypto } = await import("node:crypto");
  Object.defineProperty(globalThis, "crypto", { value: webcrypto, writable: true, configurable: true });
}

// Dynamic evaluation orders the prerequisite before both wrapper and raw initialization.
// Existing browser/Node crypto stays untouched; sodium retains its original missing-randomness error.
const { default: sodium } = await import("./wrapper.mjs");
export default sodium;
