import { Organizer } from "../identity/organizing.ts";
/** Construct signed exchanges in their producer and run standalone queued sends. */
import { concatBytes, type SerderKERI } from "cesr-ts";
import { call, type Operation, resource, spawn } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { exchange } from "../../core/protocol-exchanging.ts";
import { mailboxTopicForRoute, Poster } from "../delivery/forwarding.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import type { HttpClient } from "../transport/http-client.ts";

/** Resolved recipient and business fields used to construct one signed exchange. */
export interface ExchangeMessageArgs {
  /**
   * Resolved final recipient AID; standalone sending may resolve a user alias first.
   */
  dest: string;
  /**
   * EXN route interpreted by the receiving application.
   */
  route: string;
  /**
   * Route-defined signed business attributes; this is wire schema data, not a dependency bag.
   */
  payload: Record<string, unknown>;
  /** Omit the business recipient for KERIpy delegation-request exchanges. */
  exchangeRecipient?: string | null;
  /**
   * Optional route-defined signed query modifiers.
   */
  modifiers?: Record<string, unknown>;
  /**
   * Optional protocol timestamp; omission uses exchange construction defaults.
   */
  date?: string;
  /**
   * Optional prior exchange SAID for conversation correlation.
   */
  dig?: string;
  /**
   * Named independently signed/framed CESR messages to embed.
   */
  embeds?: Record<string, Uint8Array>;
}

/**
 * Sign the producer's exchange once, including any independently framed embedded material.
 *
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param args Resolved recipient, route and business fields; optional embeds carry independently framed wire.
 * @returns Signed EXN body plus complete message bytes; this performs no delivery.
 */
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

/**
 * Run a standalone command's Poster and await actual delivery before closing its worker.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param hab Local signing habitat; its state/store lifetime remains with the caller.
 * @param http Borrowed HTTP implementation selected by composition.
 * @param clock Borrowed clock with epoch-millisecond now and millisecond timer delays.
 * @param args Exchange fields plus optional mailbox topic; recipient aliases are resolved before signing.
 * @returns Signed EXN and successfully delivered target URLs after the worker/Poster scope joins.
 * @throws A failed terminal outcome is thrown; admission alone never returns success.
 */
export function sendExchangeMessage(
  hby: Habery,
  hab: Hab,
  http: HttpClient,
  clock: RuntimeClock,
  args: ExchangeMessageArgs & { topic?: string },
): Operation<{ serder: SerderKERI; deliveries: string[] }> {
  return call(function*() {
    const postman = new Poster(hby, null, null, http, clock);
    yield* resource<void>(function*(provide) {
      try {
        yield* provide();
      } finally {
        yield* postman.close();
      }
    });
    const dest = new Organizer(hby.db, hby.signator).resolveRecipient(args.dest);
    const topic = args.topic ?? mailboxTopicForRoute(args.route);
    if (!topic) throw new ValidationError(`Unable to derive mailbox topic from route ${args.route}.`);
    const { serder, msg } = createExchangeMessage(hab, { ...args, dest });
    yield* spawn(() => postman.deliverDo());
    const evt = postman.send({ src: hab.pre, dest, topic, msg }, { notify: true });
    const outcome = yield* postman.wait(evt);
    if (outcome.kin === "failed") throw outcome.error;
    return { serder, deliveries: outcome.deliveries };
  });
}
