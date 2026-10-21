import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { Counter } from "../../packages/cesr/src/primitives/base/counter.ts";
import { CtrDexV1, CtrDexV2 } from "../../packages/cesr/src/tables/counter-codex.ts";
import {
  KERIPY_NATIVE_V2_EXN_FIX_BODY,
  KERIPY_V1_JSON_ICP_BODY,
} from "../../packages/cesr/test/fixtures/external-vectors.ts";

export interface CorpusOptions {
  payloadBytes: number;
  itemBytes: number;
  chunkBytes: number;
  depth: number;
  genus: 1 | 2;
  binary: boolean;
}

/** Encode benchmark bytes independently of the implementation under measurement. */
function texter(raw: Uint8Array): string {
  // Pad to a multiple of three bytes: remainders 0, 1, 2 need 0, 2, 1 zeros.
  // The final modulo maps an already aligned input from three back to zero.
  const lead = (3 - raw.length % 3) % 3;
  const padded = Buffer.alloc(raw.length + lead);
  padded.set(raw, lead);
  // Leading zeros align the payload to complete four-character base64 groups.
  const body = padded.toString("base64url");
  const count = body.length / 4;
  // Two base64 size digits hold 0..4095; larger counts require four digits.
  const big = count >= 4096;
  // Each code family indexes by the zero-byte lead, so decoding removes it.
  const code = big ? ["7AAB", "8AAB", "9AAB"][lead] : ["4B", "5B", "6B"][lead];
  let soft = "";
  let remaining = count;
  // Emit the quadlet count in base 64, most significant digit first.
  for (let i = 0; i < (big ? 4 : 2); i++) {
    soft = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"[remaining % 64] + soft;
    remaining = Math.floor(remaining / 64);
  }
  if (remaining) throw new Error("Benchmark item exceeds Texter capacity");
  return code + soft + body;
}

/** Build one reusable item and small enclosure headers; never allocate the aggregate corpus. */
export function corpus(options: CorpusOptions) {
  const { payloadBytes, itemBytes, chunkBytes, depth, genus, binary } = options;
  for (const n of [payloadBytes, itemBytes, chunkBytes]) {
    if (!Number.isSafeInteger(n) || n < 1) throw new Error("Sizes must be positive safe integers");
  }
  if (!Number.isInteger(depth) || depth < 0 || depth > 32) throw new Error("Invalid corpus depth");
  if (payloadBytes % itemBytes) throw new Error("Payload size must be divisible by item size");
  if (itemBytes < 16) throw new Error("Items must fit the sequence oracle");
  const dex = genus === 1 ? CtrDexV1 : CtrDexV2;
  const counter = (code: string, count: number) =>
    new Counter({ code: count >= 4096 ? `-${code}` : code, count, version: { major: genus, minor: 0 } }).qb64;
  const raw = Uint8Array.from({ length: itemBytes }, (_, i) => i % 251);
  const token = texter(raw);
  const body = genus === 2
    ? KERIPY_NATIVE_V2_EXN_FIX_BODY
    : (() => {
      const wrapped = texter(new TextEncoder().encode(KERIPY_V1_JSON_ICP_BODY));
      return counter(dex.NonNativeBodyGroup, wrapped.length / 4) + wrapped;
    })();
  // V1 counts Texter items; V2 counts encoded payload quadlets.
  const attached = body + counter(dex.ESSRPayloadGroup, genus === 1 ? 1 : token.length / 4) + token;
  const frame = counter(dex.BodyWithAttachmentGroup, attached.length / 4) + attached;
  const item = binary ? new Uint8Array(Buffer.from(frame, "base64url")) : new TextEncoder().encode(frame);
  const lead = (3 - raw.length % 3) % 3;
  const tokenHeader = token[0] < "7" ? 4 : 8;
  // Locate the payload after all outer headers and the Texter size header.
  const payloadOffset = frame.length - token.length + tokenHeader;
  const prefix = Buffer.alloc(12);
  prefix.set(raw.subarray(0, 12 - lead), lead);
  const unit = binary ? 3 : 4;
  const items = payloadBytes / itemBytes;
  // A big counter still has finite capacity. A 4 GiB aggregate is several legal
  // enclosures, each carrying at most 1 GiB of raw payload, not one invalid count.
  const groupItems = Math.min(items, Math.max(1, Math.floor(1024 ** 3 / itemBytes)));
  const headersFor = (count: number): Uint8Array[] => {
    let size = item.length * count;
    const headers: Uint8Array[] = [];
    for (let level = 0; level < depth; level++) {
      const header = counter(dex.GenericGroup, size / unit);
      const bytes = binary ? new Uint8Array(Buffer.from(header, "base64url")) : new TextEncoder().encode(header);
      headers.unshift(bytes);
      // The next outer enclosure includes this inner counter in its extent.
      size += bytes.length;
    }
    return headers;
  };
  let wireBytes = item.length * items;
  for (let at = 0; at < items; at += groupItems) {
    wireBytes += headersFor(Math.min(groupItems, items - at)).reduce((sum, value) => sum + value.length, 0);
  }
  const digest = createHash("sha256").update(raw).digest("hex");
  const manifest = {
    ...options,
    groupItems,
    items,
    wireBytes,
    itemSha256: digest,
    wireTemplateSha256: createHash("sha256").update(item).digest("hex"),
    sequence: "big-endian uint64 in the first eight raw bytes; remaining bytes repeat index modulo 251",
  };

  function* chunks(): Generator<Uint8Array> {
    let output = new Uint8Array(chunkBytes);
    let used = 0;
    function* append(part: Uint8Array): Generator<Uint8Array> {
      let offset = 0;
      while (offset < part.length) {
        const size = Math.min(part.length - offset, output.length - used);
        output.set(part.subarray(offset, offset + size), used);
        offset += size;
        used += size;
        if (used === output.length) {
          // Transfer a full buffer; allocate a fresh one before any later write.
          yield output;
          output = new Uint8Array(chunkBytes);
          used = 0;
        }
      }
    }
    for (let at = 0; at < items; at += groupItems) {
      const count = Math.min(groupItems, items - at);
      for (const header of headersFor(count)) yield* append(header);
      for (let i = 0; i < count; i++) {
        // Change only the sequence prefix; the rest of the item is reusable.
        prefix.writeBigUInt64BE(BigInt(at + i), lead);
        item.set(
          binary ? prefix : new TextEncoder().encode(prefix.toString("base64url")),
          // Complete qb64 quadlets occupy three bytes each in qb2.
          binary ? payloadOffset * 3 / 4 : payloadOffset,
        );
        yield* append(item);
      }
    }
    if (used) yield output.subarray(0, used);
  }
  return { manifest, chunks };
}
