import {
  collectPayload,
  Diger,
  MtrDex,
  parseBexter,
  parsePrefixer,
  ParserError,
  parseTagger,
  type Payload,
  type ResourcePolicy,
  type ResourceReservation,
} from "cesr-ts";
import { call, type Operation, resource } from "effection";
import type { FilePayload, PayloadStore } from "../db/payload-store.ts";
import { payloadRange } from "../db/payload-view.ts";
import { abortable } from "./abortable.ts";
import type { Hab } from "./habbing.ts";

/** Expected recipient outcomes; only acceptance transfers an authenticated plaintext owner. */
export type EssrDecision =
  | { kind: "accept"; message: EssrMessage }
  | { kind: "refuse"; reason: "busy" | "limit" | "unaccepted" }
  | { kind: "reject"; reason: "envelope" | "digest" | "decrypt" | "framing" };

/** One owning plaintext file and a non-owning view of its inner CESR stream. */
export interface EssrMessage {
  /** Sender authenticated by both the signed EXN and decrypted SCS prefix. */
  sender: string;
  /** Explicit hosted recipient selected by the signed destination. */
  recipient: string;
  /** Owning authenticated envelope file; discard also invalidates body. */
  plaintext: FilePayload;
  /** Non-owning inner CESR source, excluding the SCS header and padding. */
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
  /** Admitted decryptions, including ciphertext reads and plaintext writes. */
  private active = 0;

