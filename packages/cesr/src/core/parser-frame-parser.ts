import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import { sniff } from "../parser/cold-start.ts";
import type { AttachmentVersionFallbackPolicy } from "../parser/group-dispatch.ts";
import { parseCounter } from "../primitives/counter.ts";
import type { Counter } from "../primitives/counter.ts";
import { parseIlker } from "../primitives/ilker.ts";
import { isLabelerCode, parseLabeler } from "../primitives/labeler.ts";
import {
  interpretMapperBodySyntax,
  type MapperBodySyntax,
  parseMapperBodySyntax,
} from "../primitives/mapper.ts";
import { parseMatter } from "../primitives/matter.ts";
import type { Primitive } from "../primitives/primitive.ts";
import { parseVerser } from "../primitives/verser.ts";
import { reapSerder } from "../serder/serdery.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Kinds, type Protocol, Protocols } from "../tables/versions.ts";
import { b64ToInt, intToB64 } from "./bytes.ts";
import {
  ColdStartError,
  DeserializeError,
  SemanticInterpretationError,
  ShortageError,
  SyntaxParseError,
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
import type { FrameBoundaryPolicy } from "./parser-policy.ts";
import type { RecoveryDiagnosticObserver } from "./recovery-diagnostics.ts";
import type { CesrMessage } from "./types.ts";

/** Dependency-injected options for frame parsing behavior and hooks. */
interface FrameParserOptions {
  frameBoundaryPolicy: FrameBoundaryPolicy;
  attachmentVersionFallbackPolicy: AttachmentVersionFallbackPolicy;
  onEnclosedFrames: (frames: CesrMessage[]) => void;
  recoveryDiagnosticObserver?: RecoveryDiagnosticObserver;
}

/** Parsed frame-start result consumed by top-level parser orchestration. */
export interface ParsedFrameStart {
  frame: CesrMessage;
  consumed: number;
  version: Versionage;
  streamVersion: Versionage;
}

/** Frame-start classification produced by syntax parsing before behavior dispatch. */
type FrameStartSyntaxKind =
  | "message"
  | "bodyWithAttachmentGroup"
  | "nonNativeBodyGroup"
  | "nativeBodyGroup"
  | "genericGroup";

/** Token-level frame-start artifact before semantic dispatch interpretation. */
interface FrameStartSyntaxArtifact {
  /** Routed semantic branch for frame interpretation. */
  kind: FrameStartSyntaxKind;
  /** Byte offset where frame material begins after optional annotation bytes/selectors. */
  offset: number;
  /** Cold-start domain at frame start (`msg` or attachment domain). */
  cold: "msg" | "txt" | "bny";
  /** Stream version context after optional leading genus-version selector handling. */
  streamVersion: Versionage;
  /** Parsed body-group counter for non-message frame kinds. */
  counter?: Counter;
  /** Frame-local version selected while resolving frame-start counter. */
  frameVersion?: Versionage;
  /** Serialized header size of `counter` in active domain. */
  headerSize?: number;
  /** Payload unit width (`4` for qb64, `3` for qb2) used with counter counts. */
  unit?: number;
}

/**
 * Advisory metadata token syntax extracted from native body streams.
 *
 * All fields are optional because metadata extraction is best-effort and should
 * never fail native-body parsing if tokens are absent/malformed.
 */
interface NativeMetadataSyntaxArtifact {
  verser?: ReturnType<typeof parseVerser>;
  ilker?: ReturnType<typeof parseIlker>;
  saider?: ReturnType<typeof parseMatter>;
}

/**
 * One syntax-level token entry from a non-map native body payload.
 *
 * Labels are preserved as separate tokens; label/value pairing is resolved only
 * during semantic interpretation.
 */
type NativeFieldSyntaxEntry =
  | { kind: "label"; label: string; primitive: Primitive }
  | { kind: "value"; primitive: Primitive };

/**
 * Native field syntax representation.
 *
 * - `map`: delegates to mapper syntax artifacts for strict map payload parsing.
 * - `fixed`: preserves raw label/value token order for later semantic pairing.
 */
type NativeFieldSyntaxArtifact =
  | { kind: "map"; mapper: MapperBodySyntax }
  | { kind: "fixed"; entries: NativeFieldSyntaxEntry[] };

/** Combined syntax artifact for native-body metadata + field tokenization. */
interface NativeBodySyntaxArtifact {
  metadata: NativeMetadataSyntaxArtifact;
  fields: NativeFieldSyntaxArtifact;
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
  private readonly frameBoundaryPolicy: FrameBoundaryPolicy;
  private readonly attachmentVersionFallbackPolicy: AttachmentVersionFallbackPolicy;
  private readonly onEnclosedFrames: (frames: CesrMessage[]) => void;
  private readonly recoveryDiagnosticObserver?: RecoveryDiagnosticObserver;

  constructor(options: FrameParserOptions) {
    this.frameBoundaryPolicy = options.frameBoundaryPolicy;
    this.attachmentVersionFallbackPolicy = options.attachmentVersionFallbackPolicy;
    this.onEnclosedFrames = options.onEnclosedFrames;
    this.recoveryDiagnosticObserver = options.recoveryDiagnosticObserver;
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
    const syntax = this.parseFrameStartSyntax(input, inheritedVersion);
    return this.interpretFrameStartSyntax(input, syntax);
  }

  /**
   * Parse frame-start tokens into a syntax artifact.
   *
   * Non-goal: this is not a global two-pass parser rewrite. It only separates
   * the highest-coupling frame-start syntax extraction from semantic dispatch.
   */
  private parseFrameStartSyntax(
    input: Uint8Array,
    inheritedVersion: Versionage,
  ): FrameStartSyntaxArtifact {
    let offset = 0;
    let activeVersion = inheritedVersion;

    let cold = sniff(input.slice(offset));
    while (cold === "ano") {
      offset += 1;
      if (input.length <= offset) {
        throw new ShortageError(offset + 1, input.length);
      }
      cold = sniff(input.slice(offset));
    }

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
      return {
        kind: "message",
        offset,
        cold,
        streamVersion: activeVersion,
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

    if (BODY_WITH_ATTACHMENT_GROUP_NAMES.has(counter.name)) {
      return {
        kind: "bodyWithAttachmentGroup",
        offset,
        cold,
        streamVersion: frameVersion,
        counter,
        frameVersion,
        headerSize,
        unit,
      };
    }
    if (NON_NATIVE_BODY_GROUP_NAMES.has(counter.name)) {
      return {
        kind: "nonNativeBodyGroup",
        offset,
        cold,
        streamVersion: frameVersion,
        counter,
        frameVersion,
        headerSize,
        unit,
      };
    }
    if (NATIVE_BODY_GROUP_NAMES.has(counter.name)) {
      return {
        kind: "nativeBodyGroup",
        offset,
        cold,
        streamVersion: frameVersion,
        counter,
        frameVersion,
        headerSize,
        unit,
      };
    }
    if (GENERIC_GROUP_NAMES.has(counter.name)) {
      return {
        kind: "genericGroup",
        offset,
        cold,
        streamVersion: frameVersion,
        counter,
        frameVersion,
        headerSize,
        unit,
      };
    }

    throw new ColdStartError(
      `Unsupported body-group counter at frame start: ${counter.code}`,
    );
  }

  /** Interpret frame-start syntax artifacts into semantic parse behavior. */
  private interpretFrameStartSyntax(
    input: Uint8Array,
    syntax: FrameStartSyntaxArtifact,
  ): ParsedFrameStart {
    const requireGroupMetadata = () => {
      const counter = syntax.counter;
      const frameVersion = syntax.frameVersion;
      const headerSize = syntax.headerSize;
      const unit = syntax.unit;
      if (!counter || !frameVersion || !headerSize || !unit) {
        throw new SemanticInterpretationError(
          "Frame-start syntax artifact missing required group metadata",
        );
      }
      return { counter, frameVersion, headerSize, unit };
    };

    switch (syntax.kind) {
      case "message": {
        const { serder, consumed } = reapSerder(input.slice(syntax.offset));
        return {
          frame: { body: serder, attachments: [] },
          consumed: syntax.offset + consumed,
          version: serder.gvrsn ?? serder.pvrsn,
          streamVersion: serder.gvrsn ?? serder.pvrsn,
        };
      }
      case "bodyWithAttachmentGroup": {
        const { counter, frameVersion, headerSize, unit } = requireGroupMetadata();
        return this.parseBodyWithAttachmentGroup(
          input,
          syntax.offset,
          headerSize,
          counter.count,
          unit,
          frameVersion,
          syntax.streamVersion,
        );
      }
      case "nonNativeBodyGroup": {
        if (syntax.cold !== "txt" && syntax.cold !== "bny") {
          throw new SemanticInterpretationError(
            `Expected attachment domain for non-native body but got ${syntax.cold}`,
          );
        }
        const { counter, frameVersion, headerSize, unit } = requireGroupMetadata();
        return this.parseNonNativeBodyGroup(
          input,
          syntax.offset,
          headerSize,
          counter.count,
          unit,
          syntax.cold,
          frameVersion,
          syntax.streamVersion,
        );
      }
      case "nativeBodyGroup": {
        if (syntax.cold !== "txt" && syntax.cold !== "bny") {
          throw new SemanticInterpretationError(
            `Expected attachment domain for native body but got ${syntax.cold}`,
          );
        }
        const { counter, frameVersion, headerSize, unit } = requireGroupMetadata();
        return this.parseNativeBodyGroup(
          input,
          syntax.offset,
          headerSize,
          counter.count,
          unit,
          syntax.cold,
          frameVersion,
          counter.code,
          syntax.streamVersion,
        );
      }
      case "genericGroup": {
        const { counter, frameVersion, headerSize, unit } = requireGroupMetadata();
        return this.parseGenericGroup(
          input,
          syntax.offset,
          headerSize,
          counter.count,
          unit,
          frameVersion,
          syntax.streamVersion,
        );
      }
    }
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
    const syntax = this.parseNativeBodySyntax(raw, cold, version);
    const metadata = this.interpretNativeMetadataSyntax(
      syntax.metadata,
      version,
    );
    const fields = this.interpretNativeFieldSyntax(syntax.fields);
    let body: CesrMessage["body"];
    try {
      // Upgrade real native message bodies into full serders so downstream
      // runtime code gets the normal `ked`/`said`/accessor surface.
      // Example text-domain shape:
      //   -FA5 | 0OKERICAACA | Xicp | E... | D... | M... | ...
      const { serder } = reapSerder(raw);
      (serder as CesrMessage["body"]).native = {
        bodyCode,
        fields,
      };
      body = serder;
    } catch {
      // Some parser-hardening/native-fixture corpora are valid native body
      // groups without being full protocol messages. Preserve the older
      // metadata-only fallback for those cases instead of forcing every native
      // body through full serder semantics.
      body = {
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
      };
    }
    return {
      frame: {
        body,
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
            versionFallbackPolicy: this.attachmentVersionFallbackPolicy,
            onRecoveryDiagnostic: this.recoveryDiagnosticObserver,
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
          versionFallbackPolicy: this.attachmentVersionFallbackPolicy,
          onRecoveryDiagnostic: this.recoveryDiagnosticObserver,
        },
      );
      attachments.push(group);
      offset += consumed;
      if (this.frameBoundaryPolicy.shouldStopAfterAttachmentGroupCollection()) {
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

  /** Build native-body syntax artifacts used by semantic interpretation phase. */
  private parseNativeBodySyntax(
    raw: Uint8Array,
    cold: "txt" | "bny",
    fallbackVersion: Versionage,
  ): NativeBodySyntaxArtifact {
    try {
      const bodyCounter = parseCounter(raw, fallbackVersion, cold);
      return {
        metadata: this.parseNativeMetadataSyntax(
          raw,
          cold,
          fallbackVersion,
          bodyCounter.code,
        ),
        fields: this.parseNativeFieldSyntax(
          raw,
          cold,
          fallbackVersion,
          bodyCounter.code,
        ),
      };
    } catch (error) {
      if (
        error instanceof ShortageError
        || error instanceof UnknownCodeError
        || error instanceof DeserializeError
      ) {
        throw new SyntaxParseError(
          `Native body syntax parse failed: ${error.message}`,
          error,
        );
      }
      throw error;
    }
  }

  /** Parse advisory native metadata tokens without semantic projection. */
  private parseNativeMetadataSyntax(
    raw: Uint8Array,
    cold: "txt" | "bny",
    fallbackVersion: Versionage,
    bodyCode: string,
  ): NativeMetadataSyntaxArtifact {
    const out: NativeMetadataSyntaxArtifact = {};
    let offset = 0;

    try {
      const bodyCounter = parseCounter(raw, fallbackVersion, cold);
      offset += tokenSize(bodyCounter, cold);

      if (MAP_BODY_CODES.has(bodyCode)) {
        offset = this.skipNativeLabelers(raw, offset, cold);
      }

      out.verser = parseVerser(raw.slice(offset), cold);
      offset += tokenSize(out.verser, cold);

      if (MAP_BODY_CODES.has(bodyCode)) {
        offset = this.skipNativeLabelers(raw, offset, cold);
      }

      out.ilker = parseIlker(raw.slice(offset), cold);
      offset += tokenSize(out.ilker, cold);

      if (MAP_BODY_CODES.has(bodyCode)) {
        offset = this.skipNativeLabelers(raw, offset, cold);
      }

      out.saider = parseMatter(raw.slice(offset), cold);
    } catch (_error) {
      // metadata parse remains advisory; do not fail native-body parse when absent.
    }

    return out;
  }

  /** Interpret advisory metadata syntax into projected body metadata fields. */
  private interpretNativeMetadataSyntax(
    syntax: NativeMetadataSyntaxArtifact,
    fallbackVersion: Versionage,
  ): {
    proto: "KERI" | "ACDC";
    pvrsn: Versionage;
    gvrsn: Versionage;
    ilk: string | null;
    said: string | null;
  } {
    return {
      proto: (syntax.verser?.proto as Protocol | undefined) ?? Protocols.keri,
      pvrsn: syntax.verser?.pvrsn ?? fallbackVersion,
      gvrsn: syntax.verser?.gvrsn ?? fallbackVersion,
      ilk: syntax.ilker?.ilk ?? null,
      said: syntax.saider?.code.startsWith("E") ? syntax.saider.qb64 : null,
    };
  }

  /** Parse native field tokens without resolving label/value pairing semantics. */
  private parseNativeFieldSyntax(
    raw: Uint8Array,
    cold: "txt" | "bny",
    fallbackVersion: Versionage,
    bodyCode: string,
  ): NativeFieldSyntaxArtifact {
    if (MAP_BODY_CODES.has(bodyCode)) {
      return {
        kind: "map",
        mapper: parseMapperBodySyntax(raw, fallbackVersion, cold),
      };
    }

    const bodyCounter = parseCounter(raw, fallbackVersion, cold);
    const total = tokenSize(bodyCounter, cold);
    const payloadBytes = bodyCounter.count * quadletUnit(cold);
    const start = total;
    const end = start + payloadBytes;
    const entries: NativeFieldSyntaxEntry[] = [];
    let offset = start;

    while (offset < end) {
      const at = raw.slice(offset, end);
      const ctr = this.tryParseCounter(at, fallbackVersion, cold);
      if (ctr) {
        const size = tokenSize(ctr, cold);
        entries.push({
          kind: "value",
          primitive: ctr,
        });
        offset += size;
        continue;
      }

      const token = parseMatter(at, cold);
      const size = tokenSize(token, cold);
      offset += size;

      if (isLabelerCode(token.code)) {
        entries.push({
          kind: "label",
          label: parseLabeler(at, cold).label,
          primitive: token,
        });
        continue;
      }

      entries.push({
        kind: "value",
        primitive: token,
      });
    }

    if (offset !== end) {
      throw new ShortageError(end, offset);
    }
    return { kind: "fixed", entries };
  }

  /** Interpret native field syntax into semantic fields with label/value pairing. */
  private interpretNativeFieldSyntax(
    syntax: NativeFieldSyntaxArtifact,
  ): Array<{ label: string | null; primitive: Primitive }> {
    if (syntax.kind === "map") {
      try {
        return interpretMapperBodySyntax(syntax.mapper).map((field) => ({
          label: field.label,
          primitive: field.primitive,
        }));
      } catch (error) {
        if (error instanceof SemanticInterpretationError) {
          throw new SemanticInterpretationError(
            `Native body semantic interpretation failed: ${(error as Error).message}`,
            error,
          );
        }
        throw error;
      }
    }

    const out: Array<{ label: string | null; primitive: Primitive }> = [];
    let pendingLabel: string | null = null;
    for (const entry of syntax.entries) {
      if (entry.kind === "label") {
        pendingLabel = entry.label;
        continue;
      }
      out.push({
        label: pendingLabel,
        primitive: entry.primitive,
      });
      pendingLabel = null;
    }
    if (pendingLabel !== null) {
      throw new SemanticInterpretationError(
        "Dangling native map label without value",
      );
    }
    return out;
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
          error instanceof UnknownCodeError
          || error instanceof DeserializeError
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
