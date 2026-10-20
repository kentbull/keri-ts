import { Diger, MtrDex, parseBexter, parsePrefixer, ParserError, parseTagger } from "cesr-ts";
import type { Hab } from "./habbing.ts";

/** Expected recipient outcomes; acceptance returns ordinary authenticated data. */
export type EssrDecision =
  | { kind: "accept"; message: EssrMessage }
  | { kind: "refuse"; reason: "unaccepted" }
  | { kind: "reject"; reason: "envelope" | "digest" | "decrypt" | "framing" };

/** Authenticated inner bytes, owned by the caller until released or overwritten. */
export interface EssrMessage {
  /** Sender authenticated by both the signed EXN and decrypted SCS prefix. */
  sender: string;
  /** Explicit hosted recipient selected by the signed destination. */
  recipient: string;
  /** Caller-owned inner CESR bytes, excluding the authenticated SCS header and padding. */
  body: Uint8Array;
}

/** Verify and decrypt accepted LMDB evidence for one explicitly hosted recipient. */
export class EssrRecipient {
  /** Bind the local key owner; recipient selection never searches other habitats. */
  constructor(private readonly hab: Hab) {}

  /**
   * Read accepted evidence, verify its signed commitment and return authenticated inner bytes.
   *
   * Processing is synchronous: LMDB and sealed-box crypto already expose finite bytes.
   * The result has no file/disposal lifecycle and is never persisted automatically.
   */
  decrypt(said: string): EssrDecision {
    const serder = this.hab.db.exns.get([said]);
    if (!serder) return { kind: "refuse", reason: "unaccepted" };
    if (serder.said !== said) throw new Error("Stored ESSR exchange SAID does not match its key");
    const modifiers = serder.ked?.q as Record<string, unknown> | undefined;
    if (
      serder.ilk !== "exn" || serder.route !== "/essr/req"
      || !serder.pre || modifiers?.src !== serder.pre
      || modifiers?.dest !== this.hab.pre || !this.hab.db.prefixes.has(this.hab.pre)
      || typeof serder.a !== "string"
    ) return { kind: "reject", reason: "envelope" };
    const verfer = this.hab.kever?.verfers[0];
    if (!verfer) throw new Error("ESSR recipient has no accepted verification key");
    let diger: Diger;
    try {
      diger = new Diger({ qb64: serder.a });
    } catch (error) {
      if (error instanceof ParserError) return { kind: "reject", reason: "envelope" };
      throw error;
    }
    const fragments = this.hab.db.getEssrs(said);
    if (!fragments || !diger.verifyChunks(fragments.map((part) => part.raw))) {
      return { kind: "reject", reason: "digest" };
    }
    const sealed = new Uint8Array(fragments.reduce((size, part) => size + part.raw.length, 0));
    let at = 0;
    for (const part of fragments) {
      sealed.set(part.raw, at);
      at += part.raw.length;
    }
    if (sealed.length < 48) return { kind: "reject", reason: "envelope" };
    // Only authentication failure returns null. Keeper and backend failures propagate.
    const plain = this.hab.mgr.open(sealed, verfer);
    if (plain === null) return { kind: "reject", reason: "decrypt" };
    const offset = bodyOffset(plain, serder.pre);
    if (offset === null) {
      plain.fill(0);
      return { kind: "reject", reason: "framing" };
    }
    return {
      kind: "accept",
      message: { sender: serder.pre, recipient: this.hab.pre, body: plain.subarray(offset) },
    };
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
