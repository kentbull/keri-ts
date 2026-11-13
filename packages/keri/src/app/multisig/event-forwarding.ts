/**
 * Forwarding of a completed group event to the other signing members.
 *
 * The member whose signature index elected it for the witness duty also owes the finished event to members that
 * never saw the signatures that completed it. It sends the accepted event with its signatures and receipts as a
 * replay, which a member takes through ordinary intake, on the `/replay` topic a mailbox member polls.
 */
import type { Operation } from "npm:effection@^3.6.0";
import type { Poster } from "../delivery/forwarding.ts";
import { acceptedEventReplayMessage, type Habery } from "../identity/habbing.ts";
import type { GroupEventRef, GroupForwarding } from "./counseling.ts";
import { localGroupMember } from "./group-members.ts";
import { failedGroupDelivery, type GroupDelivery } from "./multisig-messaging.ts";

/** The Counselor's forwarding port over a Habery and its Poster; the Poster's delivery worker must run. */
export function groupEventForwarding(hby: Habery, postman: Poster): GroupForwarding {
  return {
    *forward(event: GroupEventRef, members: readonly string[]): Operation<GroupDelivery[]> {
      const { serder } = acceptedEventReplayMessage(hby, event.pre, event.sn);
      const { message } = acceptedEventReplayMessage(hby, event.pre, event.sn, serder.pvrsn);
      const sender = localGroupMember(hby, event.pre);
      const outcomes: GroupDelivery[] = [];
      for (const recipient of members) {
        const ref = { recipient, exnSaid: event.said, payloadSaid: event.said };
        try {
          const outcome = yield* postman.wait(
            postman.send({ src: sender.pre!, dest: recipient, topic: "/replay", msg: message }, { notify: true }),
          );
          outcomes.push(
            outcome.kin === "failed"
              ? failedGroupDelivery(ref, outcome.error)
              : { ...ref, outcome: "delivered", deliveries: [...outcome.deliveries] },
          );
        } catch (error) {
          outcomes.push(failedGroupDelivery(ref, error));
        }
      }
      return outcomes;
    },
  };
}
