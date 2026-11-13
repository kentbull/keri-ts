/** Finite legacy TEL receipt collection and witness publication; no delivery acknowledgement is inferred. */
import type { Operation } from "effection";
import { ValidationError } from "../../core/errors.ts";
import type { TelPublication } from "../../vdr/tel-publication.ts";
import type { Habery } from "../identity/habbing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import type { HttpClient } from "../transport/http-client.ts";
import { deliverWitnessMessage } from "../witness/receipt-client.ts";
import { type Receiptor } from "../witness/receipting.ts";

/**
 * Advance one captured set of protocol escrows. Receipt collection includes
 * fanout; a crash before its commit repeats that ordinary finite operation.
 * Dissemination replays accepted TEL evidence to the anchor's historical witness
 * cohort and commits ctel only after every local transmission finished. A witness
 * that is unreachable, refuses or does not receipt ends only that target: its
 * escrow is retained and the next pass retries it, without an outbox. Local faults
 * (missing issuer Hab, storage) still throw.
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
    const outcome = yield* receiptor.attempt(target.issuer, { sn: target.anchorSn, allowTcp: true });
    if (outcome.kind === "receipted") publication.receipted(target);
  }
  for (const target of publication.pendingPublications()) {
    const hab = hby.habs.get(target.issuer);
    if (!hab) throw new ValidationError(`Missing local TEL issuer ${target.issuer}.`);
    const diger = publication.reger.tels.getOn(target.pre, target.sn)!;
    const message = publication.reger.cloneTvt(target.pre, diger);
    let delivered = true;
    for (const witness of target.witnesses) {
      const delivery = yield* deliverWitnessMessage(hab, witness, message, http, clock, null);
      if (delivery.kind === "unreachable") {
        delivered = false;
        break;
      }
    }
    if (delivered) publication.published(target);
  }
}
