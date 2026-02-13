export const encoder = new TextEncoder();
export const decoder = new TextDecoder();

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
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  if (value < 0) {
    throw new Error(`value must be >= 0, got ${value}`);
  }
  let v = value;
  let out = "";
  do {
    out = alphabet[v & 63] + out;
    v = Math.floor(v / 64);
  } while (v > 0);
  if (out.length > length) {
    throw new Error(`value ${value} too large for base64 length ${length}`);
  }
  return out.padStart(length, "A");
}

export function b64ToInt(text: string): number {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let out = 0;
  for (const ch of text) {
    const idx = alphabet.indexOf(ch);
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
