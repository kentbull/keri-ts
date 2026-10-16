/** Reopenable frame serialization with semantic metadata and streamed canonical ESSR wire. */
import { b, byteString, concatBytes, decodeB64, encodeB64 } from "../core/bytes.ts";
import { SerializeError } from "../core/errors.ts";
import type { Payload } from "../core/payload.ts";
import type { AttachmentGroup, CesrDomain, CesrFrame } from "../core/types.ts";
import { Counter } from "../primitives/counter.ts";
import { OpaqueSpan } from "../primitives/opaque.ts";
import { type GroupEntry, isCounterGroupLike, isGroupTuple } from "../primitives/primitive.ts";
import { Texter } from "../primitives/texter.ts";
import { resolveCounterSizeTable, resolveCtrDex } from "../tables/counter-version-registry.ts";
import type { Versionage } from "../tables/table-types.ts";
import { Kinds } from "../tables/versions.ts";
import { sniff } from "./cold-start.ts";

/** Output qualification is independent of the body's KERI/ACDC protocol version. */
export interface SerializeOptions {
  /** Override every message's attachment genus; otherwise preserve each node's resolved genus. */
  gvrsn?: Versionage;
  /** One qualification domain for the entire attachment enclosure; default text. */
  domain?: CesrDomain;
}

/** An HTTP header may need an enclosure matching body inference before selecting its inner genus. */
export interface AttachmentOptions extends SerializeOptions {
  /** Counter genus outside the optional initial GVC; defaults to the selected attachment genus. */
  enclosingGvrsn?: Versionage;
}

/** Copy granularity for streamed qualified output. */
const CHUNK_BYTES = 65536;

/** Compare genus identity without conflating it with message protocol metadata. */
function sameVersion(left: Versionage, right: Versionage): boolean {
  return left.major === right.major && left.minor === right.minor;
}

/** Choose an output genus that can carry the body's independently declared protocol version. */
function frameGenus(frame: CesrFrame, requested?: Versionage): Versionage {
  // ESSR retains the resolved frame genus; scoped ordinary leaves may select an older genus locally.
  const selected = requested ?? frame.gvrsn ?? frame.attachments[0]?.version ?? frame.body.gvrsn
    ?? frame.body.pvrsn;
  // A non-native protocol version still establishes a minimum compatible counter genus.
  const required = frame.body.gvrsn ?? frame.body.pvrsn;
  if (selected.major < required.major) {
    if (requested) throw new SerializeError("Output genus cannot precede the body protocol/genus version");
    return required;
  }
  return selected;
}

