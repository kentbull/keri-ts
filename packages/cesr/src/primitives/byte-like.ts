import { b } from "../core/bytes.ts";

/** TS-local bytes normalization seam mirroring KERIpy's byteable inputs. */
export type ByteLike = string | Uint8Array | ArrayBufferView;

/** Normalize text or buffer-view inputs into one detached `Uint8Array`. */
export function normalizeByteLike(value: ByteLike): Uint8Array {
  if (typeof value === "string") {
    return b(value);
  }
  if (value instanceof Uint8Array) {
    return Object.getPrototypeOf(value) === Uint8Array.prototype
      ? value.slice()
      : new Uint8Array(value);
  }
  return new Uint8Array(
    value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
  );
}

/** Runtime guard for byte-like primitive constructor inputs. */
export function isByteLike(value: unknown): value is ByteLike {
  return typeof value === "string"
    || value instanceof Uint8Array
    || ArrayBuffer.isView(value);
}
