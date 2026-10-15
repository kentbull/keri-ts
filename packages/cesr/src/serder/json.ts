import { t } from "../core/bytes.ts";
import { codecSyntaxFailure } from "../core/codec-errors.ts";

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
