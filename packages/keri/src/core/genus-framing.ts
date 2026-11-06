/** Stream genus framing for concatenated messages whose attachment genera may differ. */
import { b64ToInt, concatBytes, Counter, smell, sniff, type Versionage, VersionError, Vrsn_2_0 } from "cesr-ts";

/** Text-domain genus-version counter code; its three-character count is major plus two-character minor. */
const GENUS_VERSION_CODE = "-_AAA";

/** Attachment genus a stream message is framed in, or the genus a leading selector switches to. */
function messageGenus(message: Uint8Array): { genus: Versionage; selector: boolean } {
  if (sniff(message) === "msg") {
    const { pvrsn, gvrsn } = smell(message).smellage;
    // A v2 version string may leave its genus field unset (0.00); the protocol version then governs.
    return { genus: gvrsn && gvrsn.major > 0 ? gvrsn : pvrsn, selector: false };
  }
  const head = new TextDecoder().decode(message.subarray(0, 8));
  if (head.startsWith(GENUS_VERSION_CODE) && head.length === 8) {
    const major = b64ToInt(head[5]);
    if (major !== 1 && major !== 2) throw new VersionError(`Unsupported stream genus major ${major}`);
    return { genus: { major, minor: b64ToInt(head.slice(6)) }, selector: true };
  }
  // Native CESR bodies and enclosing message groups exist only in genus 2.
  return { genus: Vrsn_2_0, selector: false };
}

/**
 * Prefix a genus-version counter wherever consecutive messages change attachment genus.
 *
 * Receivers keep a stream's genus across messages and change it only at a top-level
 * genus-version counter: KERIpy starts every stream at 2.0, and keri-ts infers the
 * first unselected body and then keeps any selection. The first message sets the
 * stream's genus without a counter, so single-genus streams stay byte-identical; each
 * later change carries its counter in the same chunk as the message it selects.
 * Messages that already begin with a selector set the current genus unchanged.
 */
export function* genusFramed(messages: Iterable<Uint8Array>): Generator<Uint8Array> {
  let current: Versionage | null = null;
  for (const message of messages) {
    if (message.length === 0) {
      yield message;
      continue;
    }
    const { genus, selector } = messageGenus(message);
    const changed = current !== null && (current.major !== genus.major || current.minor !== genus.minor);
    current = genus;
    yield changed && !selector ? concatBytes(Counter.makeGVC(genus), message) : message;
  }
}
