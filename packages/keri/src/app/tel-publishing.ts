/** Finite legacy TEL receipt collection and witness publication; no delivery acknowledgement is inferred. */
import type { Operation } from "effection";
import { ValidationError } from "../core/errors.ts";
import type { TelPublication } from "../vdr/tel-publication.ts";
import type { Habery } from "./habbing.ts";
import type { HttpClient } from "./http-client.ts";
import type { RuntimeClock } from "./runtime-clock.ts";
import { type Receiptor, sendWitnessMessage } from "./witnessing.ts";

/**
 * Advance one captured set of protocol escrows. Receipt collection includes
 * fanout; a crash before its commit repeats that ordinary finite operation.
 * Dissemination replays accepted TEL evidence to the anchor's historical witness
 * cohort and commits ctel only after every local transmission finished. Failure
 * retains the corresponding escrow for explicit resume, without an outbox.
 */
export function* publishPendingTel(
  hby: Habery,
  publication: TelPublication,
  receiptor: Receiptor,
  http: HttpClient,
  clock: RuntimeClock,
): Operation<void> {
  publication.advance();
  for (const target of publication.pendingReceipts()) {
    yield* receiptor.receipt(target.issuer, { sn: target.anchorSn, allowTcp: true });
    publication.receipted(target);
  }
  for (const target of publication.pendingPublications()) {
    const hab = hby.habs.get(target.issuer);
    if (!hab) throw new ValidationError(`Missing local TEL issuer ${target.issuer}.`);
    const diger = publication.reger.tels.getOn(target.pre, target.sn)!;
    const message = publication.reger.cloneTvt(target.pre, diger);
    for (const witness of target.witnesses) {
      yield* sendWitnessMessage(hab, witness, message, http, clock, null);
    }
    publication.published(target);
  }
}
