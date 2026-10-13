import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import { sniff } from "../parser/cold-start.ts";
import type { AttachmentDispatchMode } from "../parser/group-dispatch.ts";
import type { Versionage } from "../tables/table-types.ts";
import { ColdStartError, ShortageError } from "./errors.ts";
import { isCesrDomain } from "./parser-constants.ts";
import type { AttachmentGroup, CesrDomain } from "./types.ts";

/** Attachment decoding mode and recognition of the next body. */
interface AttachmentCollectorOptions {
  attachmentDispatchMode: AttachmentDispatchMode;
  startsFrame: (
    input: Uint8Array,
    gvrsn: Versionage,
    cold: CesrDomain,
  ) => boolean;
}

/** Outcome for top-level trailing attachment collection. */
export interface CollectAttachmentsResult {
  attachments: AttachmentGroup[];
  consumed: number;
  complete: boolean;
}

/** Collect a message's attachments identically on initial and resumed feeds. */
export class AttachmentCollector {
  private readonly attachmentDispatchMode: AttachmentDispatchMode;
  private readonly startsFrame: (
    input: Uint8Array,
    gvrsn: Versionage,
    cold: CesrDomain,
  ) => boolean;

  constructor(options: AttachmentCollectorOptions) {
    this.attachmentDispatchMode = options.attachmentDispatchMode;
    this.startsFrame = options.startsFrame;
  }

  /**
   * Collect attachments from the current stream head until a frame boundary
   * (including `msg` message-domain frame start) or shortage pause is reached.
   */
  collectTrailingAttachments(
    input: Uint8Array,
    gvrsn: Versionage,
    seed: AttachmentGroup[] = [],
    terminal = false,
  ): CollectAttachmentsResult {
    const attachments = [...seed];
    let offset = 0;

    while (offset < input.length) {
      const nextCold = sniff(input.slice(offset));
      if (nextCold === "msg") {
        return { attachments, consumed: offset, complete: true };
      }
      if (nextCold === "ano") {
        offset = this.consumeLeadingAno(input, offset);
        continue;
      }
      if (!isCesrDomain(nextCold)) {
        throw new ColdStartError(
          `Unsupported attachment cold code ${nextCold}`,
        );
      }

      try {
        if (
          this.startsFrame(
            input.slice(offset),
            gvrsn,
            nextCold,
          )
        ) {
          return { attachments, consumed: offset, complete: true };
        }

        const { group, consumed } = parseAttachmentGroup(
          input.slice(offset),
          gvrsn,
          nextCold,
          { mode: this.attachmentDispatchMode },
        );
        attachments.push(group);
        offset += consumed;
        // An AttachmentGroup encloses the entire attachment set, unlike an
        // individual signature/receipt group. Its boundary completes the frame.
        if (group.name === "AttachmentGroup" || group.name === "BigAttachmentGroup") {
          return { attachments, consumed: offset, complete: true };
        }
      } catch (error) {
        if (error instanceof ShortageError) {
          return {
            attachments,
            consumed: offset,
            complete: false,
          };
        }
        throw error;
      }
    }

    return {
      attachments,
      consumed: offset,
      complete: terminal,
    };
  }

  /** Fast-forward consecutive annotation separator bytes from a local offset. */
  private consumeLeadingAno(input: Uint8Array, start: number): number {
    let offset = start;
    while (offset < input.length && sniff(input.slice(offset)) === "ano") {
      offset += 1;
    }
    return offset;
  }
}
