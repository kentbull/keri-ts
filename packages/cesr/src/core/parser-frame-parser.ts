import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import { sniff } from "../parser/cold-start.ts";
import { decodeGenusVersion, parseCounter } from "../primitives/counter.ts";
import type { Counter } from "../primitives/counter.ts";
import { parseMatter } from "../primitives/matter.ts";
import { reapSerder } from "../serder/serdery.ts";
import { smell } from "../serder/smell.ts";
import { resolveCounterSizeTable } from "../tables/counter-version-registry.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Kinds, Protocols } from "../tables/versions.ts";
import {
  ColdStartError,
  DeserializeError,
  GroupSizeError,
  ShortageError,
  UnknownCodeError,
  VersionError,
} from "./errors.ts";
import {
  BODY_WITH_ATTACHMENT_GROUP_NAMES,
  DEFAULT_GVRSN,
  FRAME_START_GROUP_NAMES,
  GENERIC_GROUP_NAMES,
  GENUS_VERSION_CODE,
  isCesrDomain,
  isFrameBoundaryCounter,
  NATIVE_BODY_GROUP_NAMES,
  NON_NATIVE_BODY_GROUP_NAMES,
  tokenSize,
  unitBytes,
} from "./parser-constants.ts";
import type { CesrBody, CesrDomain, CesrFrame, Smellage } from "./types.ts";

/** Parsed frame-start result consumed by top-level parser orchestration. */
export interface FrameStart {
  frame: CesrFrame;
  /** True only when an enclosure proves the entire frame is present. */
  complete?: boolean;
  /** Further complete frames from the same enclosure, in stream order. */
  siblings?: CesrFrame[];
  consumed: number;
  /** Genus used to decode this frame and its attachments. */
  gvrsn: Versionage;
  /** Explicit stream selection; null leaves subsequent frames in legacy inference mode. */
  streamGvrsn: Versionage | null;
}

/**
 * Parses frame starts and bounded frame payload structures.
 *
 * Responsibilities:
 * - resolve frame-start forms (`msg`, native/body groups, wrappers)
 * - preserve version-scope semantics for stream and nested payloads
 * - return complete enclosed GenericGroup siblings in stream order
 */
export class FrameParser {
  /** Probe whether the next token is a top-level frame boundary counter. */
  startsFrame(
    input: Uint8Array,
    gvrsn: Versionage,
    cold: CesrDomain,
  ): boolean {
    const peek = this.tryParseCounter(input, gvrsn, cold);
    return peek !== null && isFrameBoundaryCounter(peek);
  }

  /**
   * Parse one frame start from the current head.
   * Does not parse trailing top-level attachments.
   */
  parseFrameStart(
    input: Uint8Array,
    inheritedGvrsn: Versionage | null = null,
  ): FrameStart {
    let offset = 0;
    let activeGvrsn = inheritedGvrsn;

    let cold = sniff(input.slice(offset));
    while (cold === "ano") {
      offset += 1;
      if (input.length <= offset) {
        throw new ShortageError(offset + 1, input.length);
      }
      cold = sniff(input.slice(offset));
    }

    if (cold === "txt" || cold === "bny") {
      const peek = parseCounter(input.slice(offset), activeGvrsn ?? DEFAULT_GVRSN, cold);
      if (peek.code === GENUS_VERSION_CODE) {
        offset += tokenSize(peek, cold);
        activeGvrsn = decodeGenusVersion(peek);
        if (input.length <= offset) {
          throw new ShortageError(offset + 1, input.length);
        }
        cold = sniff(input.slice(offset));
      }
    }

    if (cold === "msg") {
      const { serder, consumed } = reapSerder(input.slice(offset));
      return {
        frame: { body: serder, attachments: [] },
        consumed: offset + consumed,
        gvrsn: this.bodyGenus(serder, activeGvrsn),
        streamGvrsn: activeGvrsn,
      };
    }

    if (!isCesrDomain(cold)) {
      throw new ColdStartError(
        `Expected message or CESR body group at frame start but got ${cold}`,
      );
    }

    const {
      counter,
      gvrsn: frameGvrsn,
    } = this.resolveFrameStartCounter(
      input.slice(offset),
      activeGvrsn ?? DEFAULT_GVRSN,
      cold,
      activeGvrsn === null,
    );
    const headerSize = tokenSize(counter, cold);
    const unit = unitBytes(cold);

    if (BODY_WITH_ATTACHMENT_GROUP_NAMES.has(counter.name)) {
      return this.parseEnclosedFrame(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        frameGvrsn,
        activeGvrsn,
      );
    }
    if (NON_NATIVE_BODY_GROUP_NAMES.has(counter.name)) {
      return this.parseWrappedBody(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        cold,
        frameGvrsn,
        activeGvrsn,
      );
    }
    if (NATIVE_BODY_GROUP_NAMES.has(counter.name)) {
      return this.parseNativeBody(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        frameGvrsn,
        activeGvrsn,
      );
    }
    if (GENERIC_GROUP_NAMES.has(counter.name)) {
      return this.parseEnclosedFrames(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        frameGvrsn,
        activeGvrsn,
      );
    }
    throw new ColdStartError(
      `Unsupported body-group counter at frame start: ${counter.code}`,
    );
  }

