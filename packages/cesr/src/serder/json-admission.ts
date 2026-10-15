import { t } from "../core/bytes.ts";
import { codecSyntaxFailure } from "../core/codec-errors.ts";
import { ResourceLimitError } from "../core/errors.ts";

import type { DecodedBodyBudget } from "./body-admission.ts";

/** Decode with native JSON semantics; only our intrinsic syntax refusal permits opaque fallback. */
export function decodeJson(raw: Uint8Array, onFailure?: (error: unknown) => void): unknown {
  let text: string;
  try {
    text = t(raw);
  } catch (error) {
    onFailure?.(error);
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      onFailure?.(error);
      throw error;
    }
    throw codecSyntaxFailure("JSON", `Failed to decode JSON Serder: ${String(error)}`);
  }
}

/**
 * Admit before raw copying, UTF-8 decoding or JSON.parse. This byte lexical scan
 * builds no JSON values and validates no grammar; native JSON remains authoritative.
 * Charge containers 64, value references/property fields 16, scalars 8, and string
 * source bytes 2 (an upper bound on decoded UTF-16, including escapes/duplicate keys).
 * Fixed scalar workspace and decode text stay conservatively charged through root cleanup.
 */
export function admitJson(raw: Uint8Array, budget: DecodedBodyBudget): void {
  if (!Number.isSafeInteger(budget.decodedBytes) || budget.decodedBytes < 0) {
    throw new RangeError("JSON credit must be a non-negative safe integer");
  }
  const working = 64 + 2 * raw.length;
  if (!Number.isSafeInteger(working)) throw new ResourceLimitError("JSON working extent exceeds safe accounting");
  budget.admitStage?.(working);
  let charge = 0;
  let string = false;
  let escaped = false;
  let scalar = false;
  for (let i = 0; i < raw.length; i++) {
    const byte = raw[i];
    if (string) {
      if (!escaped && byte === 34) string = false;
      else {
        charge += 2;
        escaped = !escaped && byte === 92;
      }
    } else if (byte === 34) {
      string = true;
      scalar = false;
      charge += 16;
    } else if (byte === 123 || byte === 91) {
      scalar = false;
      charge += 64 + 16;
    } else if (byte === 58) {
      scalar = false;
      charge += 16;
    } else if (byte === 125 || byte === 93 || byte === 44 || byte <= 32) {
      scalar = false;
    } else if (!scalar) {
      scalar = true;
      charge += 8 + 16;
    }
    if (charge > budget.decodedBytes) throw new ResourceLimitError("JSON exceeds decoded tree credit");
  }
  budget.admitStage?.(charge);
  budget.decodedBytes -= charge;
}
