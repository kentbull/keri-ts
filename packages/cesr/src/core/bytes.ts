export const encoder = new TextEncoder();
export const decoder = new TextDecoder();
const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function concatBytes(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

export function intToB64(value: number, length = 1): string {
  if (value < 0) {
    throw new Error(`value must be >= 0, got ${value}`);
  }
  let v = value;
  let out = "";
  do {
    out = B64_ALPHABET[v & 63] + out;
    v = Math.floor(v / 64);
  } while (v > 0);
  if (out.length > length) {
    throw new Error(`value ${value} too large for base64 length ${length}`);
  }
  return out.padStart(length, "A");
}

export function b64ToInt(text: string): number {
  let out = 0;
  for (const ch of text) {
    const idx = B64_ALPHABET.indexOf(ch);
    if (idx < 0) {
      throw new Error(`Invalid base64 char ${ch}`);
    }
    out = out * 64 + idx;
  }
  return out;
}

export function encodeB64(data: Uint8Array): string {
  const str = btoa(String.fromCharCode(...data));
  return str.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function decodeB64(text: string): Uint8Array {
  const padded = text + "===".slice((text.length + 3) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    out[i] = raw.charCodeAt(i);
  }
  return out;
}

export function sceil(value: number): number {
  return Math.ceil(value);
}

export function codeB64ToB2(text: string): Uint8Array {
  const i = b64ToInt(text) << (2 * (text.length % 4));
  const n = sceil((text.length * 3) / 4);
  const out = new Uint8Array(n);
  let v = i;
  for (let idx = n - 1; idx >= 0; idx--) {
    out[idx] = v & 0xff;
    v = Math.floor(v / 256);
  }
  return out;
}

export function codeB2ToB64(bytes: Uint8Array, sextets: number): string {
  const n = sceil((sextets * 3) / 4);
  if (n > bytes.length) {
    throw new Error(`Not enough bytes to convert ${sextets} sextets`);
  }
  let i = 0;
  for (let idx = 0; idx < n; idx++) {
    i = (i << 8) | bytes[idx];
  }
  i >>= 2 * (sextets % 4);
  return intToB64(i, sextets);
}

export function nabSextets(bytes: Uint8Array, sextets: number): Uint8Array {
  const n = sceil((sextets * 3) / 4);
  if (n > bytes.length) {
    throw new Error(`Not enough bytes to nab ${sextets} sextets`);
  }
  let i = 0;
  for (let idx = 0; idx < n; idx++) {
    i = (i << 8) | bytes[idx];
  }
  const p = 2 * (sextets % 4);
  i >>= p;
  i <<= p;
  const out = new Uint8Array(n);
  for (let idx = n - 1; idx >= 0; idx--) {
    out[idx] = i & 0xff;
    i >>= 8;
  }
  return out;
}
