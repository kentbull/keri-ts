import { concatBytes } from "./bytes.ts";
import type {
  AttachmentGroup,
  CesrFrame,
  CesrMessage,
  ParserState,
} from "./types.ts";
import { sniff } from "../parser/cold-start.ts";
import { reapSerder } from "../serder/serdery.ts";
import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import type {
  AttachmentDispatchMode,
  AttachmentDispatchOptions,
  VersionFallbackInfo,
} from "../parser/group-dispatch.ts";
import {
  ColdStartError,
  DeserializeError,
  ParserError,
  ShortageError,
  UnknownCodeError,
} from "./errors.ts";
import { parseCounter } from "../primitives/counter.ts";
import type { Counter } from "../primitives/counter.ts";
import { parseMatter } from "../primitives/matter.ts";
import { parseVerser } from "../primitives/verser.ts";
import { parseIlker } from "../primitives/ilker.ts";
import { isLabelerCode, parseLabeler } from "../primitives/labeler.ts";
import { parseMapperBody } from "../primitives/mapper.ts";
import type { Versionage } from "../tables/table-types.ts";
import { CtrDexV1, CtrDexV2 } from "../tables/counter-codex.ts";
import { b64ToInt, intToB64 } from "./bytes.ts";
import { Kinds, type Protocol, Protocols } from "../tables/versions.ts";

export interface ParserOptions {
  framed?: boolean;
  attachmentDispatchMode?: AttachmentDispatchOptions["mode"];
  onAttachmentVersionFallback?: (info: VersionFallbackInfo) => void;
}

const DEFAULT_VERSION: Versionage = { major: 2, minor: 0 };

const BODY_WITH_ATTACH_CODES = new Set([
  CtrDexV1.BodyWithAttachmentGroup,
  CtrDexV1.BigBodyWithAttachmentGroup,
  CtrDexV2.BodyWithAttachmentGroup,
  CtrDexV2.BigBodyWithAttachmentGroup,
]);

const NON_NATIVE_BODY_CODES = new Set([
  CtrDexV1.NonNativeBodyGroup,
  CtrDexV1.BigNonNativeBodyGroup,
  CtrDexV2.NonNativeBodyGroup,
  CtrDexV2.BigNonNativeBodyGroup,
]);

const FIX_BODY_CODES = new Set([
  CtrDexV2.FixBodyGroup,
  CtrDexV2.BigFixBodyGroup,
]);

const MAP_BODY_CODES = new Set([
  CtrDexV2.MapBodyGroup,
  CtrDexV2.BigMapBodyGroup,
]);

const GENERIC_GROUP_CODES = new Set([
  CtrDexV1.GenericGroup,
  CtrDexV1.BigGenericGroup,
  CtrDexV2.GenericGroup,
  CtrDexV2.BigGenericGroup,
]);

const GENUS_VERSION_CODE = CtrDexV2.KERIACDCGenusVersion;

function tokenSize(
  token: { fullSize: number; fullSizeB2: number },
  cold: "txt" | "bny",
): number {
  return cold === "bny" ? token.fullSizeB2 : token.fullSize;
}

function quadletUnit(cold: "txt" | "bny"): number {
  return cold === "bny" ? 3 : 4;
}

function isAttachmentDomain(cold: string): cold is "txt" | "bny" {
  return cold === "txt" || cold === "bny";
}

/** Counter codes that begin a new frame domain rather than an attachment domain. */
function isFrameBoundaryCounterCode(code: string): boolean {
  return BODY_WITH_ATTACH_CODES.has(code) ||
    NON_NATIVE_BODY_CODES.has(code) ||
    FIX_BODY_CODES.has(code) ||
    MAP_BODY_CODES.has(code) ||
    GENERIC_GROUP_CODES.has(code) ||
    code === GENUS_VERSION_CODE;
}

/**
 * Streaming CESR parser for message-domain and CESR-native body-group streams.
 * Handles chunk boundaries, pending frames, and attachment continuation.
 *
 * @param options - Parser options
 * @param options.framed - Whether input is externally frame-delimited
 * @param options.attachmentDispatchMode - Attachment dispatch mode ('strict' version handling or 'compat' version parsing fallback)
 * @param options.onAttachmentVersionFallback - Callback for attachment version fallback
 */
