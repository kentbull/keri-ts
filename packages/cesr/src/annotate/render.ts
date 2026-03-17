import { b64ToInt, intToB64 } from "../core/bytes.ts";
import {
  DeserializeError,
  GroupSizeError,
  ShortageError,
  UnknownCodeError,
} from "../core/errors.ts";
import { parseBytes } from "../core/parser-engine.ts";
import type { CesrMessage } from "../core/types.ts";
import { sniff } from "../parser/cold-start.ts";
import { parseAttachmentDispatchCompat } from "../parser/group-dispatch.ts";
import { Counter, parseCounter } from "../primitives/counter.ts";
import { Indexer } from "../primitives/indexer.ts";
import { Matter, parseMatter } from "../primitives/matter.ts";
import { type GroupEntry, isCounterGroupLike, isPrimitiveTuple } from "../primitives/primitive.ts";
import { UnknownPrimitive } from "../primitives/unknown.ts";
import type { Versionage } from "../tables/table-types.ts";
import {
  counterCodeName,
  counterCodeNameForVersion,
  matterCodeName,
  nativeLabelName,
} from "./comments.ts";
import type { AnnotatedFrame, AnnotateOptions } from "./types.ts";

const TEXT_DECODER = new TextDecoder();
const OPAQUE_TOKEN_COMMENT = "opaque token";
const OPAQUE_WRAPPER_PAYLOAD_COMMENT = "opaque wrapper payload";

const WRAPPER_GROUP_NAMES = new Set([
  "AttachmentGroup",
  "BigAttachmentGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
]);

