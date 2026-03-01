import { encode } from "./stream-byte-fixtures.ts";

function v1Version(kind: "JSON" | "MGPK" | "CBOR", size: number): string {
  return `KERI10${kind}${size.toString(16).padStart(6, "0")}_`;
}

/** Replace placeholder v1 JSON version size with actual encoded byte size. */
export function v1ify(raw: string): string {
  const size = encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("KERI10JSON000000_", `KERI10JSON${sizeHex}_`);
}

/** Replace placeholder v2 JSON version size with actual encoded byte size. */
export function v2ify(raw: string): string {
  const size = encode(raw).length;
  const sizeHex = size.toString(16).padStart(6, "0");
  return raw.replace("KERI20JSON000000_", `KERI20JSON${sizeHex}_`);
}

/** Minimal valid v1 MGPK body for cold-start parser tests. */
export function minimalV1MgpkBody(): Uint8Array {
  // msgpack: map(1), key "v", value short-str(version)
  const size = 1 + 2 + 1 + 17;
  const vs = encode(v1Version("MGPK", size));
  return Uint8Array.from([0x81, 0xa1, 0x76, 0xb1, ...vs]);
}

/** Minimal valid v1 CBOR body for cold-start parser tests. */
export function minimalV1CborBody(): Uint8Array {
  // cbor: map(1), key "v", value text(version)
  const size = 1 + 2 + 1 + 17;
  const vs = encode(v1Version("CBOR", size));
  return Uint8Array.from([0xa1, 0x61, 0x76, 0x71, ...vs]);
}
