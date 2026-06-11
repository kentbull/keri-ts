import { ValidationError } from "../../../core/errors.ts";
import { makeNowIso8601 } from "../../../time/mod.ts";
import type { WitnessAuthMap } from "../../witnessing.ts";

export interface WitnessAuthOptions {
  codeTime?: string;
  promptMissing?: boolean;
  promptCode?: (message: string) => string | null;
  now?: () => string;
  normalizeCodeTime?: (value: string) => string;
}

/** Build witness auth payloads from CLI `<witness>:<code>` inputs. */
export function resolveWitnessAuths(
  witnesses: readonly string[],
  codes: readonly string[],
  options: WitnessAuthOptions = {},
): WitnessAuthMap {
  const now = options.now ?? makeNowIso8601;
  const timestamp = options.codeTime
    ? (options.normalizeCodeTime?.(options.codeTime) ?? options.codeTime)
    : now();
  const auths: WitnessAuthMap = {};
  for (const entry of codes) {
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator >= entry.length - 1) {
      throw new ValidationError(
        `Invalid witness code '${entry}'. Expected <Witness AID>:<code>.`,
      );
    }
    const witness = entry.slice(0, separator);
    const code = entry.slice(separator + 1);
    auths[witness] = `${code}#${timestamp}`;
  }
  if (options.promptMissing) {
    const promptCode = options.promptCode ?? prompt;
    for (const witness of witnesses) {
      if (auths[witness]) {
        continue;
      }
      const code = promptCode(`Entire code for ${witness}: `);
      if (!code) {
        throw new ValidationError(`Missing witness code for ${witness}.`);
      }
      auths[witness] = `${code}#${now()}`;
    }
  }
  return auths;
}
