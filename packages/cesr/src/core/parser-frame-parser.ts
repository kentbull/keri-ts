import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import { sniff } from "../parser/cold-start.ts";
import type {
  AttachmentDispatchMode,
  VersionFallbackInfo,
} from "../parser/group-dispatch.ts";
import { parseCounter } from "../primitives/counter.ts";
import type { Counter } from "../primitives/counter.ts";
import { parseIlker } from "../primitives/ilker.ts";
import { isLabelerCode, parseLabeler } from "../primitives/labeler.ts";
import { parseMatter } from "../primitives/matter.ts";
import { parseMapperBody } from "../primitives/mapper.ts";
import { parseVerser } from "../primitives/verser.ts";
import { reapSerder } from "../serder/serdery.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Kinds, type Protocol, Protocols } from "../tables/versions.ts";
import { b64ToInt, intToB64 } from "./bytes.ts";
import {
  ColdStartError,
  DeserializeError,
  ShortageError,
  UnknownCodeError,
} from "./errors.ts";
import {
  BODY_WITH_ATTACHMENT_GROUP_NAMES,
  DEFAULT_VERSION,
  FRAME_START_GROUP_NAMES,
  GENERIC_GROUP_NAMES,
  GENUS_VERSION_CODE,
  isAttachmentDomain,
  isFrameBoundaryCounter,
  MAP_BODY_CODES,
  NATIVE_BODY_GROUP_NAMES,
  NON_NATIVE_BODY_GROUP_NAMES,
  quadletUnit,
  tokenSize,
} from "./parser-constants.ts";
import type { CesrMessage } from "./types.ts";

/** Dependency-injected options for frame parsing behavior and hooks. */
interface FrameParserOptions {
  framed: boolean;
  attachmentDispatchMode: AttachmentDispatchMode;
  onAttachmentVersionFallback?: (info: VersionFallbackInfo) => void;
  onEnclosedFrames: (frames: CesrMessage[]) => void;
}

/** Parsed frame-start result consumed by top-level parser orchestration. */
export interface ParsedFrameStart {
  frame: CesrMessage;
  consumed: number;
  version: Versionage;
  streamVersion: Versionage;
}

/**
 * Parses frame starts and bounded frame payload structures.
 *
 * Responsibilities:
 * - resolve frame-start forms (`msg`, native/body groups, wrappers)
 * - preserve version-scope semantics for stream and nested payloads
 * - emit enclosed GenericGroup siblings through callback for deferred handling
 */
export class FrameParser {
  private readonly framed: boolean;
  private readonly attachmentDispatchMode: AttachmentDispatchMode;
  private readonly onAttachmentVersionFallback?: (
    info: VersionFallbackInfo,
  ) => void;
  private readonly onEnclosedFrames: (frames: CesrMessage[]) => void;

  constructor(options: FrameParserOptions) {
    this.framed = options.framed;
    this.attachmentDispatchMode = options.attachmentDispatchMode;
    this.onAttachmentVersionFallback = options.onAttachmentVersionFallback;
    this.onEnclosedFrames = options.onEnclosedFrames;
  }

  /** Probe whether the next token is a top-level frame boundary counter. */
  isFrameBoundaryAhead(
    input: Uint8Array,
    version: Versionage,
    cold: "txt" | "bny",
  ): boolean {
    const peek = this.tryParseCounter(input, version, cold);
    return peek !== null && isFrameBoundaryCounter(peek);
  }

  /**
   * Parse one frame start from the current head.
   * Does not parse trailing top-level attachments.
   */
  parseFrame(
    input: Uint8Array,
    inheritedVersion: Versionage = DEFAULT_VERSION,
  ): ParsedFrameStart {
    let offset = 0;
    let activeVersion = inheritedVersion;

    let cold = sniff(input.slice(offset));
    while (cold === "ano") {
      // consume leading annotation marker bytes until a new message type is detected.
      offset += 1;
      if (input.length <= offset) {
        throw new ShortageError(offset + 1, input.length);
      }
      cold = sniff(input.slice(offset));
    }
    // Handle optional leading KERIACDCGenusVersion selector before real frame start
    if (cold === "txt" || cold === "bny") {
      const peek = parseCounter(input.slice(offset), activeVersion, cold);
      if (peek.code === GENUS_VERSION_CODE) {
        offset += tokenSize(peek, cold);
        activeVersion = this.decodeVersionCounter(peek);
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
        version: serder.gvrsn ?? serder.pvrsn,
        streamVersion: serder.gvrsn ?? serder.pvrsn,
      };
    }

    if (!isAttachmentDomain(cold)) {
      throw new ColdStartError(
        `Expected message or CESR body group at frame start but got ${cold}`,
      );
    }

    const {
      counter,
      version: frameVersion,
    } = this.resolveFrameStartCounter(
      input.slice(offset),
      activeVersion,
      cold,
    );
    const headerSize = tokenSize(counter, cold);
    const unit = quadletUnit(cold);

    // Category 1: wrapper groups that enclose one complete body+attachments frame.
    if (BODY_WITH_ATTACHMENT_GROUP_NAMES.has(counter.name)) {
      return this.parseBodyWithAttachmentGroup(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        frameVersion,
        frameVersion,
      );
    }

    // Category 2: non-native message-body groups (texter-wrapped body payload).
    if (NON_NATIVE_BODY_GROUP_NAMES.has(counter.name)) {
      return this.parseNonNativeBodyGroup(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        cold,
        frameVersion,
        frameVersion,
      );
    }

    // Category 3: native body groups (fixed-field and map-body forms).
    if (NATIVE_BODY_GROUP_NAMES.has(counter.name)) {
      return this.parseNativeBodyGroup(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        cold,
        frameVersion,
        counter.code,
        frameVersion,
      );
    }

    // Category 4: generic enclosing groups that carry one or more full frames.
    if (GENERIC_GROUP_NAMES.has(counter.name)) {
      return this.parseGenericGroup(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        frameVersion,
        frameVersion,
      );
    }

    throw new ColdStartError(
      `Unsupported body-group counter at frame start: ${counter.code}`,
    );
  }