const TOP_LEVEL_WRAPPER_GROUP_NAMES = new Set([
  "GenericGroup",
  "BigGenericGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
]);

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isRecoverableParseError(error: unknown): boolean {
  return error instanceof UnknownCodeError
    || error instanceof DeserializeError
    || error instanceof ShortageError
    || error instanceof GroupSizeError;
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

/** Parse counters with a bounded v1/v2 fallback for annotation-only rendering paths. */
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

/** Decode a wrapped genus-version selector into the active protocol version context. */
function decodeVersionCounter(
  counter: { qb64: string; count: number },
): Versionage {
  const triplet = counter.qb64.length >= 3
    ? counter.qb64.slice(-3)
    : intToB64(counter.count, 3);
  const majorRaw = b64ToInt(triplet[0] ?? "A");
  const minorRaw = b64ToInt(triplet[1] ?? "A");
  return {
    major: majorRaw === 1 ? 1 : 2,
    minor: minorRaw,
  };
}

/** Render hydrated group entries recursively using semantic primitive comments. */
function renderGroupItems(
  lines: string[],
  items: readonly GroupEntry[],
  version: Versionage,
  indent: number,
  options: Required<AnnotateOptions>,
): void {
  for (const item of items) {
    if (isPrimitiveTuple(item)) {
      renderGroupItems(
        lines,
        item,
        version,
        indent + options.indent,
        options,
      );
      continue;
    }

    if (isCounterGroupLike(item)) {
      emitLine(
        lines,
        item.qb64,
        `${item.name} nested group`,
        indent,
        options,
      );
      renderGroupItems(
        lines,
        [...item.items],
        version,
        indent + options.indent,
        options,
      );
      continue;
    }

    if (item instanceof UnknownPrimitive) {
      const value = item.sourceDomain === "bny"
        ? `0x${toHex(item.qb2)}`
        : item.qb64;
      emitLine(lines, value, OPAQUE_WRAPPER_PAYLOAD_COMMENT, indent, options);
      continue;
    }

    if (item instanceof Counter) {
      emitLine(
        lines,
        item.qb64,
        `${counterCodeNameForVersion(item.code, version)} counter`,
        indent,
        options,
      );
      continue;
    }

    if (item instanceof Indexer) {
      emitLine(lines, item.qb64, `Indexer ${item.code}`, indent, options);
      continue;
    }

    if (item instanceof Matter) {
      emitLine(lines, item.qb64, matterCodeName(item.code), indent, options);
      continue;
    }

    emitLine(lines, String(item), OPAQUE_TOKEN_COMMENT, indent, options);
  }
}

/** Render one raw attachment-group span, including nested wrapper groups when present. */
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

/** Render a native CESR body-group payload using hydrated native field projections when available. */
function renderNativeBody(
  lines: string[],
  frame: CesrMessage,
  options: Required<AnnotateOptions>,
  version: Versionage,
): void {
  const raw = frame.body.raw;
  const domain = asDomain(raw);
  if (domain !== "txt" && domain !== "bny") {
    return;
  }

  const counter = parseCounterCompat(raw, version, domain);
  emitLine(
    lines,
    counter.qb64,
    `${counterCodeNameForVersion(counter.code, version)} count=${counter.count}`,
    0,
    options,
  );

  const unit = domain === "bny" ? 3 : 4;
  const headerSize = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
  const payloadSize = counter.count * unit;
  const end = Math.min(raw.length, headerSize + payloadSize);
  let offset = headerSize;

  while (offset < end) {
    const slice = raw.slice(offset, end);
    try {
      const nestedCounter = parseCounterCompat(slice, version, domain);
      const nestedCounterSize = domain === "bny"
        ? nestedCounter.fullSizeB2
        : nestedCounter.fullSize;
      emitLine(
        lines,
        nestedCounter.qb64,
        `${counterCodeNameForVersion(nestedCounter.code, version)} counter`,
        options.indent,
        options,
      );
      offset += nestedCounterSize;
      continue;
    } catch (error) {
      if (!isRecoverableParseError(error)) {
        throw error;
      }
    }

    const matter = parseMatter(slice, domain);
    const matterSize = domain === "bny" ? matter.fullSizeB2 : matter.fullSize;
    const field = frame.body.native?.fields.find((candidate) =>
      candidate.primitive.qb64 === matter.qb64
    );
    const label = field ? nativeLabelName(field.label) : null;
    const primitiveComment = matter instanceof Indexer
      ? `Indexer ${matter.code}`
      : matterCodeName(matter.code);
    const comment = label ? `${label} (${primitiveComment})` : primitiveComment;
    emitLine(lines, matter.qb64, comment, options.indent, options);
    offset += matterSize;
  }
}

/** Render non-native or opaque message bodies as one annotated body line. */
function renderMessageBody(
  lines: string[],
  frame: CesrMessage,
  options: Required<AnnotateOptions>,
): void {
  const rawBody = TEXT_DECODER.decode(frame.body.raw);
  const isOpaqueCesrBody = frame.body.kind === "CESR"
    && frame.body.ked === null;

  if (isOpaqueCesrBody) {
    emitLine(
      lines,
      rawBody,
      `OPAQUE CESR body (non-serder fallback, hex=${toHex(frame.body.raw)})`,
      0,
      options,
    );
    return;
  }

  let body = rawBody;
  if (options.pretty && frame.body.kind === "JSON") {
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
    frame.body.proto,
    frame.body.kind,
    frame.body.ilk ? `ilk=${frame.body.ilk}` : null,
    frame.body.said ? `said=${frame.body.said}` : null,
  ].filter(Boolean).join(" ");
  emitLine(lines, body, info, 0, options);
}

/** Render one parsed frame and all of its attachment groups into annotation lines. */
function renderFrame(
  frame: CesrMessage,
  index: number,
  options: Required<AnnotateOptions>,
): AnnotatedFrame {
  const lines: string[] = [];
  const version = frame.body.gvrsn ?? frame.body.pvrsn;
  const domain = asDomain(frame.body.raw);

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

/** Parse and render a nested frame chunk inside wrapper-aware annotation flows. */
function renderFrameChunk(
  lines: string[],
  input: Uint8Array,
  indent: number,
  options: Required<AnnotateOptions>,
): void {
  const parsed = parseBytes(input);
  const frames: CesrMessage[] = [];
  for (const event of parsed) {
    if (event.type === "error") {
      throw event.error;
    }
    frames.push(event.frame);
  }
  const rendered = renderAnnotatedFrames(frames, options);
  for (const frame of rendered) {
    for (const line of frame.lines) {
      lines.push(`${spaces(indent)}${line}`);
    }
  }
}

/** Walk a stream that may begin with wrapper/version selectors before ordinary frames. */
function renderWrapperAwareStream(
  lines: string[],
  input: Uint8Array,
  inheritedVersion: Versionage,
  indent: number,
  options: Required<AnnotateOptions>,
): boolean {
  let offset = 0;
  let activeVersion = inheritedVersion;
  let usedWrapper = false;

  while (offset < input.length) {
    const slice = input.slice(offset);
    const domain = asDomain(slice);
    if (domain !== "txt" && domain !== "bny") {
      if (!usedWrapper) return false;
      renderFrameChunk(lines, slice, indent, options);
      return true;
    }

    const counter = parseCounterCompat(slice, activeVersion, domain);
    const headerSize = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
    const name = counterCodeName(counter.code);

    if (name === "KERIACDCGenusVersion") {
      emitLine(
        lines,
        counter.qb64,
        `${name} count=${counter.count}`,
        indent,
        options,
      );
      activeVersion = decodeVersionCounter(counter);
      offset += headerSize;
      usedWrapper = true;
      continue;
    }

    if (!TOP_LEVEL_WRAPPER_GROUP_NAMES.has(name)) {
      if (!usedWrapper) return false;
      renderFrameChunk(lines, slice, indent, options);
      return true;
    }

    const unit = domain === "bny" ? 3 : 4;
    const payloadSize = counter.count * unit;
    const total = headerSize + payloadSize;
    if (slice.length < total) {
      throw new ShortageError(total, slice.length);
    }

    emitLine(
      lines,
      counter.qb64,
      `${name} count=${counter.count}`,
      indent,
      options,
    );
    const payload = slice.slice(headerSize, total);
    const nestedHandled = renderWrapperAwareStream(
      lines,
      payload,
      activeVersion,
      indent + options.indent,
      options,
    );
    if (!nestedHandled) {
      renderFrameChunk(lines, payload, indent + options.indent, options);
    }

    offset += total;
    usedWrapper = true;
  }

  return usedWrapper;
}

/**
 * Render stream-level wrapper groups (GenericGroup/BodyWithAttachmentGroup)
 * so denot round-trips preserve wrapper counters. Returns null when input does
 * not start in a wrapper-oriented domain and caller should use frame rendering.
 */
export function renderWrapperAnnotatedStream(
  input: Uint8Array,
  options: Required<AnnotateOptions>,
): string | null {
  const lines: string[] = [];
  const rendered = renderWrapperAwareStream(
    lines,
    input,
    { major: 2, minor: 0 },
    0,
    options,
  );
  if (!rendered) {
    return null;
  }
  return lines.join("\n");
}

/** Render parsed CESR frames into line-oriented, human-annotated text blocks. */
export function renderAnnotatedFrames(
  frames: CesrMessage[],
  options: Required<AnnotateOptions>,
): AnnotatedFrame[] {
  return frames.map((frame, index) => renderFrame(frame, index + 1, options));
}
