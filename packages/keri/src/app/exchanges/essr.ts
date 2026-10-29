/**
 * ESSR recipient authentication and finite sealed-box decryption.
 * Exchanger owns signed envelope acceptance and Baser owns retained Texters;
 * this module reads that accepted evidence for one explicitly selected local Hab.
 * Protocol authentication is independent of storage and plaintext is not saved.
 */
import {
  Bexter,
  concatBytes,
  Diger,
  Encrypter,
  essrChunks,
  MtrDex,
  parseBexter,
  parsePrefixer,
  ParserError,
  parseTagger,
  Tagger,
  Texter,
  type Verfer,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { exchange } from "../../core/exchange/protocol-exchanging.ts";
import type { Hab } from "../identity/habbing.ts";

/** Seal an ordinary CESR stream with KERIpy StreamPoster's SCS framing.
 * The caller authenticates the selected individual recipient key. The outer
 * sender authenticates transport provenance; inner messages retain their own
 * signatures and authority. No sender state or delivery record is created.
 */
export function essrEnvelope(sender: Hab, body: Uint8Array, recipient: string, key: Verfer): Uint8Array {
  const plaintext = concatBytes(
    new Tagger({ qb64: "XSCS" }).qb64b,
    sender.kever!.prefixer.qb64b,
    new Bexter({ qb64: "4AAA" }).qb64b,
    body,
  );
  const ciphertext = new Encrypter({ verkey: key.qb64 }).encrypt({
    ser: plaintext,
    code: MtrDex.X25519_Cipher_L0,
  }).raw;
  const [outer] = exchange("/essr/req", {}, {
    sender: sender.pre,
    pvrsn: Vrsn_1_0,
    diger: new Diger({ raw: Diger.digest(ciphertext, MtrDex.Blake3_256), code: MtrDex.Blake3_256 }),
    modifiers: { src: sender.pre, dest: recipient },
  });
  // The v1 envelope body can carry a v2 reply; declare its attachment genus
  // so KERIpy keeps v2 parsing active when dispatching the decrypted reply.
  return concatBytes(
    sender.endorse(outer, { pipelined: false, gvrsn: Vrsn_2_0, genusify: true }),
    ...essrChunks([new Texter({ raw: ciphertext, code: MtrDex.Bytes_L0 })], { gvrsn: Vrsn_2_0 }),
  );
}

/** Expected recipient outcomes; acceptance returns ordinary authenticated data. */
export type EssrDecision =
  | { kind: "accept"; message: EssrMessage }
  | { kind: "refuse"; reason: "unaccepted" }
  | { kind: "reject"; reason: "envelope" | "digest" | "decrypt" | "framing" };

/**
 * Authenticated inner bytes owned by the caller. No disposal API or persistent
 * plaintext record is created. body is a view into the decrypted allocation;
 * consumers decide how long to retain it and whether to overwrite sensitive data.
 */
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
   * Envelope checks bind the EXN sender/source and destination to this local Hab;
   * the decrypted SCS header must repeat the authenticated sender. Verify the
   * signed digest over stored Texter raw bytes before attempting decryption.
   *
   * Baser follows pinned-main ordered-set semantics: repeated identical Texters
   * can be lost during persistence. Such retained evidence fails this digest check
   * rather than returning unauthenticated plaintext. See the repeated-fragment
   * report in docs/reports/essr for the known reference limitation.
   *
   * @param said Accepted outer ESSR EXN SAID, not the payload digest.
   * @returns Typed absence, authentication/framing rejection or authenticated bytes.
   * @throws Corrupt stored identity, missing local key state and storage/crypto
   * infrastructure failures propagate; only actual sealed-box authentication failure
   * becomes a decrypt rejection.
   */
  decrypt(said: string): EssrDecision {
    const serder = this.hab.db.exns.get([said]);
    if (!serder) return { kind: "refuse", reason: "unaccepted" };
    if (serder.said !== said) throw new Error("Stored ESSR exchange SAID does not match its key");
    const modifiers = serder.ked?.q as Record<string, unknown> | undefined;
    if (
      serder.ilk !== "exn" || serder.route !== "/essr/req" ||
      !serder.pre || modifiers?.src !== serder.pre ||
      modifiers?.dest !== this.hab.pre || !this.hab.db.prefixes.has(this.hab.pre) ||
      typeof serder.a !== "string"
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
