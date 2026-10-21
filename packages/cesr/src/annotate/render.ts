import { encodeB64 } from "../core/bytes.ts";
import { DeserializeError, GroupSizeError, ShortageError, UnknownCodeError } from "../core/errors.ts";
import type { CesrDomain, CesrFrame } from "../core/types.ts";
import { parseAttachmentGroup, startsFrame } from "../parser/attachments.ts";
import { readFrameCounter } from "../parser/body.ts";
import { sniff } from "../parser/cold-start.ts";
import { isAttLabel } from "../primitives/base/codex.ts";
import { Counter, decodeGenusVersion, parseCounter } from "../primitives/base/counter.ts";
import { Indexer } from "../primitives/base/indexer.ts";
import { Matter, parseMatter } from "../primitives/base/matter.ts";
import { OpaqueSpan } from "../primitives/base/opaque.ts";
import { type GroupEntry, isCounterGroupLike, isGroupTuple } from "../primitives/base/primitive.ts";
import { isLabelerCode, Labeler } from "../primitives/values/labeler.ts";
import type { Versionage } from "../tables/table-types.ts";
import { counterCodeNameForVersion, matterCodeName, nativeLabelName } from "./comments.ts";
import type { AnnotatedFrame, RenderOptions } from "./types.ts";

/** Decode admitted textual tokens for presentation. */
const TEXT_DECODER = new TextDecoder();
/** Label entries without a semantic primitive renderer. */
const OPAQUE_TOKEN_COMMENT = "opaque token";
/** Label opaque attachment spans without inventing primitive meaning. */
const OPAQUE_WRAPPER_PAYLOAD_COMMENT = "opaque wrapper payload";

/** Attachment enclosures retain their wire order and scope-local genus selectors. */
const WRAPPER_GROUP_NAMES = new Set([
  "AttachmentGroup",
  "BigAttachmentGroup",
]);

/** Stream enclosures contribute indentation without replacing parsed bodies. */
const TOP_LEVEL_WRAPPER_GROUP_NAMES = new Set([
  "GenericGroup",
  "BigGenericGroup",
  "BodyWithAttachmentGroup",
  "BigBodyWithAttachmentGroup",
]);

/** Show opaque bytes in a reversible diagnostic comment. */
function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Distinguish expected token-probe mismatches from implementation errors. */
function isRecoverableParseError(error: unknown): boolean {
  return error instanceof UnknownCodeError
    || error instanceof DeserializeError
    || error instanceof ShortageError
    || error instanceof GroupSizeError;
}

/** Build nonnegative presentation indentation. */
function spaces(count: number): string {
  return " ".repeat(Math.max(0, count));
}