export class CesrParser {
  private state: ParserState = { buffer: new Uint8Array(0), offset: 0 };
  /** Active top-level stream version (affected by leading genus-version counters). */
  private streamVersion: Versionage = DEFAULT_VERSION;
  /**
   * Determines how frame (CESR Message of body + atc) boundaries are established.
   *
   * - `false` (default): unframed stream mode.
   *   Parser infers boundaries from CESR structure, greedily parses trailing
   *   attachment groups, and may defer body-only end-of-buffer emission until
   *   more bytes arrive or `flush()` is called.
   *
   * - `true`: externally framed mode.
   *   Caller is expected to provide frame-delimited input. Parser prefers early
   *   emission and bounded work per `feed()` call instead of greedy lookahead.
   *
   * Use `true` only when frame boundaries are known by the caller.
   * Note: `true` is an emission policy, not a completeness guarantee; shortages
   * still defer emission.
   */
  private readonly framed: boolean;
  /**
   * Controls how attachment groups are parsed based on the major CESR version.
   *
   * - `strict`: no version fallback; strict mode throws on unknown codes.
   * - `compat`: version fallback; tries v1 parse if v2 fails.
   *   Use when caller wants to tolerate version mismatches but prefers v2 parsing.
   */
  private readonly attachmentDispatchMode: AttachmentDispatchMode;
  /**
   * Callback for attachment version fallback.
   *
   * - `info`: version fallback information
   *   Use when caller wants to be notified of version fallback.
   */
  private readonly onAttachmentVersionFallback?: (
    info: VersionFallbackInfo,
  ) => void;

  /**
   * Pending frame to be emitted when more bytes are available.
   *
   * - `frame`: the CESrMessage
   * - `version`: the version of the CESR Message
   */
  private pendingFrame:
    | { frame: CesrMessage; version: Versionage }
    | null = null;
  /** Extra complete frames extracted from one GenericGroup payload. */
  private queuedFrames: CesrMessage[] = [];

  constructor(options: ParserOptions = {}) {
    this.framed = options.framed ?? false;
    this.attachmentDispatchMode = options.attachmentDispatchMode ?? "compat";
    this.onAttachmentVersionFallback = options.onAttachmentVersionFallback;
  }

  /** Append bytes and emit any complete parse events. */
  feed(chunk: Uint8Array): CesrFrame[] {
    this.state.buffer = concatBytes(this.state.buffer, chunk);
    return this.drain();
  }

  /** Flush pending state at end-of-stream, emitting frame/error if needed. */
  flush(): CesrFrame[] {
    const out: CesrFrame[] = [];
    // Queued GenericGroup frames are complete and safe to emit first.
    while (this.queuedFrames.length > 0) {
      const frame = this.queuedFrames.shift();
      if (frame) {
        out.push({ type: "frame", frame });
      }
    }
    if (this.pendingFrame) {
      out.push({ type: "frame", frame: this.pendingFrame.frame });
      this.pendingFrame = null;
    }
    if (this.state.buffer.length === 0) return out;
    out.push({
      type: "error",
      error: new ShortageError(
        this.state.buffer.length + 1,
        this.state.buffer.length,
        this.state.offset,
      ),
    });
    return out;
  }

  reset(): void {
    this.state = { buffer: new Uint8Array(0), offset: 0 };
    this.pendingFrame = null;
    this.queuedFrames = [];
    this.streamVersion = DEFAULT_VERSION;
  }