  /** Parse nested `BodyWithAttachmentGroup` payload as one complete enclosed frame. */
  private parseEnclosedFrame(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    gvrsn: Versionage,
    streamGvrsn: Versionage | null,
  ): FrameStart {
    const payloadSize = count * unit;
    const total = headerSize + payloadSize;
    if (input.length < offset + total) {
      throw new ShortageError(offset + total, input.length);
    }
    const payload = input.slice(offset + headerSize, offset + total);
    let nested: ReturnType<FrameParser["parseFrame"]>;
    try {
      nested = this.parseFrame(payload, gvrsn);
    } catch (error) {
      if (error instanceof ShortageError) throw new GroupSizeError("Incomplete frame inside BodyWithAttachmentGroup");
      throw error;
    }
    if (nested.consumed !== payload.length) {
      throw new ColdStartError(
        "BodyWithAttachmentGroup payload did not parse to a complete frame",
      );
    }
    return {
      frame: nested.frame,
      complete: true,
      consumed: offset + total,
      gvrsn,
      streamGvrsn,
    };
  }

  /**
   * Parse `NonNativeBodyGroup` payload, preserving opaque-body fallback behavior
   * when Serder decode is not possible.
   * Returns only a body object (Serder) with no attachments.
   */
  private parseWrappedBody(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    cold: CesrDomain,
    gvrsn: Versionage,
    streamGvrsn: Versionage | null,
  ): FrameStart {
    const matter = parseMatter(input.slice(offset + headerSize), cold);
    const bodySize = tokenSize(matter, cold);
    const payloadSize = count * unit;
    if (payloadSize !== bodySize) {
      throw new ColdStartError(
        `NonNativeBodyGroup payload size mismatch: expected=${payloadSize} actual=${bodySize}`,
      );
    }

    // A recognizable body header must satisfy the enclosure's genus even if
    // the remaining body cannot be hydrated and would otherwise stay opaque.
    let metadata: Smellage | undefined;
    try {
      metadata = smell(matter.raw).smellage;
    } catch {
      // Opaque non-native material need not contain a message version string.
    }
    if (metadata) this.bodyGenus(metadata, gvrsn);
    let serder: CesrBody;
    try {
      ({ serder } = reapSerder(matter.raw));
    } catch (_error) {
      // Non-native body groups wrap one Matter primitive. If Serder hydration
      // fails, expose the primitive body bytes only; callers that inspect the
      // fallback should not see the surrounding group counter envelope.
      const raw = matter.raw;
      return {
        frame: {
          body: {
            raw,
            ked: null,
            proto: Protocols.keri,
            kind: Kinds.cesr,
            size: raw.length,
            pvrsn: gvrsn,
            gvrsn: gvrsn,
            ilk: null,
            said: null,
          },
          attachments: [],
        },
        consumed: offset + headerSize + bodySize,
        gvrsn,
        streamGvrsn,
      };
    }
    return {
      frame: { body: serder, attachments: [] },
      consumed: offset + headerSize + bodySize,
      gvrsn,
      streamGvrsn,
    };
  }

