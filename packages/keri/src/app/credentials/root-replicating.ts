/** Finite delivery of prepared `/registry/root` copies; transmission is never receipt. */
import type { Operation } from "effection";
import { CREDENTIAL_MAILBOX_TOPIC } from "../../core/mailbox/mailbox-topics.ts";
import type { Poster } from "../delivery/forwarding.ts";

/** One signed ESSR copy already authorized and prepared by `RegistryRoot.prepare`. */
export interface RootCopy {
  recipient: string;
  wire: Uint8Array;
}

/** Local Poster attempt result for one copy; `sent` means transmitted, not received or retained. */
export type RootDelivery<C extends RootCopy = RootCopy> =
  | { kin: "sent"; copy: C; deliveries: string[] }
  | { kin: "failed"; copy: C; error: unknown };

/**
 * Send each copy from `sender` to its recipient's `credential` mailbox, in
 * order, and return one outcome per copy. A failed copy does not stop later
 * copies. The caller runs `postman.deliverDo` for the duration; Poster wait
 * misuse or closure still throws.
 */
export function* deliverRegistryRoots<C extends RootCopy>(
  postman: Poster,
  sender: string,
  copies: readonly C[],
): Operation<RootDelivery<C>[]> {
  const outcomes: RootDelivery<C>[] = [];
  for (const copy of copies) {
    const event = postman.send(
      { src: sender, dest: copy.recipient, topic: CREDENTIAL_MAILBOX_TOPIC, msg: copy.wire },
      { notify: true },
    );
    const outcome = yield* postman.wait(event);
    outcomes.push(
      outcome.kin === "sent"
        ? { kin: "sent", copy, deliveries: outcome.deliveries }
        : { kin: "failed", copy, error: outcome.error },
    );
  }
  return outcomes;
}
