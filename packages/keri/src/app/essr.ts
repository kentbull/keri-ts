import { collectPayload, Diger, MtrDex, parseBexter, parsePrefixer, parseTagger, type Payload } from "cesr-ts";
import { ValidationError } from "../core/errors.ts";
import type { FilePayload, PayloadStore } from "../db/payload-store.ts";
import type { Hab } from "./habbing.ts";

/** Expected ESSR admission failures; no failure publishes plaintext. */
export class EssrError extends ValidationError {
  constructor(
    readonly kind: "unaccepted" | "envelope" | "limit" | "busy" | "digest" | "decrypt" | "framing",
    message: string,
  ) {
    super(message);
  }
}

/** One owning plaintext file and a non-owning view of its inner CESR stream. */
export interface EssrMessage {
  sender: string;
  recipient: string;
  plaintext: FilePayload;
  body: Payload;
}

/**
 * Recipient processing compatible with KERIpy StreamPoster's SCS envelope.
 *
 * This is a new explicit receiver integration, not a port of an upstream
 * receiver. Call only after Exchanger acceptance; the accepted EXN is loaded
 * from its durable table. Ciphertext evidence stays owned by that exchange.
 */
export class EssrRecipient {
  private active = 0;

  constructor(
    private readonly hab: Hab,
    private readonly store: PayloadStore,
    private readonly maxMessageBytes: number,
    private readonly maxConcurrent = 1,
  ) {
    if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes < 48) {
      throw new RangeError("Invalid ESSR message limit");
    }
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new RangeError("Invalid ESSR concurrency limit");
    }
  }

  /**
   * Verify one accepted exchange's ciphertext, decrypt, then stage plaintext.
   *
   * Texter fragments must be concatenated by the supplied Payload reader. A
   * successful result transfers file ownership to the caller; discarding that
   * file also invalidates body. No complete byte buffer escapes in the result.
   */
  async decrypt(said: string, ciphertext: Payload, signal?: AbortSignal): Promise<EssrMessage> {
    signal?.throwIfAborted();
    if (this.active >= this.maxConcurrent) throw new EssrError("busy", "ESSR recipient concurrency limit reached");
    if (!Number.isSafeInteger(ciphertext.size) || ciphertext.size < 48 || ciphertext.size > this.maxMessageBytes) {
      throw new EssrError("limit", "ESSR ciphertext exceeds admitted message size");
    }
    this.active++;
    let plain: Uint8Array | undefined;
    try {
      const serder = this.hab.db.exns.get([said]);
      if (!serder || serder.said !== said) throw new EssrError("unaccepted", "ESSR exchange has not been accepted");
      const modifiers = serder.ked?.q as Record<string, unknown> | undefined;
      if (
        serder.ilk !== "exn" || serder.route !== "/essr/req"
        || !serder.pre || modifiers?.src !== serder.pre
        || modifiers?.dest !== this.hab.pre || !this.hab.db.prefixes.has(this.hab.pre)
        || typeof serder.a !== "string"
      ) {
        throw new EssrError("envelope", "ESSR envelope source, destination, route, or digest is invalid");
      }
      const verfer = this.hab.kever?.verfers[0];
      if (!verfer) throw new EssrError("envelope", "ESSR recipient has no accepted verification key");
      let diger: Diger;
      try {
        diger = new Diger({ qb64: serder.a });
      } catch {
        throw new EssrError("envelope", "ESSR envelope has an invalid ciphertext digest");
      }
      const sealed = await collectPayload(ciphertext, this.maxMessageBytes, signal);
      if (!diger.verify(sealed)) throw new EssrError("digest", "ESSR ciphertext digest mismatch");
      signal?.throwIfAborted();
      try {
        // StreamPoster selects this recipient's first current verifier. Never
        // try unrelated hosted habitats or reinterpret ciphertext as qb64.
        plain = this.hab.mgr.open(sealed, verfer);
      } catch {
        throw new EssrError("decrypt", "ESSR sealed-box authentication failed or recipient key is unavailable");
      }
      signal?.throwIfAborted();
      const offset = bodyOffset(plain, serder.pre);
      const sink = await this.store.stage(plain.length, signal);
      try {
        for (let start = 0; start < plain.length; start += 65536) {
          await sink.write(plain.subarray(start, start + 65536));
        }
        const plaintext = await sink.finish();
        return { sender: serder.pre, recipient: this.hab.pre, plaintext, body: bodyView(plaintext, offset) };
      } finally {
        // Successful finish transferred ownership, so this only removes an
        // unfinished stage when writing or cancellation failed.
        await sink.abort();
      }
    } finally {
      plain?.fill(0);
      this.active--;
    }
  }
}

/** Read KERIpy's text-qualified SCS tag, source prefix, and variable padding. */
function bodyOffset(plain: Uint8Array, sender: string): number {
  try {
    const tag = parseTagger(plain, "txt");
    if (tag.code !== MtrDex.Tag3 || tag.tag !== "SCS") throw new Error("Unsupported ESSR payload tag");
    const prefix = parsePrefixer(plain.subarray(tag.fullSize), "txt");
    if (prefix.qb64 !== sender) throw new Error("ESSR plaintext source does not match authenticated sender");
    const paddingAt = tag.fullSize + prefix.fullSize;
    const padding = parseBexter(plain.subarray(paddingAt), "txt");
    const offset = paddingAt + padding.fullSize;
    if (offset >= plain.length) throw new Error("ESSR payload has no inner CESR stream");
    return offset;
  } catch (error) {
    throw new EssrError("framing", error instanceof Error ? error.message : "Invalid ESSR SCS framing");
  }
}

/** Skip the authenticated header on each file read without retaining plaintext. */
function bodyView(plaintext: Payload, offset: number): Payload {
  return {
    size: plaintext.size - offset,
    async *open(signal?: AbortSignal) {
      let skip = offset;
      for await (const chunk of plaintext.open(signal)) {
        const count = Math.min(skip, chunk.length);
        skip -= count;
        if (count < chunk.length) yield chunk.subarray(count);
      }
    },
  };
}
