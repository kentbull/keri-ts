/** The KEL of a local identifier as bytes to post to a mailbox host that must learn its key state. */
import { concatBytes } from "cesr-ts";
import type { Habery } from "../identity/habbing.ts";

/** Replay material in both the normalized and legacy multipart shapes. */
export interface KelSubmission {
  /** Verifier-ready stream for the raw CESR body: delegation chain then KEL, with the receipts stored for it. */
  readonly replay: Uint8Array;
  readonly kel: Uint8Array;
  readonly delkel: Uint8Array;
}

/**
 * Collect the accepted KEL of `pre`, and its delegation chain, from the local stores.
 *
 * `replay` is the verifier-ready stream used by raw CESR ingress. `kel`/`delkel` preserve the legacy
 * multipart wrapper contract used by existing KERIpy mailbox admin hosts.
 */
export function collectKelSubmission(hby: Habery, pre: string): KelSubmission {
  const kever = hby.db.getKever(pre);
  const delkel = kever ? concatBytes(...hby.db.cloneDelegation(kever)) : new Uint8Array();
  const kel = concatBytes(...hby.db.clonePreIter(pre));
  return { replay: concatBytes(delkel, kel), kel, delkel };
}
