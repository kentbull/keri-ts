import { concatBytes } from "./bytes.ts";
import type { CesrFrame, ParseEmission, ParserState } from "./types.ts";
import { sniff } from "../parser/cold-start.ts";
import { reapSerder } from "../serder/serdery.ts";
import { parseAttachmentGroup } from "../parser/attachment-parser.ts";
import { ColdStartError, ParserError, ShortageError } from "./errors.ts";
import { parseCounter } from "../primitives/counter.ts";
import type { Counter } from "../primitives/counter.ts";
import { parseMatter } from "../primitives/matter.ts";
import type { Versionage } from "../tables/table-types.ts";
import { CtrDexV1, CtrDexV2 } from "../tables/counter-codex.ts";
import { b64ToInt, intToB64 } from "./bytes.ts";
import { Kinds, Protocols } from "../tables/versions.ts";

export interface ParserOptions {
  framed?: boolean;
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

const GENUS_VERSION_CODE = CtrDexV2.KERIACDCGenusVersion;

export class CesrParserCore {
  private state: ParserState = { buffer: new Uint8Array(0), offset: 0 };
  private readonly framed: boolean;

  constructor(options: ParserOptions = {}) {
    this.framed = options.framed ?? false;
  }

  feed(chunk: Uint8Array): ParseEmission[] {
    this.state.buffer = concatBytes(this.state.buffer, chunk);
    return this.drain();
  }

  flush(): ParseEmission[] {
    if (this.state.buffer.length === 0) return [];
    return [{
      type: "error",
      error: new ShortageError(
        this.state.buffer.length + 1,
        this.state.buffer.length,
        this.state.offset,
      ),
    }];
  }

  reset(): void {
    this.state = { buffer: new Uint8Array(0), offset: 0 };
  }

  private drain(): ParseEmission[] {
    const out: ParseEmission[] = [];

    while (this.state.buffer.length > 0) {
      try {
        const { frame, consumed } = this.parseCompleteFrame(this.state.buffer);
        this.consume(consumed);
        out.push({ type: "frame", frame });
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

  private consume(length: number): void {
    this.state.buffer = this.state.buffer.slice(length);
    this.state.offset += length;
  }

  private parseFrame(
    input: Uint8Array,
    inheritedVersion: Versionage = DEFAULT_VERSION,
  ): { frame: CesrFrame; consumed: number; version: Versionage } {
    let offset = 0;
    let activeVersion = inheritedVersion;

    let cold = sniff(input.slice(offset));
    if (cold === "txt" || cold === "bny") {
      const peek = parseCounter(input.slice(offset), activeVersion, cold);
      if (peek.code === GENUS_VERSION_CODE) {
        offset += cold === "bny" ? peek.fullSizeB2 : peek.fullSize;
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
        frame: { serder, attachments: [] },
        consumed: offset + consumed,
        version: serder.gvrsn ?? serder.pvrsn,
      };
    }

    if (cold !== "txt" && cold !== "bny") {
      throw new ColdStartError(
        `Expected message or CESR body group at frame start but got ${cold}`,
      );
    }

    const counter = parseCounter(input.slice(offset), activeVersion, cold);
    const headerSize = cold === "bny" ? counter.fullSizeB2 : counter.fullSize;
    const unit = cold === "bny" ? 3 : 4;

    if (BODY_WITH_ATTACH_CODES.has(counter.code)) {
      const payloadSize = counter.count * unit;
      const total = headerSize + payloadSize;
      if (input.length < offset + total) {
        throw new ShortageError(offset + total, input.length);
      }
      const payload = input.slice(offset + headerSize, offset + total);
      const nested = this.parseCompleteFrame(payload, activeVersion, false);
      if (nested.consumed !== payload.length) {
        throw new ColdStartError(
          "BodyWithAttachmentGroup payload did not parse to a complete frame",
        );
      }
      return {
        frame: nested.frame,
        consumed: offset + total,
        version: nested.frame.serder.gvrsn ?? nested.frame.serder.pvrsn,
      };
    }

    if (NON_NATIVE_BODY_CODES.has(counter.code)) {
      const matter = parseMatter(input.slice(offset + headerSize), cold);
      const bodySize = cold === "bny" ? matter.fullSizeB2 : matter.fullSize;
      const payloadSize = counter.count * unit;
      if (payloadSize > 0 && payloadSize < bodySize) {
        throw new ColdStartError(
          `NonNativeBodyGroup payload shorter than enclosed matter size`,
        );
      }

      try {
        const { serder } = reapSerder(matter.raw);
        return {
          frame: { serder, attachments: [] },
          consumed: offset + headerSize + bodySize,
          version: serder.gvrsn ?? serder.pvrsn,
        };
      } catch {
        return {
          frame: {
            serder: {
              raw: matter.raw,
              ked: null,
              proto: Protocols.keri,
              kind: Kinds.cesr,
              size: matter.raw.length,
              pvrsn: activeVersion,
              gvrsn: activeVersion,
              ilk: null,
              said: null,
            },
            attachments: [],
          },
          consumed: offset + headerSize + bodySize,
          version: activeVersion,
        };
      }
    }

    if (FIX_BODY_CODES.has(counter.code) || MAP_BODY_CODES.has(counter.code)) {
      const payloadSize = counter.count * unit;
      const total = headerSize + payloadSize;
      if (input.length < offset + total) {
        throw new ShortageError(offset + total, input.length);
      }
      const raw = input.slice(offset, offset + total);
      return {
        frame: {
          serder: {
            raw,
            ked: null,
            proto: Protocols.keri,
            kind: Kinds.cesr,
            size: raw.length,
            pvrsn: activeVersion,
            gvrsn: activeVersion,
            ilk: null,
            said: null,
          },
          attachments: [],
        },
        consumed: offset + total,
        version: activeVersion,
      };
    }

    throw new ColdStartError(
      `Unsupported body-group counter at frame start: ${counter.code}`,
    );
  }

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

  private parseCompleteFrame(
    input: Uint8Array,
    inheritedVersion: Versionage = DEFAULT_VERSION,
    stopAtNextMessage = true,
  ): { frame: CesrFrame; consumed: number } {
    const base = this.parseFrame(input, inheritedVersion);
    const version = base.version;
    const attachments: CesrFrame["attachments"] = [];
    let offset = base.consumed;

    while (offset < input.length) {
      const nextCold = sniff(input.slice(offset));
      if (nextCold === "msg") {
        if (stopAtNextMessage) break;
        throw new ColdStartError(
          "Enclosed frame payload encountered unexpected nested message start",
        );
      }

      if (nextCold !== "txt" && nextCold !== "bny") {
        throw new ColdStartError(
          `Unsupported attachment cold code ${nextCold}`,
        );
      }

      const { group, consumed } = parseAttachmentGroup(
        input.slice(offset),
        version,
        nextCold,
      );
      attachments.push(group);
      offset += consumed;
      if (this.framed) break;
    }

    return {
      frame: { serder: base.frame.serder, attachments },
      consumed: offset,
    };
  }
}

export function createParser(options: ParserOptions = {}): CesrParserCore {
  return new CesrParserCore(options);
}

export function parseBytes(
  bytes: Uint8Array,
  options: ParserOptions = {},
): ParseEmission[] {
  const parser = createParser(options);
  return [...parser.feed(bytes), ...parser.flush()];
}
