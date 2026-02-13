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
  private pendingNative:
    | { frame: CesrFrame; version: Versionage }
    | null = null;

  constructor(options: ParserOptions = {}) {
    this.framed = options.framed ?? false;
  }

  feed(chunk: Uint8Array): ParseEmission[] {
    this.state.buffer = concatBytes(this.state.buffer, chunk);
    return this.drain();
  }

  flush(): ParseEmission[] {
    const out: ParseEmission[] = [];
    if (this.pendingNative) {
      out.push({ type: "frame", frame: this.pendingNative.frame });
      this.pendingNative = null;
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
    this.pendingNative = null;
  }

  private drain(): ParseEmission[] {
    const out: ParseEmission[] = [];

    while (this.state.buffer.length > 0) {
      try {
        if (this.pendingNative) {
          if (!this.resumePendingNative(out)) {
            break;
          }
          continue;
        }

        const base = this.parseFrame(this.state.buffer);
        this.consume(base.consumed);
        const attachments = [...base.frame.attachments];
        const version = base.version;

        while (this.state.buffer.length > 0) {
          const nextCold = sniff(this.state.buffer);
          if (nextCold === "msg") break;
          if (nextCold !== "txt" && nextCold !== "bny") {
            throw new ColdStartError(
              `Unsupported attachment cold code ${nextCold}`,
            );
          }
          const { group, consumed } = parseAttachmentGroup(
            this.state.buffer,
            version,
            nextCold,
          );
          attachments.push(group);
          this.consume(consumed);
          if (this.framed) break;
        }

        const completed: CesrFrame = {
          serder: base.frame.serder,
          attachments,
        };

        if (
          !this.framed && completed.serder.kind === Kinds.cesr &&
          this.state.buffer.length === 0
        ) {
          this.pendingNative = { frame: completed, version };
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

  private resumePendingNative(out: ParseEmission[]): boolean {
    if (!this.pendingNative) return false;
    if (this.state.buffer.length === 0) return false;

    const nextCold = sniff(this.state.buffer);
    if (nextCold === "msg") {
      out.push({ type: "frame", frame: this.pendingNative.frame });
      this.pendingNative = null;
      return true;
    }
    if (nextCold !== "txt" && nextCold !== "bny") {
      throw new ColdStartError(
        `Unsupported native-frame continuation cold code ${nextCold}`,
      );
    }

    const peek = parseCounter(
      this.state.buffer,
      this.pendingNative.version,
      nextCold,
    );
    if (
      BODY_WITH_ATTACH_CODES.has(peek.code) ||
      NON_NATIVE_BODY_CODES.has(peek.code) ||
      FIX_BODY_CODES.has(peek.code) ||
      MAP_BODY_CODES.has(peek.code) ||
      peek.code === GENUS_VERSION_CODE
    ) {
      out.push({ type: "frame", frame: this.pendingNative.frame });
      this.pendingNative = null;
      return true;
    }

    const { group, consumed } = parseAttachmentGroup(
      this.state.buffer,
      this.pendingNative.version,
      nextCold,
    );
    this.pendingNative.frame.attachments.push(group);
    this.consume(consumed);

    if (this.framed) {
      out.push({ type: "frame", frame: this.pendingNative.frame });
      this.pendingNative = null;
      return false;
    }

    if (this.state.buffer.length === 0) {
      return false;
    }

    const afterCold = sniff(this.state.buffer);
    if (afterCold === "msg") {
      out.push({ type: "frame", frame: this.pendingNative.frame });
      this.pendingNative = null;
      return true;
    }
    return true;
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
      if (payloadSize !== bodySize) {
        throw new ColdStartError(
          `NonNativeBodyGroup payload size mismatch: expected=${payloadSize} actual=${bodySize}`,
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
      const metadata = this.extractNativeMetadata(
        raw,
        cold,
        activeVersion,
      );
      const fields = this.extractNativeFields(raw, cold, activeVersion);
      return {
        frame: {
          serder: {
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
              bodyCode: counter.code,
              fields,
            },
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

      const verser = parseMatter(raw.slice(offset), cold);
      offset += cold === "bny" ? verser.fullSizeB2 : verser.fullSize;
      const verserText = verser.qb64.slice(verser.code.length);
      if (verserText.startsWith("KERI")) proto = Protocols.keri;
      if (verserText.startsWith("ACDC")) proto = Protocols.acdc;
      if (verserText.length >= 6) {
        const majorRaw = b64ToInt(verserText[4]);
        const minorRaw = b64ToInt(verserText[5]);
        pvrsn = {
          major: majorRaw === 1 ? 1 : 2,
          minor: minorRaw,
        };
        gvrsn = pvrsn;
      }

      if (MAP_BODY_CODES.has(bodyCounter.code)) {
        offset = this.skipNativeLabelers(raw, offset, cold);
      }

      const ilker = parseMatter(raw.slice(offset), cold);
      offset += cold === "bny" ? ilker.fullSizeB2 : ilker.fullSize;
      if (ilker.code === "X") {
        ilk = ilker.qb64.slice(ilker.code.length);
      }

      if (MAP_BODY_CODES.has(bodyCounter.code)) {
        offset = this.skipNativeLabelers(raw, offset, cold);
      }

      const saider = parseMatter(raw.slice(offset), cold);
      if (saider.code.startsWith("E")) {
        said = saider.qb64;
      }
    } catch {
      // Keep conservative defaults when metadata extraction is partial.
    }

    return { proto, pvrsn, gvrsn, ilk, said };
  }

  private skipNativeLabelers(
    raw: Uint8Array,
    offset: number,
    cold: "txt" | "bny",
  ): number {
    let out = offset;
    while (out < raw.length) {
      const item = parseMatter(raw.slice(out), cold);
      if (item.code !== "V" && item.code !== "W") {
        break;
      }
      out += cold === "bny" ? item.fullSizeB2 : item.fullSize;
    }
    return out;
  }

  private extractNativeFields(
    raw: Uint8Array,
    cold: "txt" | "bny",
    fallbackVersion: Versionage,
  ): Array<{ label: string | null; code: string; qb64: string }> {
    const fields: Array<{ label: string | null; code: string; qb64: string }> =
      [];
    const bodyCounter = parseCounter(raw, fallbackVersion, cold);
    const total = cold === "bny" ? bodyCounter.fullSizeB2 : bodyCounter.fullSize;
    const payloadBytes = bodyCounter.count * (cold === "bny" ? 3 : 4);
    const start = total;
    const end = start + payloadBytes;
    let offset = start;
    let pendingLabel: string | null = null;

    while (offset < end) {
      const at = raw.slice(offset);
      try {
        if (cold === "txt" && at[0] === "-".charCodeAt(0)) {
          const ctr = parseCounter(at, fallbackVersion, cold);
          const size = ctr.fullSize;
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
        const size = cold === "bny" ? token.fullSizeB2 : token.fullSize;
        offset += size;

        if (token.code === "V" || token.code === "W") {
          pendingLabel = token.qb64;
          continue;
        }

        fields.push({
          label: pendingLabel,
          code: token.code,
          qb64: token.qb64,
        });
        pendingLabel = null;
      } catch {
        break;
      }
    }

    return fields;
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
