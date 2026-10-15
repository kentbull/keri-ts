/** Pinned MessagePack decoder workspace policy, separate from declaration preflight and decoded retention. */
export function msgpackWorkspaceBytes(
  rawBytes: number,
  states: number,
  extensions: number,
  shortString: number,
): number {
  // 3.1.3 Decoder fields, pooled container states, short-string units and timestamp scratch.
  return 64 + 18 * 16 + 64 + 2 * 16 + 64 + 64 + 64 + 26 * shortString
    + 64 + 2 * 16 + states * (64 + 7 * 16 + 16) + extensions * (64 + 2 * 16 + 2 * 8 + 64) + rawBytes;
}

/** Pinned CBOR workspace policy; actual message-global reset remains the decoder scope's responsibility. */
export function cborWorkspaceBytes(rawBytes: number, shortString: number): number {
  // Scalar-unit strings, source DataView, uint64/Date scratch, scope/callback/reset and raw copy.
  return 64 + 16 + 64 + 26 * shortString + 64 + 2 * 16 + 8 + rawBytes + 64 + 96 + 64;
}