  /** Bound a native body and let Serder decode its fields once. */
  private parseNativeBody(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    gvrsn: Versionage,
    streamGvrsn: Versionage | null,
  ): FrameStart {
    const payloadSize = count * unit;
    const total = headerSize + payloadSize;
    if (input.length < offset + total) {
      throw new ShortageError(offset + total, input.length);
    }
    const raw = input.slice(offset, offset + total);
    // KERIpy parity rule: once the frame parser has classified a top-level
    // FixBodyGroup/MapBodyGroup as a native message body, the result must be a
    // real Serder or a parse error. Arbitrary native map/list corpora still
    // belong to lower-level CESR-native surfaces such as Mapper/Aggor.
    let serder: CesrBody;
    try {
      ({ serder } = reapSerder(raw));
    } catch (error) {
      if (error instanceof ShortageError) {
        throw new GroupSizeError("Incomplete field inside native body payload");
      }
      throw error;
    }
    this.bodyGenus(serder, gvrsn);
    return {
      frame: {
        body: serder,
        attachments: [],
      },
      consumed: offset + total,
      gvrsn,
      streamGvrsn,
    };
  }

  /**
   * Parse bounded `GenericGroup` payload into enclosed frames.
   * Returns the first complete frame and its ordered siblings.
   */
  private parseEnclosedFrames(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    gvrsn: Versionage,
    streamGvrsn: Versionage | null,
  ): FrameStart {
    const payloadSize = count * unit;
    const total = headerSize + payloadSize;
    if (input.length < offset + total) {
      throw new ShortageError(offset + total, input.length);
    }

    const payload = input.slice(offset + headerSize, offset + total);
    let frames: CesrFrame[];
    try {
      frames = this.parseFrames(payload, gvrsn);
    } catch (error) {
      if (error instanceof ShortageError) throw new GroupSizeError("Incomplete frame inside GenericGroup");
      throw error;
    }
    if (frames.length === 0) {
      throw new ColdStartError(
        "GenericGroup payload contained no enclosed frames",
      );
    }

    const [first, ...rest] = frames;

    return {
      frame: first,
      complete: true,
      siblings: rest,
      consumed: offset + total,
      gvrsn,
      streamGvrsn,
    };
  }

  /** Parse all enclosed frames inside a bounded payload slice, in order. */
  private parseFrames(
    input: Uint8Array,
    inheritedGvrsn: Versionage | null,
  ): CesrFrame[] {
    const out: CesrFrame[] = [];
    let offset = 0;
    let activeGvrsn = inheritedGvrsn;

    while (offset < input.length) {
      while (offset < input.length && sniff(input.slice(offset)) === "ano") {
        offset += 1;
      }
      if (offset >= input.length) {
        break;
      }

      const base = this.parseFrameStart(input.slice(offset), activeGvrsn);
      offset += base.consumed;
      const frameGvrsn = base.gvrsn;
      const attachments = [...base.frame.attachments];
      if (base.complete) {
        out.push(base.frame, ...(base.siblings ?? []));
        activeGvrsn = base.streamGvrsn;
        continue;
      }

      // greedily parse attachment groups until offset == input.length
      while (offset < input.length) {
        const nextCold = sniff(input.slice(offset));
        if (nextCold === "ano") {
          offset += 1;
          continue;
        }
        if (nextCold === "msg") {
          break;
        }
        if (!isCesrDomain(nextCold)) {
          throw new ColdStartError(
            `Unsupported attachment cold code ${nextCold}`,
          );
        }

        if (
          this.startsFrame(
            input.slice(offset),
            frameGvrsn,
            nextCold,
          )
        ) {
          break;
        }

        const { group, consumed } = parseAttachmentGroup(
          input.slice(offset),
          frameGvrsn,
          nextCold,
        );
        attachments.push(group);
        offset += consumed;
        if (group.name === "AttachmentGroup" || group.name === "BigAttachmentGroup") break;
      }

      out.push({
        body: base.frame.body,
        attachments,
      });
      activeGvrsn = base.streamGvrsn;
    }

    return out;
  }

