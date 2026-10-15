/**
 * Logical MessagePack decode allowance: 8 KiB fixed scratch, 256 bytes per
 * nonempty container/extension, and one raw copy. This conservative policy
 * covers the audited decoder without counting its private fields or pool layout.
 * It is not a native heap bound; declaration and decoded-tree charges stay separate.
 */
export function msgpackWorkspaceBytes(rawBytes: number, containers: number, extensions: number): number {
  return 8192 + 256 * (containers + extensions) + rawBytes;
}

/** Pinned CBOR workspace policy; actual message-global reset remains the decoder scope's responsibility. */
export function cborWorkspaceBytes(rawBytes: number, shortString: number): number {
  // Scalar-unit strings, source DataView, uint64/Date scratch, scope/callback/reset and raw copy.
  return 64 + 16 + 64 + 26 * shortString + 64 + 2 * 16 + 8 + rawBytes + 64 + 96 + 64;
}