  /**
   * Core streaming loop.
   * Keeps state machine behavior explicit: consume separators, parse a base
   * frame, then greedily collect trailing attachment groups.
   */
  private drain(): CesrFrame[] {
    const out: CesrFrame[] = [];

    while (this.state.buffer.length > 0) {
      try {
        this.consumeLeadingAno();
        if (this.state.buffer.length === 0) {
          break;
        }

        if (this.pendingFrame) {
          if (!this.resumePendingFrame(out)) {
            break;
          }
          continue;
        }
        // Emit deferred enclosed frames extracted from prior GenericGroup payload.
        if (this.queuedFrames.length > 0) {
          const frame = this.queuedFrames.shift();
          if (frame) {
            out.push({ type: "frame", frame });
            if (this.framed) break;
          }
          continue;
        }

        const base = this.parseFrame(this.state.buffer, this.streamVersion);
        this.consume(base.consumed);
        this.streamVersion = base.streamVersion;
        const attachments = [...base.frame.attachments];
        const version = base.version;
        const streamVersion = base.streamVersion;
        let pausedForAttachmentShortage = false;
        try {
          while (this.state.buffer.length > 0) {
            const nextCold = sniff(this.state.buffer);
            if (nextCold === "msg") break;
            if (nextCold === "ano") {
              this.consumeLeadingAno();
              continue;
            }
            if (!isAttachmentDomain(nextCold)) {
              throw new ColdStartError(
                `Unsupported attachment cold code ${nextCold}`,
              );
            }
            if (
              base.frame.body.kind === Kinds.cesr &&
              this.isNativeFrameBoundaryAhead(
                this.state.buffer,
                streamVersion,
                nextCold,
              )
            ) {
              // Native streams may begin a new top-level frame with counter codes.
              break;
            }
            const { group, consumed } = parseAttachmentGroup(
              this.state.buffer,
              version,
              nextCold,
              {
                mode: this.attachmentDispatchMode,
                onVersionFallback: this.onAttachmentVersionFallback,
              },
            );
            attachments.push(group);
            this.consume(consumed);
            if (this.framed) break;
          }
        } catch (error) {
          if (error instanceof ShortageError) {
            this.pendingFrame = {
              frame: { body: base.frame.body, attachments },
              version,
            };
            pausedForAttachmentShortage = true;
          } else {
            throw error;
          }
        }
        if (pausedForAttachmentShortage) {
          break;
        }

        const completed: CesrMessage = {
          body: base.frame.body,
          attachments,
        };

        if (
          !this.framed && attachments.length === 0 &&
          this.state.buffer.length === 0
        ) {
          this.pendingFrame = { frame: completed, version };
          break;
        }

        out.push({ type: "frame", frame: completed });
        if (this.framed) break;
      } catch (error) {
        if (error instanceof ShortageError) {
          break;
        }
        const normalized = error instanceof ParserError
          ? error
          : new ParserError(String(error), this.state.offset);
        out.push({ type: "error", error: normalized });
        this.reset();
        break;
      }
    }

    return out;
  }

  /**
   * Continue parsing attachments for `pendingFrame` using newly arrived bytes.
   *
   * Returns:
   * - `true`: caller may continue drain loop immediately.
   * - `false`: parser should pause and wait for more bytes.
   */
  private resumePendingFrame(out: CesrFrame[]): boolean {
    if (!this.pendingFrame) return false;
    if (this.state.buffer.length === 0) return false;

    const nextCold = sniff(this.state.buffer);
    if (nextCold === "ano") {
      this.consumeLeadingAno();
      return this.state.buffer.length > 0;
    }
    if (nextCold === "msg") {
      out.push({ type: "frame", frame: this.pendingFrame.frame });
      this.pendingFrame = null;
      return true;
    }
    if (!isAttachmentDomain(nextCold)) {
      throw new ColdStartError(
        `Unsupported pending-frame continuation cold code ${nextCold}`,
      );
    }

    // CESR native
    if (this.pendingFrame.frame.body.kind === Kinds.cesr) {
      if (
        this.isNativeFrameBoundaryAhead(
          this.state.buffer,
          this.streamVersion,
          nextCold,
        )
      ) {
        out.push({ type: "frame", frame: this.pendingFrame.frame });
        this.pendingFrame = null;
        return true;
      }
      // Otherwise treat the next token as attachment material for this frame.
    }

    const consumed = this.appendAttachmentGroup(
      this.pendingFrame.frame.attachments,
      this.state.buffer,
      this.pendingFrame.version,
      nextCold,
    );
    this.consume(consumed);

    if (this.framed) {
      out.push({ type: "frame", frame: this.pendingFrame.frame });
      this.pendingFrame = null;
      return false;
    }

    if (this.state.buffer.length === 0) {
      return false;
    }

    const afterCold = sniff(this.state.buffer);
    if (afterCold === "ano") {
      this.consumeLeadingAno();
      return this.state.buffer.length > 0;
    }
    if (afterCold === "msg") {
      out.push({ type: "frame", frame: this.pendingFrame.frame });
      this.pendingFrame = null;
      return true;
    }
    // Conservative: keep pending frame open when stream stays in attachment domain.
    return true;
  }

