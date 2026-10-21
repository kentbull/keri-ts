/** Select public KEL and endpoint evidence needed to introduce a sender to a remote peer. */
import { concatBytes } from "cesr-ts";
import { dgKey } from "../../db/core/keys.ts";
import type { Hab } from "../identity/habbing.ts";

/**
 * Borrow a Hab/store for lazy introduction output, preserving target KEL, oldest
 * delegator first, then endpoint/location replies. Capture begins on iteration.
 * No source is opened when a witness/receipt already makes introduction unnecessary.
 * Native proof/key copies and the large-history transport caller remain separately qualified.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param remote Remote endpoint AID whose receipt history determines whether introduction is needed.
 * @returns Reopenable introduction iterable.
 */
export function introductionMessages(
  hab: Hab,
  remote: string,
): Iterable<Uint8Array> {
  const endpoints = hab.replyEndRoleMessages(hab.pre);
  return {
    /**
     * Reopen introduction messages when a caller consumes them.
     *
     * @returns A fresh local replay iterator over the captured introduction selection.
     */
    *[Symbol.iterator]() {
      const kever = hab.kever;
      if (!kever || kever.wits.includes(remote)) return;
      const latestSaid = kever.serder.said;
      if (!latestSaid || remoteAlreadyReceiptedLatestEvent(hab, remote, latestSaid)) return;
      const captured = hab.db.replay(hab.pre);
      if (captured) yield* captured;
      yield* endpoints;
    },
  };
}

/**
 * Collect the introduction required by the existing finite query/forwarding path.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param remote Remote endpoint AID whose receipt history determines whether introduction is needed.
 * @returns Collected introduction bytes, possibly empty.
 */
export function introduce(hab: Hab, remote: string): Uint8Array {
  return concatBytes(...introductionMessages(hab, remote));
}

/**
 * Check known receipts before adding a redundant introduction.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param remote Remote attester AID to seek in receipt evidence.
 * @param said Latest event SAID used for the receipt lookup.
 * @returns Whether stored receipt evidence names the remote attester.
 */
function remoteAlreadyReceiptedLatestEvent(
  hab: Hab,
  remote: string,
  said: string,
): boolean {
  const keys = [
    dgKey(hab.pre, said),
    dgKey(remote, said),
  ];
  for (const key of keys) {
    if (hab.db.vrcs.get(key).some(([prefixer]) => prefixer.qb64 === remote)) {
      return true;
    }
    if (
      hab.db.rcts.get(key).some(([prefixer]) => prefixer.qb64.startsWith(remote))
    ) {
      return true;
    }
  }
  return false;
}
