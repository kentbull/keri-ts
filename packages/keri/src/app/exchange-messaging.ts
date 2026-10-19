/** Construct signed exchanges in their producer and run standalone queued sends. */
import { concatBytes, type SerderKERI } from "cesr-ts";
import { call, type Operation, resource, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../core/errors.ts";
import { exchange } from "../core/protocol-exchanging.ts";
import { type ExchangeDeliveryPreference, mailboxTopicForRoute, Poster } from "./forwarding.ts";
import type { Hab, Habery } from "./habbing.ts";

/** Resolved recipient and business fields used to construct one signed exchange. */
export interface ExchangeMessageArgs {
  dest: string;
  route: string;
  payload: Record<string, unknown>;
  /** Omit the business recipient for KERIpy delegation-request exchanges. */
  exchangeRecipient?: string | null;
  modifiers?: Record<string, unknown>;
  date?: string;
  dig?: string;
  embeds?: Record<string, Uint8Array>;
}

/** Sign the producer's exchange once, including any independently framed embedded material. */
export function createExchangeMessage(
  hab: Hab,
  args: ExchangeMessageArgs,
): { serder: SerderKERI; msg: Uint8Array } {
  const embeds = args.embeds ?? {};
  const [serder, attachments] = exchange(args.route, args.payload, {
    sender: hab.pre,
    recipient: args.exchangeRecipient === null ? undefined : args.exchangeRecipient ?? args.dest,
    modifiers: args.modifiers,
    stamp: args.date,
    dig: args.dig,
    embeds: Object.keys(embeds).length > 0 ? embeds : undefined,
  });
  return { serder, msg: concatBytes(hab.endorse(serder, { pipelined: false }), attachments) };
}

/** Run a standalone command's Poster and await actual delivery before closing its worker. */
export function sendExchangeMessage(
  hby: Habery,
  hab: Hab,
  args: ExchangeMessageArgs & { topic?: string; delivery?: ExchangeDeliveryPreference },
): Operation<{ serder: SerderKERI; deliveries: string[] }> {
  return call(function*() {
    const postman = new Poster(hby);
    yield* resource<void>(function*(provide) {
      try {
        yield* provide();
      } finally {
        yield* postman.close();
      }
    });
    const dest = postman.resolveRecipient(args.dest);
    const topic = args.topic ?? mailboxTopicForRoute(args.route);
    if (!topic) throw new ValidationError(`Unable to derive mailbox topic from route ${args.route}.`);
    const { serder, msg } = createExchangeMessage(hab, { ...args, dest });
    yield* spawn(() => postman.deliverDo());
    const evt = postman.send({ src: hab.pre, dest, topic, msg, delivery: args.delivery }, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    return { serder, deliveries: outcome.deliveries };
  });
}