  /** Parse nested `BodyWithAttachmentGroup` payload as one complete enclosed frame. */
  private parseBodyWithAttachmentGroup(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    version: Versionage,
    streamVersion: Versionage,
  ): ParsedFrameStart {
    const payloadSize = count * unit;
    const total = headerSize + payloadSize;
    if (input.length < offset + total) {
      throw new ShortageError(offset + total, input.length);
    }
    const payload = input.slice(offset + headerSize, offset + total);
    const nested = this.parseCompleteFrame(payload, version, false);
    if (nested.consumed !== payload.length) {
      throw new ColdStartError(
        "BodyWithAttachmentGroup payload did not parse to a complete frame",
      );
    }
    return {
      frame: nested.frame,
      consumed: offset + total,
      version: nested.frame.body.gvrsn ?? nested.frame.body.pvrsn, // fallback to pvrsn is a v1 fallback compatibility heuristic
      streamVersion,
    };
  }

  /**
   * Parse `NonNativeBodyGroup` payload, preserving opaque-body fallback behavior
   * when Serder decode is not possible.
   * Returns only a body object (Serder) with no attachments.
   */
  private parseNonNativeBodyGroup(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    cold: "txt" | "bny",
    version: Versionage,
    streamVersion: Versionage,
  ): ParsedFrameStart {
    const matter = parseMatter(input.slice(offset + headerSize), cold);
    const bodySize = tokenSize(matter, cold);
    const payloadSize = count * unit;
    if (payloadSize !== bodySize) {
      throw new ColdStartError(
        `NonNativeBodyGroup payload size mismatch: expected=${payloadSize} actual=${bodySize}`,
      );
    }

    try {
      const { serder } = reapSerder(matter.raw);
      return {
        frame: { body: serder, attachments: [] },
        consumed: offset + headerSize + bodySize,
        version: serder.gvrsn ?? serder.pvrsn,
        streamVersion,
      };
    } catch (_error) {
      return {
        frame: {
          body: {
            raw: matter.raw,
            ked: null,
            proto: Protocols.keri,
            kind: Kinds.cesr,
            size: matter.raw.length,
            pvrsn: version,
            gvrsn: version,
            ilk: null,
            said: null,
          },
          attachments: [],
        },
        consumed: offset + headerSize + bodySize,
        version,
        streamVersion,
      };
    }
  }

  /** Parse native fixed/map body group and extract metadata/native fields. */
  private parseNativeBodyGroup(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    cold: "txt" | "bny",
    version: Versionage,
    bodyCode: string,
    streamVersion: Versionage,
  ): ParsedFrameStart {
    const payloadSize = count * unit;
    const total = headerSize + payloadSize;
    if (input.length < offset + total) {
      throw new ShortageError(offset + total, input.length);
    }
    const raw = input.slice(offset, offset + total);
    const metadata = this.extractNativeMetadata(raw, cold, version);
    const fields = this.extractNativeFields(raw, cold, version);
    return {
      frame: {
        body: {
          raw,
          ked: null,
          proto: metadata.proto,
          kind: Kinds.cesr,
          size: raw.length,
          pvrsn: metadata.pvrsn,
          gvrsn: metadata.gvrsn,
          ilk: metadata.ilk,
          said: metadata.said,
          native: {
            bodyCode,
            fields,
          },
        },
        attachments: [],
      },
      consumed: offset + total,
      version,
      streamVersion,
    };
  }

