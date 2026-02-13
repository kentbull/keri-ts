import type { AttachmentGroup, CesrFrame } from "../core/types.ts";
import type { Versionage } from "../tables/table-types.ts";
import type { AnnotatedFrame, AnnotateOptions } from "./types.ts";
import {
  DeserializeError,
  GroupSizeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";
import { sniff } from "../parser/cold-start.ts";
import { parseCounter } from "../primitives/counter.ts";
import { parseMatter } from "../primitives/matter.ts";
import { parseIndexer } from "../primitives/indexer.ts";
import { parseAttachmentDispatchCompat } from "../parser/group-dispatch.ts";
import {
  counterCodeNameForVersion,
  matterCodeName,
  nativeLabelName,
} from "./comments.ts";

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();
const OPAQUE_TOKEN_COMMENT = "opaque token";
const OPAQUE_WRAPPER_PAYLOAD_COMMENT = "opaque wrapper payload";

const WRAPPER_GROUP_NAMES = new Set([
  "AttachmentGroup",
  "BigAttachmentGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
]);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecoverableParseError(error: unknown): boolean {
  return error instanceof UnknownCodeError ||
    error instanceof DeserializeError ||
    error instanceof ShortageError ||
    error instanceof GroupSizeError;
}

function spaces(count: number): string {
  return " ".repeat(Math.max(0, count));
}

function asDomain(raw: Uint8Array): "txt" | "bny" | "msg" {
  try {
    const cold = sniff(raw);
    if (cold === "txt" || cold === "bny" || cold === "msg") return cold;
  } catch (error) {
    if (!isRecoverableParseError(error)) {
      throw error;
    }
    // Fallback handled below.
  }
  return "msg";
}

function emitLine(
  lines: string[],
  value: string,
  comment: string,
  indent: number,
  options: Required<AnnotateOptions>,
): void {
  const pad = spaces(indent);
  if (options.commentMode === "above") {
    lines.push(`${pad}# ${comment}`);
    lines.push(`${pad}${value}`);
    return;
  }
  lines.push(`${pad}${value} # ${comment}`);
}

function describeToken(
  token: string,
  domain: "txt" | "bny",
  version: Versionage,
): {
  comment: string;
  size: number;
} {
  const input = TEXT_ENCODER.encode(token);
  try {
    const counter = parseCounter(input, version, domain);
    return {
      comment: `${counterCodeNameForVersion(counter.code, version)} counter`,
      size: domain === "bny" ? counter.fullSizeB2 : counter.fullSize,
    };
  } catch (error) {
    if (!isRecoverableParseError(error)) {
      throw error;
    }
    // Try indexer/matter below.
  }

  try {
    const indexer = parseIndexer(input, domain);
    return {
      comment: `Indexer ${indexer.code}`,
      size: domain === "bny" ? indexer.fullSizeB2 : indexer.fullSize,
    };
  } catch (error) {
    if (!isRecoverableParseError(error)) {
      throw error;
    }
    // Try matter below.
  }

  try {
    const matter = parseMatter(input, domain);
    return {
      comment: matterCodeName(matter.code),
      size: domain === "bny" ? matter.fullSizeB2 : matter.fullSize,
    };
  } catch (error) {
    if (!isRecoverableParseError(error)) {
      throw error;
    }
    return {
      comment: OPAQUE_TOKEN_COMMENT,
      size: token.length,
    };
  }
}

function parseCounterCompat(
  input: Uint8Array,
  version: Versionage,
  domain: "txt" | "bny",
) {
  try {
    return parseCounter(input, version, domain);
  } catch (error) {
    if (!isRecoverableParseError(error)) {
      throw error;
    }
    const alternate: Versionage = version.major >= 2
      ? { major: 1, minor: 0 }
      : { major: 2, minor: 0 };
    return parseCounter(input, alternate, domain);
  }
}

function renderGroupItems(
  lines: string[],
  items: unknown[],
  version: Versionage,
  indent: number,
  options: Required<AnnotateOptions>,
): void {
  for (const item of items) {
    if (typeof item === "string") {
      const parsed = describeToken(item, "txt", version);
      emitLine(lines, item, parsed.comment, indent, options);
      continue;
    }

    if (item instanceof Uint8Array) {
      emitLine(
        lines,
        `0x${toHex(item)}`,
        "raw qb2 quadlet fragment",
        indent,
        options,
      );
      continue;
    }

    if (Array.isArray(item)) {
      renderGroupItems(lines, item, version, indent + options.indent, options);
      continue;
    }

    if (item && typeof item === "object") {
      const nested = item as Partial<AttachmentGroup>;
      if (typeof nested.code === "string" && typeof nested.name === "string") {
        emitLine(
          lines,
          `${nested.code}`,
          `${nested.name} nested group`,
          indent,
          options,
        );
      }
      continue;
    }
  }
}

function renderAttachmentGroupRaw(
  lines: string[],
  raw: Uint8Array,
  version: Versionage,
  indent: number,
  options: Required<AnnotateOptions>,
): number {
  const domain = asDomain(raw);
  if (domain !== "txt" && domain !== "bny") {
    return 0;
  }
  const parsed = parseAttachmentDispatchCompat(raw, version, domain);
  const counter = parseCounterCompat(raw, version, domain);
  emitLine(
    lines,
    counter.qb64,
    `${parsed.group.name} count=${counter.count}`,
    indent,
    options,
  );

  const headerSize = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
  const payload = raw.slice(headerSize, parsed.consumed);

  if (WRAPPER_GROUP_NAMES.has(parsed.group.name)) {
    // Wrapper groups contain nested groups by convention, but real-world
    // streams may include trailing opaque segments. Keep annotation resilient.
    let offset = 0;
    while (offset < payload.length) {
      const slice = payload.slice(offset);
      const sliceCold = asDomain(slice);
      if (sliceCold === "msg") {
        break;
      }
      if (sliceCold === "txt" && slice[0] !== "-".charCodeAt(0)) {
        break;
      }

      let consumed = 0;
      try {
        consumed = renderAttachmentGroupRaw(
          lines,
          slice,
          version,
          indent + options.indent,
          options,
        );
      } catch (error) {
        if (!isRecoverableParseError(error)) {
          throw error;
        }
        break;
      }
      if (consumed <= 0) break;
      offset += consumed;
    }
    if (offset < payload.length) {
      const remainder = payload.slice(offset);
      const unit = domain === "bny" ? 3 : 4;
      for (let i = 0; i < remainder.length; i += unit) {
        const chunk = remainder.slice(i, Math.min(i + unit, remainder.length));
        const rendered = domain === "bny"
          ? `0x${toHex(chunk)}`
          : TEXT_DECODER.decode(chunk);
        emitLine(
          lines,
          rendered,
          OPAQUE_WRAPPER_PAYLOAD_COMMENT,
          indent + options.indent,
          options,
        );
      }
    }
    return parsed.consumed;
  }

  renderGroupItems(
    lines,
    parsed.group.items,
    version,
    indent + options.indent,
    options,
  );
  return parsed.consumed;
}

function renderNativeBody(
  lines: string[],
  frame: CesrFrame,
  options: Required<AnnotateOptions>,
  version: Versionage,
): void {
  const raw = frame.serder.raw;
  const domain = asDomain(raw);
  if (domain !== "txt" && domain !== "bny") {
    return;
  }

  const counter = parseCounterCompat(raw, version, domain);
  emitLine(
    lines,
    counter.qb64,
    `${
      counterCodeNameForVersion(counter.code, version)
    } count=${counter.count}`,
    0,
    options,
  );

  for (const field of frame.serder.native?.fields ?? []) {
    const label = nativeLabelName(field.label);
    const comment = label
      ? `${label} (${matterCodeName(field.code)})`
      : matterCodeName(field.code);
    emitLine(lines, field.qb64, comment, options.indent, options);
  }
}

function renderMessageBody(
  lines: string[],
  frame: CesrFrame,
  options: Required<AnnotateOptions>,
): void {
  const rawBody = TEXT_DECODER.decode(frame.serder.raw);
  let body = rawBody;
  if (options.pretty && frame.serder.kind === "JSON") {
    try {
      body = JSON.stringify(JSON.parse(rawBody), null, 2);
    } catch (error) {
      if (!(error instanceof SyntaxError)) {
        throw error;
      }
      body = rawBody;
    }
  }
  const info = [
    `SERDER`,
    frame.serder.proto,
    frame.serder.kind,
    frame.serder.ilk ? `ilk=${frame.serder.ilk}` : null,
    frame.serder.said ? `said=${frame.serder.said}` : null,
  ].filter(Boolean).join(" ");
  emitLine(lines, body, info, 0, options);
}

function renderFrame(
  frame: CesrFrame,
  index: number,
  options: Required<AnnotateOptions>,
): AnnotatedFrame {
  const lines: string[] = [];
  const version = frame.serder.gvrsn ?? frame.serder.pvrsn;
  const domain = asDomain(frame.serder.raw);

  if (domain === "txt" || domain === "bny") {
    renderNativeBody(lines, frame, options, version);
  } else {
    renderMessageBody(lines, frame, options);
  }

  for (const group of frame.attachments) {
    renderAttachmentGroupRaw(lines, group.raw, version, 0, options);
  }

  return { index, frame, lines };
}

/** Render parsed CESR frames into line-oriented, human-annotated text blocks. */
export function renderAnnotatedFrames(
  frames: CesrFrame[],
  options: Required<AnnotateOptions>,
): AnnotatedFrame[] {
  return frames.map((frame, index) => renderFrame(frame, index + 1, options));
}