  private consume(length: number): void {
    this.state.buffer = this.state.buffer.slice(length);
    this.state.offset += length;
  }

  private consumeLeadingAno(): void {
    while (this.state.buffer.length > 0 && sniff(this.state.buffer) === "ano") {
      this.consume(1);
    }
  }

  /** Probe whether next token is a native-body/frame boundary counter. */
  private isNativeFrameBoundaryAhead(
    input: Uint8Array,
    version: Versionage,
    cold: "txt" | "bny",
  ): boolean {
    const peek = parseCounter(input, version, cold);
    return isFrameBoundaryCounterCode(peek.code);
  }

  /** Parse one attachment group and append it to `target`. */
  private appendAttachmentGroup(
    target: AttachmentGroup[],
    input: Uint8Array,
    version: Versionage,
    cold: "txt" | "bny",
  ): number {
    const { group, consumed } = parseAttachmentGroup(
      input,
      version,
      cold,
      {
        mode: this.attachmentDispatchMode,
        onVersionFallback: this.onAttachmentVersionFallback,
      },
    );
    target.push(group);
    return consumed;
  }

  /**
   * Parse one frame body start at the current head and return its consumed span.
   *
   * Contract:
   * - consumes optional leading `ano` bytes
   * - consumes optional leading genus-version counter and updates active version
   * - parses exactly one body start form:
   *   - message-domain serder (`msg`)
   *   - CESR body-group counter (`txt`/`bny`)
   * - does not greedily parse trailing attachments in message streams
   */
  private parseFrame(
    input: Uint8Array,
    inheritedVersion: Versionage = DEFAULT_VERSION,
  ): {
    frame: CesrMessage;
    consumed: number;
    version: Versionage;
    streamVersion: Versionage;
  } {
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
      // Optional stream-level genus-version prefix before frame body start.
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
      // Message-body parse only; attachments are collected by the caller.
      return {
        frame: { body: serder, attachments: [] },
        consumed: offset + consumed,
        version: serder.gvrsn ?? serder.pvrsn,
        streamVersion: activeVersion,
      };
    }

    if (!isAttachmentDomain(cold)) {
      throw new ColdStartError(
        `Expected message or CESR body group at frame start but got ${cold}`,
      );
    }

    const counter = parseCounter(input.slice(offset), activeVersion, cold);
    const headerSize = tokenSize(counter, cold);
    const unit = quadletUnit(cold);

    // Body-group counters identify frame starts in CESR-native streams.
    if (BODY_WITH_ATTACH_CODES.has(counter.code)) {
      return this.parseBodyWithAttachmentGroup(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        activeVersion,
        activeVersion,
      );
    }

    if (NON_NATIVE_BODY_CODES.has(counter.code)) {
      return this.parseNonNativeBodyGroup(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        cold,
        activeVersion,
        activeVersion,
      );
    }

    if (FIX_BODY_CODES.has(counter.code) || MAP_BODY_CODES.has(counter.code)) {
      return this.parseNativeBodyGroup(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        cold,
        activeVersion,
        counter.code,
        activeVersion,
      );
    }
    if (GENERIC_GROUP_CODES.has(counter.code)) {
      return this.parseGenericGroup(
        input,
        offset,
        headerSize,
        counter.count,
        unit,
        activeVersion,
        activeVersion,
      );
    }