  /**
   * Parse bounded `GenericGroup` payload into enclosed frames.
   * Returns first frame and reports remaining siblings via callback.
   */
  private parseGenericGroup(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    version: Versionage,
    streamVersion: Versionage,
  ): ParsedFrameStart {
    const payloadSize = count * unit;
    const total = headerSize + payloadSize;
    if (input.length < offset + total) {
      throw new ShortageError(offset + total, input.length);
    }

    const payload = input.slice(offset + headerSize, offset + total);
    const frames = this.parseFrameSequence(payload, version);
    if (frames.length === 0) {
      throw new ColdStartError(
        "GenericGroup payload contained no enclosed frames",
      );
    }

    const [first, ...rest] = frames;
    if (rest.length > 0) {
      this.onEnclosedFrames(rest);
    }

    return {
      frame: first,
      consumed: offset + total,
      version: first.body.gvrsn ?? first.body.pvrsn,
      streamVersion,
    };
  }

  /** Parse all enclosed frames inside a bounded payload slice, in order. */
  private parseFrameSequence(
    input: Uint8Array,
    inheritedVersion: Versionage,
  ): CesrMessage[] {
    const out: CesrMessage[] = [];
    let offset = 0;
    let activeVersion = inheritedVersion;

    while (offset < input.length) {
      while (offset < input.length && sniff(input.slice(offset)) === "ano") {
        offset += 1;
      }
      if (offset >= input.length) {
        break;
      }

      const base = this.parseFrame(input.slice(offset), activeVersion);
      offset += base.consumed;
      const frameVersion = base.version;
      const streamVersion = base.streamVersion;
      const attachments = [...base.frame.attachments];

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
        if (!isAttachmentDomain(nextCold)) {
          throw new ColdStartError(
            `Unsupported attachment cold code ${nextCold}`,
          );
        }

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
          frameVersion,
          nextCold,
          {
            mode: this.attachmentDispatchMode,
            onVersionFallback: this.onAttachmentVersionFallback,
          },
        );
        attachments.push(group);
        offset += consumed;
      }

