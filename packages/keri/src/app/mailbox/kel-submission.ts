/** The KEL of a local identifier as bytes to post to a mailbox host that must learn its key state. */
import { concatBytes } from "cesr-ts";
import type { Habery } from "../identity/habbing.ts";
import { localGroupMember } from "../multisig/group-members.ts";

/** Replay material in both the normalized and legacy multipart shapes. */
export interface KelSubmission {
  /** Verifier-ready stream for the raw CESR body: delegation chain then KEL, with the receipts stored for it. */
  readonly replay: Uint8Array;
  readonly kel: Uint8Array;
  readonly delkel: Uint8Array;
}

/**
 * Collect the accepted KEL of `pre`, and its delegation chain, from the local stores. When `pre` is a local
 * group the KEL of the local member that signs for it comes first, so a host that authenticates the member's
 * mailbox polls learns the member's key state, including a rotation of its own, along with the group's.
 *
 * `replay` is the verifier-ready stream used by raw CESR ingress. `kel`/`delkel` preserve the legacy
 * multipart wrapper contract used by existing KERIpy mailbox admin hosts.
 */
export function collectKelSubmission(hby: Habery, pre: string): KelSubmission {
  const parts = [...(hby.db.getHab(pre)?.mid ? [localGroupMember(hby, pre).pre] : []), pre].map((each) => {
    const kever = hby.db.getKever(each);
    return {
      delkel: kever ? concatBytes(...hby.db.cloneDelegation(kever)) : new Uint8Array(),
      kel: concatBytes(...hby.db.clonePreIter(each)),
    };
  });
  const delkel = concatBytes(...parts.map((part) => part.delkel));
  const kel = concatBytes(...parts.map((part) => part.kel));
  const replay = concatBytes(...parts.flatMap((part) => [part.delkel, part.kel]));
  return { replay, kel, delkel };
}