    throw new ColdStartError(
      `Unsupported body-group counter at frame start: ${counter.code}`,
    );
  }

  /** Parse wrapped body+attachments payloads as a complete nested frame. */
  private parseBodyWithAttachmentGroup(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    version: Versionage,
    streamVersion: Versionage,
  ): {
    frame: CesrMessage;
    consumed: number;
    version: Versionage;
    streamVersion: Versionage;
  } {
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
      version: nested.frame.body.gvrsn ?? nested.frame.body.pvrsn,
      streamVersion,
    };
  }

  /** Parse a non-native body group; keep opaque fallback when serder reap fails. */
  private parseNonNativeBodyGroup(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    cold: "txt" | "bny",
    version: Versionage,
    streamVersion: Versionage,
  ): {
    frame: CesrMessage;
    consumed: number;
    version: Versionage;
    streamVersion: Versionage;
  } {
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
      // Intentional recovery: NonNativeBodyGroup payload is opaque CESR body data.
      // If it cannot be interpreted as a KERI/ACDC Serder, preserve bytes and
      // continue with conservative metadata instead of failing the frame parse.
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

  /** Parse fixed/map native body groups and extract semantic native fields. */
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
  ): {
    frame: CesrMessage;
    consumed: number;
    version: Versionage;
    streamVersion: Versionage;
  } {
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

  /** Decode genus-version counter suffix to active CESR version. */
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

  /**
   * Best-effort native metadata extraction.
   * This is intentionally advisory and may recover instead of failing hard.
   */
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
      // In map-body mode, labels may appear between semantic fields.
      // Metadata extraction skips those labels before reading core fields.

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
      // Intentional recovery: native metadata extraction is advisory only.
      // Strict token validation happens in extractNativeFields/mapper parsing.
    }

    return { proto, pvrsn, gvrsn, ilk, said };
  }

  /** Skip consecutive native label tokens (V/W) from an offset. */
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

  /** Strict native field extraction for annotation and higher-level processing. */
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

  /** Counter probe with ordered version fallback; throws on shortage. */
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

  /**
   * Parse GenericGroup payload into enclosed frames.
   * Returns the first enclosed frame and queues any remaining frames for emission.
   */
  private parseGenericGroup(
    input: Uint8Array,
    offset: number,
    headerSize: number,
    count: number,
    unit: number,
    version: Versionage,
    streamVersion: Versionage,
  ): {
    frame: CesrMessage;
    consumed: number;
    version: Versionage;
    streamVersion: Versionage;
  } {
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
      this.queuedFrames.push(...rest);
    }

    return {
      frame: first,
      consumed: offset + total,
      version: first.body.gvrsn ?? first.body.pvrsn,
      streamVersion,
    };
  }

  /**
   * Parse every frame inside one GenericGroup payload slice.
   * Input is already size-bounded by the GenericGroup counter.
   */
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

        if (base.frame.body.kind === Kinds.cesr) {
          if (
            this.isNativeFrameBoundaryAhead(
              input.slice(offset),
              streamVersion,
              nextCold,
            )
          ) {
            // Native streams may begin a new frame with counter codes.
            break;
          }
        }

        const consumed = this.appendAttachmentGroup(
          attachments,
          input.slice(offset),
          frameVersion,
          nextCold,
        );
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

  /**
   * Parse one complete frame from a bounded slice, including trailing attachments.
   *
   * Uses `parseFrame()` for body start, then collects attachment groups until:
   * - end of input
   * - next message start (`msg`) when `stopAtNextMessage` is true
   * - first attachment group in `framed` mode (bounded emission policy)
   */
  private parseCompleteFrame(
    input: Uint8Array,
    inheritedVersion: Versionage = DEFAULT_VERSION,
    stopAtNextMessage = true,
  ): { frame: CesrMessage; consumed: number } {
    const base = this.parseFrame(input, inheritedVersion);
    const version = base.version;
    const attachments: AttachmentGroup[] = [];
    let offset = base.consumed;

    while (offset < input.length) {
      const nextCold = sniff(input.slice(offset));
      if (nextCold === "ano") {
        offset += 1;
        continue;
      }
      if (nextCold === "msg") {
        if (stopAtNextMessage) break;
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
      if (this.framed) break;
    }

    return {
      frame: { body: base.frame.body, attachments },
      consumed: offset,
    };
  }
}

/** CESR parser factory function. */
export function createParser(options: ParserOptions = {}): CesrParser {
  return new CesrParser(options);
}

/** Parse a buffer of bytes into a list of frames. */
export function parseBytes(
  bytes: Uint8Array,
  options: ParserOptions = {},
): CesrFrame[] {
  const parser = createParser(options);
  return [...parser.feed(bytes), ...parser.flush()];
}