      out.push({
        body: base.frame.body,
        attachments,
      });
      activeVersion = base.streamVersion;
    }

    return out;
  }

  /** Parse one complete frame from a bounded slice, including trailing attachments. */
  private parseCompleteFrame(
    input: Uint8Array,
    inheritedVersion: Versionage = DEFAULT_VERSION,
    stopAtNextMessage = true,
  ): { frame: CesrMessage; consumed: number } {
    const base = this.parseFrame(input, inheritedVersion);
    const version = base.version;
    const attachments = [...base.frame.attachments];
    let offset = base.consumed;

    while (offset < input.length) {
      const nextCold = sniff(input.slice(offset));
      if (nextCold === "ano") {
        offset += 1;
        continue;
      }
      if (nextCold === "msg") {
        if (stopAtNextMessage) {
          break;
        }
        throw new ColdStartError(
          "Enclosed frame payload encountered unexpected nested message start",
        );
      }

      if (!isAttachmentDomain(nextCold)) {
        throw new ColdStartError(
          `Unsupported attachment cold code ${nextCold}`,
        );
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
    }

    return {
      frame: { body: base.frame.body, attachments },
      consumed: offset,
    };
  }

  /** Decode a genus-version counter token into major/minor Versionage values. */
  private decodeVersionCounter(counter: Counter): Versionage {
    const triplet = counter.qb64.length >= 3
      ? counter.qb64.slice(-3)
      : intToB64(counter.count, 3);
    const majorRaw = b64ToInt(triplet[0] ?? "A");
    const minorRaw = b64ToInt(triplet[1] ?? "A");
    const major = majorRaw === 1 ? 1 : 2;
    return {
      major,
      minor: minorRaw,
    };
  }

  /** Best-effort native metadata extraction used for advisory body fields. */
  private extractNativeMetadata(
    raw: Uint8Array,
    cold: "txt" | "bny",
    fallbackVersion: Versionage,
  ): {
    proto: "KERI" | "ACDC";
    pvrsn: Versionage;
    gvrsn: Versionage;
    ilk: string | null;
    said: string | null;
  } {
    let offset = 0;
    let proto: "KERI" | "ACDC" = Protocols.keri;
    let pvrsn = fallbackVersion;
    let gvrsn = fallbackVersion;
    let ilk: string | null = null;
    let said: string | null = null;

    try {
      const bodyCounter = parseCounter(raw, fallbackVersion, cold);
      offset += cold === "bny" ? bodyCounter.fullSizeB2 : bodyCounter.fullSize;

      if (MAP_BODY_CODES.has(bodyCounter.code)) {
        offset = this.skipNativeLabelers(raw, offset, cold);
      }

      const verser = parseVerser(raw.slice(offset), cold);
      offset += tokenSize(verser, cold);
      proto = verser.proto as Protocol;
      pvrsn = verser.pvrsn;
      gvrsn = verser.gvrsn;

      if (MAP_BODY_CODES.has(bodyCounter.code)) {
        offset = this.skipNativeLabelers(raw, offset, cold);
      }

      const ilker = parseIlker(raw.slice(offset), cold);
      offset += tokenSize(ilker, cold);
      ilk = ilker.ilk;

      if (MAP_BODY_CODES.has(bodyCounter.code)) {
        offset = this.skipNativeLabelers(raw, offset, cold);
      }

      const saider = parseMatter(raw.slice(offset), cold);
      if (saider.code.startsWith("E")) {
        said = saider.qb64;
      }
    } catch (_error) {
      // Metadata extraction is advisory and intentionally best-effort.
    }

    return { proto, pvrsn, gvrsn, ilk, said };
  }

  /** Skip consecutive labeler tokens in native map-body parsing context. */
  private skipNativeLabelers(
    raw: Uint8Array,
    offset: number,
    cold: "txt" | "bny",
  ): number {
    let out = offset;
    while (out < raw.length) {
      const item = parseMatter(raw.slice(out), cold);
      if (!isLabelerCode(item.code)) {
        break;
      }
      out += tokenSize(item, cold);
    }
    return out;
  }

  /** Strict native field extraction used for annotation and downstream semantics. */
  private extractNativeFields(
    raw: Uint8Array,
    cold: "txt" | "bny",
    fallbackVersion: Versionage,
  ): Array<{ label: string | null; code: string; qb64: string }> {
    const bodyCounter = parseCounter(raw, fallbackVersion, cold);
    if (MAP_BODY_CODES.has(bodyCounter.code)) {
      const mapper = parseMapperBody(raw, fallbackVersion, cold);
      return mapper.fields.map((field) => ({
        label: field.label,
        code: field.code,
        qb64: field.qb64,
      }));
    }

    const fields: Array<{ label: string | null; code: string; qb64: string }> =
      [];
    const total = tokenSize(bodyCounter, cold);
    const payloadBytes = bodyCounter.count * quadletUnit(cold);
    const start = total;
    const end = start + payloadBytes;
    let offset = start;
    let pendingLabel: string | null = null;

    while (offset < end) {
      const at = raw.slice(offset, end);
      const ctr = this.tryParseCounter(at, fallbackVersion, cold);
      if (ctr) {
        const size = tokenSize(ctr, cold);
        offset += size;
        fields.push({
          label: pendingLabel,
          code: ctr.code,
          qb64: ctr.qb64,
        });
        pendingLabel = null;
        continue;
      }

      const token = parseMatter(at, cold);
      const size = tokenSize(token, cold);
      offset += size;

      if (isLabelerCode(token.code)) {
        pendingLabel = parseLabeler(at, cold).label;
        continue;
      }

      fields.push({
        label: pendingLabel,
        code: token.code,
        qb64: token.qb64,
      });
      pendingLabel = null;
    }

    if (offset !== end) {
      throw new ShortageError(end, offset);
    }
    if (pendingLabel !== null) {
      throw new ColdStartError("Dangling native map label without value");
    }

    return fields;
  }

  /** Probe parseCounter with ordered major-version fallback. */
  private tryParseCounter(
    input: Uint8Array,
    version: Versionage,
    cold: "txt" | "bny",
  ): Counter | null {
    const attempts: Versionage[] = [
      version,
      { major: 2, minor: 0 },
      { major: 1, minor: 0 },
    ];
    for (const attempt of attempts) {
      try {
        return parseCounter(input, attempt, cold);
      } catch (error) {
        if (error instanceof ShortageError) {
          throw error;
        }
        if (
          error instanceof UnknownCodeError ||
          error instanceof DeserializeError
        ) {
          continue;
        }
        throw error;
      }
    }
    return null;
  }

  /** Resolve a valid frame-start counter, preferring current stream major version. */
  private resolveFrameStartCounter(
    input: Uint8Array,
    preferredVersion: Versionage,
    cold: "txt" | "bny",
  ): { counter: Counter; version: Versionage } {
    const alternate: Versionage = preferredVersion.major >= 2
      ? { major: 1, minor: 0 }
      : { major: 2, minor: 0 };
    const attempts = [preferredVersion, alternate];
    let firstParsed: { counter: Counter; version: Versionage } | null = null;
    let firstError: Error | null = null;

    for (const attempt of attempts) {
      try {
        const counter = parseCounter(input, attempt, cold);
        if (!firstParsed) {
          firstParsed = { counter, version: attempt };
        }
        if (FRAME_START_GROUP_NAMES.has(counter.name)) {
          return { counter, version: attempt };
        }
      } catch (error) {
        if (error instanceof ShortageError) {
          throw error;
        }
        if (
          error instanceof UnknownCodeError ||
          error instanceof DeserializeError
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