  /** Parse one complete frame from a bounded slice, including trailing attachments. */
  private parseFrame(
    input: Uint8Array,
    inheritedGvrsn: Versionage | null = null,
  ): { frame: CesrFrame; consumed: number } {
    const base = this.parseFrameStart(input, inheritedGvrsn);
    if (base.complete) {
      if (base.siblings?.length) throw new ColdStartError("Expected one enclosed frame");
      return { frame: base.frame, consumed: base.consumed };
    }
    const gvrsn = base.gvrsn;
    const attachments = [...base.frame.attachments];
    let offset = base.consumed;

    while (offset < input.length) {
      const nextCold = sniff(input.slice(offset));
      if (nextCold === "ano") {
        offset += 1;
        continue;
      }
      if (nextCold === "msg") {
        throw new ColdStartError(
          "Enclosed frame payload encountered unexpected nested message start",
        );
      }

      if (!isCesrDomain(nextCold)) {
        throw new ColdStartError(
          `Unsupported attachment cold code ${nextCold}`,
        );
      }

      const { group, consumed } = parseAttachmentGroup(
        input.slice(offset),
        gvrsn,
        nextCold,
      );
      attachments.push(group);
      offset += consumed;
      if (group.name === "AttachmentGroup" || group.name === "BigAttachmentGroup") break;
    }

    return {
      frame: { body: base.frame.body, attachments },
      consumed: offset,
    };
  }

  /** Infer unselected legacy bodies, otherwise validate metadata against the stream genus. */
  private bodyGenus(body: Pick<CesrBody, "pvrsn" | "gvrsn">, selected: Versionage | null): Versionage {
    const genus = selected ?? body.gvrsn
      ?? (body.pvrsn.major === 1 ? { major: 1, minor: 0 } : DEFAULT_GVRSN);
    resolveCounterSizeTable(genus);
    if (body.pvrsn.major > genus.major) {
      throw new VersionError(
        `Protocol ${body.pvrsn.major}.${body.pvrsn.minor} exceeds stream genus ${genus.major}.${genus.minor}`,
      );
    }
    if (body.gvrsn) {
      resolveCounterSizeTable(body.gvrsn);
      if (body.gvrsn.major > genus.major || body.gvrsn.minor > genus.minor) {
        throw new VersionError(
          `Body genus ${body.gvrsn.major}.${body.gvrsn.minor} exceeds stream genus ${genus.major}.${genus.minor}`,
        );
      }
    }
    return genus;
  }

  /** Probe a counter in the selected genus without reinterpreting its bytes. */
  private tryParseCounter(
    input: Uint8Array,
    gvrsn: Versionage,
    cold: CesrDomain,
  ): Counter | null {
    try {
      return parseCounter(input, gvrsn, cold);
    } catch (error) {
      if (error instanceof UnknownCodeError || error instanceof DeserializeError) return null;
      throw error;
    }
  }

  /** Resolve frame counters in the selected genus; infer legacy forms only when unselected. */
  private resolveFrameStartCounter(
    input: Uint8Array,
    preferredGvrsn: Versionage,
    cold: CesrDomain,
    inferLegacy: boolean,
  ): { counter: Counter; gvrsn: Versionage } {
    const alternate: Versionage = preferredGvrsn.major >= 2
      ? { major: 1, minor: 0 }
      : { major: 2, minor: 0 };
    const attempts = inferLegacy ? [preferredGvrsn, alternate] : [preferredGvrsn];
    let firstParsed: { counter: Counter; gvrsn: Versionage } | null = null;
    let firstError: Error | null = null;

    for (const attempt of attempts) {
      try {
        const counter = parseCounter(input, attempt, cold);
        if (!firstParsed) {
          firstParsed = { counter, gvrsn: attempt };
        }
        if (FRAME_START_GROUP_NAMES.has(counter.name)) {
          return { counter, gvrsn: attempt };
        }
      } catch (error) {
        if (error instanceof ShortageError) {
          throw error;
        }
        if (
          error instanceof UnknownCodeError
          || error instanceof DeserializeError
        ) {
          if (!firstError) {
            firstError = error;
          }
          continue;
        }
        throw error;
      }
    }

    if (firstParsed) {
      return firstParsed;
    }
    if (firstError) {
      throw firstError;
    }
    throw new ColdStartError("Unable to resolve frame-start counter");
  }
}
