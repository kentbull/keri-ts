/**
 * Logical MessagePack decode allowance: 8 KiB fixed scratch, 256 bytes per
 * nonempty container and per extension, and one raw copy. This conservative policy
 * covers the audited decoder without counting its private fields or pool layout.
 * It is not a native heap bound; declaration and decoded-tree charges stay separate.
 */
export function msgpackWorkspaceBytes(rawBytes: number, containers: number, extensions: number): number {
  return 8192 + 256 * (containers + extensions) + rawBytes;
}

/**
 * Logical CBOR decode allowance: 4 KiB fixed scratch and one raw copy,
 * conservatively covering the audited scope, short-string and reset workspace.
 * Declaration/decoded charges and actual message-global reset stay independent.
 */
export function cborWorkspaceBytes(rawBytes: number): number {
  return 4096 + rawBytes;
}
