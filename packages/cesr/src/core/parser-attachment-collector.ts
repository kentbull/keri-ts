import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import { sniff } from "../parser/cold-start.ts";
import type {
  AttachmentDispatchMode,
  VersionFallbackInfo,
} from "../parser/group-dispatch.ts";
import type { Versionage } from "../tables/table-types.ts";
import { ColdStartError, ShortageError } from "./errors.ts";
import { isAttachmentDomain } from "./parser-constants.ts";
import type { AttachmentGroup, CesrMessage } from "./types.ts";

/** Dependency-injected attachment collection policies and hooks. */
interface AttachmentCollectorOptions {
  framed: boolean;
  attachmentDispatchMode: AttachmentDispatchMode;
  onAttachmentVersionFallback?: (info: VersionFallbackInfo) => void;
  isFrameBoundaryAhead: (
    input: Uint8Array,
    version: Versionage,
    cold: "txt" | "bny",
  ) => boolean;
}

/** Outcome for top-level trailing attachment collection. */
export interface CollectAttachmentsResult {
  attachments: AttachmentGroup[];
  consumed: number;
  pausedForShortage: boolean;
}

/** Outcome for pending-frame continuation parsing. */
export interface ResumePendingResult {
  consumed: number;
  emitPending: boolean;
  shouldContinue: boolean;
}

/**
 * Parses and appends attachment groups for both:
 * - normal trailing-attachment collection after frame start parse
 * - pending-frame continuation after shortage pauses
 */
export class AttachmentCollector {
  private readonly framed: boolean;
  private readonly attachmentDispatchMode: AttachmentDispatchMode;
  private readonly onAttachmentVersionFallback?: (
    info: VersionFallbackInfo,
  ) => void;
  private readonly isFrameBoundaryAhead: (
    input: Uint8Array,
    version: Versionage,
    cold: "txt" | "bny",
  ) => boolean;

  constructor(options: AttachmentCollectorOptions) {
    this.framed = options.framed;
    this.attachmentDispatchMode = options.attachmentDispatchMode;
    this.onAttachmentVersionFallback = options.onAttachmentVersionFallback;
    this.isFrameBoundaryAhead = options.isFrameBoundaryAhead;
  }

  /**
   * Collect attachments from the current stream head until a boundary, message
   * start, or shortage pause is reached.
   */
  collectTrailingAttachments(
    input: Uint8Array,
    version: Versionage,
    streamVersion: Versionage,
    seed: AttachmentGroup[] = [],
  ): CollectAttachmentsResult {
    const attachments = [...seed];
    let offset = 0;

    while (offset < input.length) {
      const nextCold = sniff(input.slice(offset));
      if (nextCold === "msg") {
        break;
      }
      if (nextCold === "ano") {
        offset = this.consumeLeadingAno(input, offset);
        continue;
      }
      if (!isAttachmentDomain(nextCold)) {
        throw new ColdStartError(
          `Unsupported attachment cold code ${nextCold}`,
        );
      }

      try {
        if (
          this.isFrameBoundaryAhead(
            input.slice(offset),
            streamVersion,
            nextCold,
          )
        ) {
          break;
        }

        const { group, consumed } = parseAttachmentGroup(
          input.slice(offset),
          version,
          nextCold,
          {
            mode: this.attachmentDispatchMode,
            onVersionFallback: this.onAttachmentVersionFallback,
          },
        );
        attachments.push(group);
        offset += consumed;
        if (this.framed) {
          break;
        }
      } catch (error) {
        if (error instanceof ShortageError) {
          return {
            attachments,
            consumed: offset,
            pausedForShortage: true,
          };
        }
        throw error;
      }
    }

    return {
      attachments,
      consumed: offset,
      pausedForShortage: false,
    };
  }

  /**
   * Resume attachment parsing for a pending top-level frame.
   *
   * Emits no events directly; parser orchestration decides when to emit pending.
   */
  resumePendingFrame(
    input: Uint8Array,
    pendingFrame: CesrMessage,
    version: Versionage,
    streamVersion: Versionage,
  ): ResumePendingResult {
    if (input.length === 0) {
      return { consumed: 0, emitPending: false, shouldContinue: false };
    }

    let offset = 0;
    const nextCold = sniff(input.slice(offset));

    if (nextCold === "ano") {
      offset = this.consumeLeadingAno(input, offset);
      return {
        consumed: offset,
        emitPending: false,
        shouldContinue: offset < input.length,
      };
    }

    if (nextCold === "msg") {
      return { consumed: 0, emitPending: true, shouldContinue: true };
    }

    if (!isAttachmentDomain(nextCold)) {
      throw new ColdStartError(
        `Unsupported pending-frame continuation cold code ${nextCold}`,
      );
    }

    if (
      this.isFrameBoundaryAhead(input.slice(offset), streamVersion, nextCold)
    ) {
      return { consumed: 0, emitPending: true, shouldContinue: true };
    }

    const { group, consumed } = parseAttachmentGroup(
      input.slice(offset),
      version,
      nextCold,
      {
        mode: this.attachmentDispatchMode,
        onVersionFallback: this.onAttachmentVersionFallback,
      },
    );
    pendingFrame.attachments.push(group);
    offset += consumed;

    if (this.framed) {
      return { consumed: offset, emitPending: true, shouldContinue: false };
    }

    if (offset >= input.length) {
      return { consumed: offset, emitPending: false, shouldContinue: false };
    }

    const afterCold = sniff(input.slice(offset));
    if (afterCold === "ano") {
      offset = this.consumeLeadingAno(input, offset);
      return {
        consumed: offset,
        emitPending: false,
        shouldContinue: offset < input.length,
      };
    }
    if (afterCold === "msg") {
      return { consumed: offset, emitPending: true, shouldContinue: true };
    }

    return { consumed: offset, emitPending: false, shouldContinue: true };
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