  /** Bind one hosted habitat and finite per-message/concurrency budgets to a staging store. */
  constructor(
    /** Explicit local key owner; recipient selection never searches other habitats. */
    private readonly hab: Hab,
    /** Owns authenticated plaintext staging; the successful caller owns its result. */
    private readonly store: PayloadStore,
    /** Ciphertext allocation cap, including the 48-byte sealed-box overhead. */
    private readonly maxMessageBytes: number,
    /** Shared with every recipient and other admitted work in the hosting runtime. */
    private readonly policy: ResourcePolicy,
    /** Maximum admitted requests for this recipient; excess work refuses instead of queueing. */
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
  decrypt(said: string, ciphertext: Payload, signal?: AbortSignal): Operation<EssrDecision> {
    return call(() => this.receive(said, ciphertext, signal));
  }

  /** Isolate cancellation and retain ownership until the consumer receives the result. */
  private *receive(said: string, ciphertext: Payload, signal?: AbortSignal): Operation<EssrDecision> {
    let received: EssrMessage | undefined;
    let transferred = false;
    const admission: { reservation?: ResourceReservation } = {};
    const release = () => {
      if (admission.reservation) {
        admission.reservation.release();
        admission.reservation = undefined;
        this.active--;
      }
    };
    // The later I/O child is cancelled and joined before this owner is finalized.
    yield* resource(function*(provide) {
      try {
        yield* provide(undefined);
      } finally {
        try {
          if (!transferred && received) yield* call(() => received!.plaintext.discard());
        } finally {
          release();
        }
      }
    });
    const result = yield* abortable(async (scopeSignal) => {
      const decision = await this.decryptMessage(said, ciphertext, scopeSignal, admission);
      if (decision.kind === "accept") received = decision.message;
      scopeSignal.throwIfAborted();
      return decision;
    }, signal);
    transferred = true;
    return result;
  }

  /** Own the finite crypto buffer and unfinished file until signal-aware cleanup completes. */
  private async decryptMessage(
    said: string,
    ciphertext: Payload,
    signal: AbortSignal,
    admission: { reservation?: ResourceReservation },
  ): Promise<EssrDecision> {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(ciphertext.size) || ciphertext.size < 0) {
      throw new RangeError("Invalid payload size or limit");
    }
    if (ciphertext.size > this.maxMessageBytes) return { kind: "refuse", reason: "limit" };
    if (ciphertext.size < 48) return { kind: "reject", reason: "envelope" };
    // Use the approved initial eightfold crypto credit, at least 64 MiB per request.
    // This is conservative admission policy; native-copy measurements still need qualification.
    if (ciphertext.size > Math.floor(this.policy.limits.bytes / 8)) return { kind: "refuse", reason: "limit" };
    const credit = this.policy.reserve({ bytes: Math.max(64 * 1024 ** 2, ciphertext.size * 8), decryptions: 1 });
    if (credit.kind === "refuse") return { kind: "refuse", reason: credit.reason };
    if (this.active >= this.maxConcurrent) {
      credit.reservation.release();
      return { kind: "refuse", reason: "busy" };
    }
    admission.reservation = credit.reservation;
    this.active++;
    // Keep buffers and any finished file owned until the result can transfer them.
    let plain: Uint8Array | null = null;
    let plaintext: FilePayload | undefined;
    try {
      const serder = this.hab.db.exns.get([said]);
      if (!serder) return { kind: "refuse", reason: "unaccepted" };
      if (serder.said !== said) throw new Error("Stored ESSR exchange SAID does not match its key");
      const modifiers = serder.ked?.q as Record<string, unknown> | undefined;
      if (
        serder.ilk !== "exn" || serder.route !== "/essr/req"
        || !serder.pre || modifiers?.src !== serder.pre
        || modifiers?.dest !== this.hab.pre || !this.hab.db.prefixes.has(this.hab.pre)
        || typeof serder.a !== "string"
      ) {
        return { kind: "reject", reason: "envelope" };
      }
      const verfer = this.hab.kever?.verfers[0];
      if (!verfer) throw new Error("ESSR recipient has no accepted verification key");
      let diger: Diger;
      try {
        diger = new Diger({ qb64: serder.a });
      } catch (error) {
        if (error instanceof ParserError) return { kind: "reject", reason: "envelope" };
        throw error;
      }
      const sealed = await collectPayload(ciphertext, signal);
      if (!diger.verify(sealed)) return { kind: "reject", reason: "digest" };
      signal?.throwIfAborted();
      // The raw crypto boundary returns null only for authentication failure.
      // Keeper reads, key derivation and unexpected backend failures stay abrupt.
      plain = this.hab.mgr.open(sealed, verfer);
      if (plain === null) return { kind: "reject", reason: "decrypt" };
      signal?.throwIfAborted();
      const offset = bodyOffset(plain, serder.pre);
      if (offset === null) return { kind: "reject", reason: "framing" };
      const sink = await this.store.stage(signal);
      try {
        for (let start = 0; start < plain.length; start += 65536) {
          await sink.write(plain.subarray(start, start + 65536));
        }
        plaintext = await sink.finish();
      } finally {
        // Successful finish transferred ownership, so this only removes an
        // unfinished stage when writing or cancellation failed.
        await sink.abort();
      }
      return {
        kind: "accept",
        message: { sender: serder.pre, recipient: this.hab.pre, plaintext, body: payloadRange(plaintext, offset) },
      };
    } catch (error) {
      // finish may have transferred a file before abort/hand-off failed.
      if (plaintext) {
        try {
          await plaintext.discard();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "ESSR processing and plaintext cleanup failed");
        }
      }
      throw error;
    } finally {
      plain?.fill(0);
    }
  }
}

/** Read KERIpy's text-qualified SCS tag, source prefix, and variable padding. */
function bodyOffset(plain: Uint8Array, sender: string): number | null {
  try {
    const tag = parseTagger(plain, "txt");
    if (tag.code !== MtrDex.Tag3 || tag.tag !== "SCS") return null;
    const prefix = parsePrefixer(plain.subarray(tag.fullSize), "txt");
    if (prefix.qb64 !== sender) return null;
    const paddingAt = tag.fullSize + prefix.fullSize;
    const padding = parseBexter(plain.subarray(paddingAt), "txt");
    const offset = paddingAt + padding.fullSize;
    if (offset >= plain.length) return null;
    return offset;
  } catch (error) {
    if (error instanceof ParserError) return null;
    throw error;
  }
}
