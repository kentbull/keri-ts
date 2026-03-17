import type { AttachmentGroup, ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import { type AttachmentDispatchOptions, parseAttachmentDispatchCompat } from "./group-dispatch.ts";

/**
 * Historical attachment-group entrypoint preserved as a thin wrapper around the
 * newer dispatch-policy parser.
 */
export function parseAttachmentGroup(
  input: Uint8Array,
  version: Versionage,
  domain: Extract<ColdCode, "txt" | "bny">,
  options: AttachmentDispatchOptions = {},
): { group: AttachmentGroup; consumed: number } {
  return parseAttachmentDispatchCompat(input, version, domain, options);
}
