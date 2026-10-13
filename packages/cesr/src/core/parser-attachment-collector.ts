import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import { sniff } from "../parser/cold-start.ts";
import { parseCounter } from "../primitives/counter.ts";
import type { Versionage } from "../tables/table-types.ts";
import { ColdStartError, DeserializeError, ShortageError, UnknownCodeError } from "./errors.ts";
import { isCesrDomain, isFrameBoundaryCounter } from "./parser-constants.ts";
import type { AttachmentGroup, CesrDomain } from "./types.ts";

/** Probe only the selected genus; a shortage must remain a shortage. */
function startsFrame(input: Uint8Array, gvrsn: Versionage, domain: CesrDomain): boolean {
  try {
    return isFrameBoundaryCounter(parseCounter(input, gvrsn, domain));
  } catch (error) {
    if (error instanceof UnknownCodeError || error instanceof DeserializeError) return false;
    throw error;
  }
}

/**
 * Read attachments until a following body, a closed attachment enclosure, or exhaustion.
 * Exhaustion completes only terminal/bounded input. Partial groups remain unconsumed;
 * terminal shortages propagate so bounded callers can report enclosure errors.
 */
export function parseAttachments(
  input: Uint8Array,
  gvrsn: Versionage,
  seed: AttachmentGroup[] = [],
  terminal = false,
): { attachments: AttachmentGroup[]; consumed: number; complete: boolean } {
  const attachments = [...seed];
  let offset = 0;
  while (offset < input.length) {
    const rest = input.slice(offset);
    const domain = sniff(rest);
    if (domain === "msg") return { attachments, consumed: offset, complete: true };
    if (domain === "ano") {
      offset++;
      continue;
    }
    if (!isCesrDomain(domain)) throw new ColdStartError(`Unsupported attachment cold code ${domain}`);
    try {
      if (startsFrame(rest, gvrsn, domain)) return { attachments, consumed: offset, complete: true };
      const { group, consumed } = parseAttachmentGroup(rest, gvrsn, domain);
      attachments.push(group);
      offset += consumed;
      if (group.name === "AttachmentGroup" || group.name === "BigAttachmentGroup") {
        return { attachments, consumed: offset, complete: true };
      }
    } catch (error) {
      if (error instanceof ShortageError && !terminal) {
        return { attachments, consumed: offset, complete: false };
      }
      throw error;
    }
  }
  return { attachments, consumed: offset, complete: terminal };
}