/** Classify a token span, treating non-CESR material as a message body. */
function asDomain(raw: Uint8Array): CesrDomain | "msg" {
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

/** Emit one annotated value using the selected comment placement. */
function emitLine(
  lines: string[],
  value: string,
  comment: string,
  indent: number,
  options: RenderOptions,
): void {
  const pad = spaces(indent);
  if (options.commentMode === "above") {
    lines.push(`${pad}# ${comment}`);
    lines.push(`${pad}${value}`);
    return;
  }
  lines.push(`${pad}${value} # ${comment}`);
}

/** Render hydrated group entries recursively using semantic primitive comments. */
function renderGroupItems(
  lines: string[],
  items: readonly GroupEntry[],
  version: Versionage,
  indent: number,
  options: RenderOptions,
): void {
  for (const item of items) {
    if (isGroupTuple(item)) {
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

    if (item instanceof OpaqueSpan) {
      const value = item.domain === "bny"
        ? `0x${toHex(item.raw)}`
        : TEXT_DECODER.decode(item.raw);
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

/** Render one admitted attachment leaf; the owning frame traversal handles enclosures. */
function renderAttachmentGroupRaw(
  lines: string[],
  raw: Uint8Array,
  version: Versionage,
  indent: number,
  options: RenderOptions,
): number {
  const domain = asDomain(raw);
  if (domain !== "txt" && domain !== "bny") {
    return 0;
  }
  const counter = parseCounter(raw, version, domain);
  emitLine(lines, counter.qb64, `${counter.name} count=${counter.count}`, indent, options);
  // Primitive rendering is deliberately finite; it is not a second stream parser.
  const parsed = parseAttachmentGroup(raw, version, domain);
  renderGroupItems(lines, parsed.group.items, version, indent + options.indent, options);
  return parsed.consumed;
}

/** Walk native body tokens for annotation; Serder owns semantic validation. */
function renderNativeBody(
  lines: string[],
  raw: Uint8Array,
  options: RenderOptions,
  version: Versionage,
): void {
  const domain = asDomain(raw);
  if (domain !== "txt" && domain !== "bny") {
    return;
  }

  const counter = parseCounter(raw, version, domain);
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
  // A NonNativeBodyGroup carries one qualified primitive, not a native label/value sequence.
  if (counter.name === "NonNativeBodyGroup" || counter.name === "BigNonNativeBodyGroup") {
    const matter = parseMatter(raw.subarray(headerSize, end), domain);
    emitLine(lines, matter.qb64, matterCodeName(matter.code), options.indent, options);
    return;
  }
  let pendingLabel: string | null = null;

  while (offset < end) {
    const slice = raw.slice(offset, end);
    try {
      const nestedCounter = parseCounter(slice, version, domain);
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
    const label = nativeLabelName(pendingLabel);
    // LabelCodex also encodes routes and empty text values; those are not attribute labels.
    const text = isLabelerCode(matter.code) ? new Labeler(matter).text : null;
    pendingLabel = text !== null && isAttLabel(text) ? text : null;
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
  frame: CesrFrame,
  options: RenderOptions,
): void {
  const rawBody = TEXT_DECODER.decode(frame.body.raw);
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

/** Render original validated wire while taking semantic bodies from the single parser engine. */
export function renderAnnotatedFrames(
  frames: CesrFrame[],
  options: RenderOptions,
  input: Uint8Array,
): AnnotatedFrame[] {
  const output: AnnotatedFrame[] = [];
  const visited = new Set<CesrFrame>();
  let prefix: string[] = [];

  /** Preserve attachment wire while assigning embedded bodies only to their parent's child iterator. */
  function renderAttachments(
    raw: Uint8Array,
    version: Versionage,
    indent: number,
    children: Iterator<CesrFrame>,
    lines: string[],
    { enclosed = false, insideAttachmentGroup = false }: { enclosed?: boolean; insideAttachmentGroup?: boolean } = {},
  ): number {
    let offset = 0;
    let selected = version;
    while (offset < raw.length) {
      const tail = raw.subarray(offset);
      const domain = sniff(tail);
      if (domain === "ano") {
        offset++;
        continue;
      }
      if (domain === "msg") break;
      if (domain !== "txt" && domain !== "bny") throw new DeserializeError("Invalid annotation domain");
      // Outside an enclosure, a following body or selector belongs to the independent stream.
      if (!enclosed && startsFrame(tail, selected, domain)) break;
      const counter = parseCounter(tail, selected, domain);
      const header = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
      if (counter.name === "KERIACDCGenusVersion") {
        emitLine(lines, counter.qb64, counter.name, indent, options);
        selected = decodeGenusVersion(counter);
        offset += header;
      } else if (startsFrame(tail, selected, domain)) {
        // One owned child consumes its own evidence; later children remain in this parent's scope.
        offset += renderStream(tail, selected, indent, children, { parentLines: lines, single: true });
      } else if (WRAPPER_GROUP_NAMES.has(counter.name)) {
        const end = offset + header + counter.count * (domain === "bny" ? 3 : 4);
        emitLine(lines, counter.qb64, `${counter.name} count=${counter.count}`, indent, options);
        renderAttachments(raw.subarray(offset + header, end), selected, indent + options.indent, children, lines, {
          enclosed: true,
          insideAttachmentGroup: true,
        });
        offset = end;
        // A complete attachment enclosure closes this frame, not its enclosing parent's child list.
        if (!insideAttachmentGroup) return offset;
      } else {
        offset += renderAttachmentGroupRaw(lines, tail, selected, indent, options);
      }
    }
    return offset;
  }

  /** Match admitted wire to hydrated nodes without reparsing bodies or flattening owned children. */
  function renderStream(
    raw: Uint8Array,
    inherited: Versionage | null,
    indent: number,
    available: Iterator<CesrFrame>,
    { parentLines, enclosed = false, single = false }: {
      parentLines?: string[];
      enclosed?: boolean;
      single?: boolean;
    } = {},
  ): number {
    let offset = 0;
    let selected = inherited;
    while (offset < raw.length) {
      const slice = raw.subarray(offset);
      const domain = sniff(slice);
      if (domain === "ano") {
        offset++;
        continue;
      }
      let wireSize: number | undefined;
      let wireGenus: Versionage | undefined;
      if (domain === "txt" || domain === "bny") {
        const { counter, gvrsn } = readFrameCounter(
          slice,
          selected ?? { major: 2, minor: 0 },
          domain,
          selected === null,
        );
        wireGenus = gvrsn;
        const size = domain === "bny" ? counter.fullSizeB2 : counter.fullSize;
        // Serder raw may be canonical text or omit an opaque enclosure header; source extent stays on wire.
        wireSize = size + counter.count * (domain === "bny" ? 3 : 4);
        if (counter.name === "KERIACDCGenusVersion") {
          emitLine(parentLines ?? prefix, counter.qb64, counter.name, indent, options);
          selected = decodeGenusVersion(counter);
          offset += size;
          continue;
        }
        if (TOP_LEVEL_WRAPPER_GROUP_NAMES.has(counter.name)) {
          const end = offset + wireSize;
          const ownsAttachments = counter.name === "BodyWithAttachmentGroup"
            || counter.name === "BigBodyWithAttachmentGroup";
          emitLine(parentLines ?? prefix, counter.qb64, `${counter.name} count=${counter.count}`, indent, options);
          // GenericGroup shares its independent sibling iterator; a body wrapper encloses one node's children.
          renderStream(raw.subarray(offset + size, end), gvrsn, indent + options.indent, available, {
            parentLines,
            enclosed: ownsAttachments,
          });
          offset = end;
          if (single) return offset;
          continue;
        }
      }
      const frame = available.next().value;
      if (!frame || visited.has(frame)) {
        throw new DeserializeError("Annotation body does not match parsed frame ownership");
      }
      visited.add(frame);
      const lines = parentLines ?? prefix;
      if (!parentLines) {
        prefix = [];
        // Only independently delivered roots get a public annotation entry.
        output.push({ index: output.length + 1, frame, lines });
      }
      const bodyLines: string[] = [];
      const version = selected ?? wireGenus ?? frame.gvrsn ?? frame.body.gvrsn ?? frame.body.pvrsn;
      if (frame.body.kind === "CESR" && frame.body.ked === null) {
        const wire = raw.subarray(offset, offset + (wireSize ?? frame.body.raw.length));
        emitLine(
          bodyLines,
          domain === "bny" ? encodeB64(wire) : TEXT_DECODER.decode(wire),
          `OPAQUE CESR body (non-serder fallback, hex=${toHex(wire)})`,
          0,
          options,
        );
      } else if (domain === "msg") {
        renderMessageBody(bodyLines, frame, options);
      } else {
        renderNativeBody(bodyLines, raw.subarray(offset, offset + wireSize!), options, version);
      }
      for (const line of bodyLines) lines.push(`${spaces(indent)}${line}`);
      offset += wireSize ?? frame.body.raw.length;
      const children = (frame.nests ?? [])[Symbol.iterator]();
      offset += renderAttachments(raw.subarray(offset), version, indent, children, lines, { enclosed });
      if (!children.next().done) throw new DeserializeError("Annotation did not consume every owned child");
      if (single) return offset;
    }
    return offset;
  }

  const roots = frames[Symbol.iterator]();
  renderStream(input, null, 0, roots);
  if (!roots.next().done) throw new DeserializeError("Annotation did not consume every parsed root");
  if (prefix.length && output.length) output[output.length - 1].lines.push(...prefix);
  return output;
}
