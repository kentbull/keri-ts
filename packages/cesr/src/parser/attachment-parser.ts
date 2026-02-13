import type { AttachmentGroup, ColdCode } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import {
  type AttachmentDispatchOptions,
  parseAttachmentDispatchCompat,
} from "./group-dispatch.ts";

export function parseAttachmentGroup(
  input: Uint8Array,
  version: Versionage,
  domain: Extract<ColdCode, "txt" | "bny">,
  options: AttachmentDispatchOptions = {},
): { group: AttachmentGroup; consumed: number } {
  return parseAttachmentDispatchCompat(input, version, domain, options);
}