/** Join semantic metadata without argument spreading. */
function join(chunks: readonly Uint8Array[]): Uint8Array {
  // The aggregate is one semantic group; ESSR wire is streamed separately.
  const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  // Copy in wire order, preserving tuple and signature order.
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

/** Encode a semantic counter, promoting only when its selected small form overflows. */
function counter(name: string, count: number, gvrsn: Versionage, domain: CesrDomain): Uint8Array {
  // Generated tables remain the authority for genus-specific names and capacities.
  const codes = resolveCtrDex(gvrsn);
  // The selected small code may be promoted after checking its generated soft width.
  let code = codes[name];
  if (!code) throw new SerializeError(`No ${name} counter in genus ${gvrsn.major}.${gvrsn.minor}`);
  // Promotion is based on the actual soft width rather than a duplicated code map.
  const width = resolveCounterSizeTable(gvrsn).get(code)!.ss;
  if (count >= 64 ** width) code = codes[`Big${name}`];
  if (!code) throw new SerializeError(`No large ${name} counter in genus ${gvrsn.major}.${gvrsn.minor}`);
  // Counter construction validates count arithmetic and the requested minor version.
  const value = new Counter({ code, count, version: gvrsn });
  return domain === "txt" ? value.qb64b : value.qb2;
}

/** Convert qualified bytes without altering primitive or inner-counter boundaries. */
function qualify(bytes: Uint8Array, from: CesrDomain, to: CesrDomain): Uint8Array {
  if (from === to) return bytes;
  if (from === "bny") return b(encodeB64(bytes));
  // Opaque text still has to be valid qualified base64 before a binary conversion.
  const text = byteString(bytes);
  if (text.length % 4 || !/^[A-Za-z0-9_-]*$/.test(text)) throw new SerializeError("Invalid qualified text payload");
  return decodeB64(text);
}

/** Serialize one hydrated entry only when changing its enclosing counter genus. */
function entryBytes(entry: GroupEntry, gvrsn: Versionage, domain: CesrDomain): Uint8Array {
  if (entry instanceof OpaqueSpan) throw new SerializeError("Cannot change the genus of opaque attachment content");
  if (isGroupTuple(entry)) return join(entry.map((part) => entryBytes(part, gvrsn, domain)));
  if (isCounterGroupLike(entry)) return groupBytes(entry, gvrsn, domain);
  return domain === "txt" ? entry.qb64b : entry.qb2;
}

/** Preserve exact admitted group wire, or rebuild known semantic tuples for another genus. */
function groupBytes(group: AttachmentGroup, gvrsn: Versionage, domain: CesrDomain): Uint8Array {
  // Progressive frames contain semantic leaves: an outer wrapper would introduce illegal nesting.
  const name = group.name.replace(/^Big/, "");
  if (["AttachmentGroup", "BodyWithAttachmentGroup", "GenericGroup"].includes(name)) {
    throw new SerializeError("Serialize attachment leaves rather than nested structural wrappers");
  }
  // Counter raw includes required inner signature counters that tuple hydration omits.
  const sourceDomain = sniff(group.raw);
  if (sourceDomain !== "txt" && sourceDomain !== "bny") throw new SerializeError("Attachment lacks qualified wire");
  if (sameVersion(group.version, gvrsn)) return qualify(group.raw, sourceDomain, domain);
  // Transferable signatures store their final controller-signature list as a plain tuple.
  const payload = join(group.items.map((item) => {
    if (name !== "TransIdxSigGroups" && name !== "TransLastIdxSigGroups") return entryBytes(item, gvrsn, domain);
    if (!isGroupTuple(item) || !isGroupTuple(item[item.length - 1])) {
      throw new SerializeError(`Invalid ${name} signature tuple`);
    }
    // Recreate the inner counter before changing the outer group's count semantics.
    const sigers = item[item.length - 1] as readonly GroupEntry[];
    // Primitive qualification is independent of the enclosing counter's genus.
    const signatures = join(sigers.map((siger) => entryBytes(siger, gvrsn, domain)));
    // V1 counts signature items; v2 counts their qualified payload units.
    const count = gvrsn.major === 1 ? sigers.length : signatures.length / (domain === "txt" ? 4 : 3);
    // KERIpy accepts only the small controller counter inside transferable signature tuples.
    const inner = counter("ControllerIdxSigs", count, gvrsn, domain);
    if (inner.length !== (domain === "txt" ? 4 : 3)) {
      throw new SerializeError("Transferable signature tuple exceeds the small inner counter capacity");
    }
    return join([
      ...item.slice(0, -1).map((part) => entryBytes(part, gvrsn, domain)),
      inner,
      signatures,
    ]);
  }));
  // V1 SadPathSigGroup has a leading root path that is not one counted signature entry.
  const items = name === "SadPathSigGroup" ? group.items.length - 1 : group.items.length;
  // Recompute only the selected genus's count, leaving primitive ordering unchanged.
  const count = gvrsn.major === 1 ? items : payload.length / (domain === "txt" ? 4 : 3);
  return concatBytes(counter(name, count, gvrsn, domain), payload);
}

/** Yield owned bounded chunks so a short view never pins a larger backing allocation downstream. */
function* chunks(bytes: Uint8Array): Generator<Uint8Array> {
  for (let offset = 0; offset < bytes.length; offset += CHUNK_BYTES) {
    yield bytes.slice(offset, offset + CHUNK_BYTES);
  }
}

/** Count qualified fragments from their authoritative primitive values. */
function essrHeader(texters: readonly Texter[], gvrsn: Versionage, domain: CesrDomain): Uint8Array {
  const size = texters.reduce((size, texter) => size + (domain === "txt" ? texter.qb64b.length : texter.qb2.length), 0);
  return counter(
    "ESSRPayloadGroup",
    gvrsn.major === 1 ? texters.length : size / (domain === "txt" ? 4 : 3),
    gvrsn,
    domain,
  );
}

/** Serialize ordinary ESSR fragments under their selected counter genus. */
export function* essrChunks(
  texters: readonly Texter[],
  { gvrsn, domain = "txt" }: { gvrsn: Versionage; domain?: CesrDomain },
): Generator<Uint8Array> {
  yield essrHeader(texters, gvrsn, domain);
  for (const texter of texters) yield* chunks(domain === "txt" ? texter.qb64b : texter.qb2);
}

/**
 * Borrow one child subtree as a qualified BodyWithAttachmentGroup substream.
 * The explicit enclosing genus belongs to the parent; any differing child selector stays
 * inside that boundary. Options choose the tree domain (text by default) and optional
 * genus override. Owners remain with the caller until every reader completes.
 */
export function nestedPayload(frame: CesrFrame, enclosing: Versionage, options: SerializeOptions = {}): Payload {
  const gvrsn = frameGenus(frame, options.gvrsn);
  const domain = options.domain ?? "txt";
  const body = bodyBytes(frame, gvrsn, domain, true);
  // A selector inside the child wrapper cannot alter the following sibling's counter interpretation.
  const selector = sameVersion(enclosing, gvrsn) ? new Uint8Array() : qualify(Counter.makeGVC(gvrsn), "txt", domain);
  // Python's nested extractor expects at least one counter after the body, even without authenticators.
  const empty = !frame.attachments.length && !frame.nests?.length && !frame.essrs
    ? counter("ControllerIdxSigs", 0, gvrsn, domain)
    : undefined;
  const attachments: Payload = empty
    ? {
      size: empty.length,
      /** This reader owns cancellation even when its content is one finite counter. */
      async *open(signal) {
        signal?.throwIfAborted();
        yield empty;
      },
    }
    : attachmentContent(frame, options);
  // All child bytes are qualified, so enclosing counts are quadlets in text and triplets in binary.
  const header = counter(
    "BodyWithAttachmentGroup",
    (selector.length + body.length + attachments.size) / (domain === "txt" ? 4 : 3),
    enclosing,
    domain,
  );
  return {
    size: header.length + selector.length + body.length + attachments.size,
    /** Borrow descendant owners until the caller finishes or cancels this reader. */
    async *open(signal?: AbortSignal) {
      for (const bytes of [header, selector, body]) {
        for (const chunk of chunks(bytes)) {
          signal?.throwIfAborted();
          yield chunk;
        }
      }
      yield* attachments.open(signal);
    },
  };
}

/** Qualify a finite body; nested non-native bodies require a Texter and explicit body enclosure. */
function bodyBytes(frame: CesrFrame, gvrsn: Versionage, domain: CesrDomain, nested: boolean): Uint8Array {
  if (frame.body.kind === Kinds.cesr) {
    if (frame.body.gvrsn && !sameVersion(frame.body.gvrsn, gvrsn)) {
      throw new SerializeError("Cannot change a native body's genus without rebuilding its Serder");
    }
    return qualify(frame.body.raw, sniff(frame.body.raw) as CesrDomain, domain);
  }
  if (!nested) return frame.body.raw;
  // Only the body is encoded here; ESSR retains its separate streamed owner.
  const texter = new Texter({ raw: frame.body.raw, code: "4B" });
  const body = domain === "txt" ? texter.qb64b : texter.qb2;
  return concatBytes(counter("NonNativeBodyGroup", body.length / (domain === "txt" ? 4 : 3), gvrsn, domain), body);
}

/** Borrow ordered attachment content; an enclosing child already supplies its complete boundary. */
function attachmentContent(frame: CesrFrame, options: SerializeOptions): Payload {
  // The frame's resolved genus is distinct from a JSON body's protocol version.
  const gvrsn = frameGenus(frame, options.gvrsn);
  // One attachment enclosure cannot mix text and binary qualification.
  const domain = options.domain ?? "txt";
  // Normalize ordinary leaves before calculating the outer count.
  const groups = frame.attachments.map((group) => groupBytes(group, gvrsn, domain));
  const ordinary = groups.reduce((size, group) => size + group.length, 0);
  // Retain one view per tree node, preserving child order and separate evidence.
  const children = (frame.nests ?? []).map((child) =>
    nestedPayload(child, gvrsn, {
      gvrsn: options.gvrsn,
      domain,
    })
  );
  const nested = children.reduce((size, child) => size + child.size, 0);
  // ESSR wire is derived from the authoritative resident Texter values.
  const essr = frame.essrs;
  // The same helper is used when the stream emits this counted payload.
  const essrPrefix = essr ? essrHeader(essr, gvrsn, domain) : new Uint8Array();
  // Each four text characters encode exactly three binary bytes.
  const essrSize =
    essr?.reduce((size, texter) => size + (domain === "txt" ? texter.qb64b.length : texter.qb2.length), 0) ?? 0;
  return {
    size: ordinary + nested + essrPrefix.length + essrSize,
    /** Each reopen retains the existing owner and streams the same logical attachment bytes. */
    async *open(signal?: AbortSignal) {
      for (const group of groups) {
        for (const chunk of chunks(group)) {
          signal?.throwIfAborted();
          yield chunk;
        }
      }
      for (const child of children) yield* child.open(signal);
      if (essr) {
        for (const chunk of essrChunks(essr, { gvrsn, domain })) {
          signal?.throwIfAborted();
          yield chunk;
        }
      }
    },
  };
}

/** Enclose one tree's attachments; children use their own body boundary without another wrapper. */
export function attachmentPayload(frame: CesrFrame, options: AttachmentOptions = {}): Payload {
  const gvrsn = frameGenus(frame, options.gvrsn);
  const domain = options.domain ?? "txt";
  const content = attachmentContent(frame, options);
  const enclosing = options.enclosingGvrsn ?? gvrsn;
  // KERIpy permits this selector only at the beginning of the attachment enclosure.
  const selector = sameVersion(enclosing, gvrsn) ? new Uint8Array() : qualify(Counter.makeGVC(gvrsn), "txt", domain);
  const header = counter(
    "AttachmentGroup",
    (selector.length + content.size) / (domain === "txt" ? 4 : 3),
    enclosing,
    domain,
  );
  return {
    size: header.length + selector.length + content.size,
    /** The caller retains every owner until this complete attachment reader closes. */
    async *open(signal?: AbortSignal) {
      for (const bytes of [header, selector]) {
        for (const chunk of chunks(bytes)) {
          signal?.throwIfAborted();
          yield chunk;
        }
      }
      yield* content.open(signal);
    },
  };
}

/** Serialize one hydrated frame with an explicit genus and a complete attachment boundary. */
export function framePayload(frame: CesrFrame, options: SerializeOptions = {}): Payload {
  // Native bodies declare a genus in their own qualification; JSON protocol versions do not.
  const gvrsn = frameGenus(frame, options.gvrsn);
  // One attachment enclosure cannot mix text and binary qualification.
  const domain = options.domain ?? "txt";
  const body = bodyBytes(frame, gvrsn, domain, false);
  // Views borrow every tree owner; preserve descendant genera unless the caller explicitly overrides them.
  const attachments = attachmentPayload(frame, options);
  // Explicit selection prevents a non-native body's protocol version from changing counter interpretation.
  const selector = Counter.makeGVC(gvrsn);
  // Selectors are ordinary qualified CESR tokens in either output domain.
  const prefix = domain === "txt" ? selector : decodeB64(byteString(selector));
  return {
    size: prefix.length + body.length + attachments.size,
    /** Yield prefix, finite body, and streamed attachments under the caller's cancellation signal. */
    async *open(signal?: AbortSignal) {
      for (const bytes of [prefix, body]) {
        for (const chunk of chunks(bytes)) {
          signal?.throwIfAborted();
          yield chunk;
        }
      }
      yield* attachments.open(signal);
    },
  };
}
