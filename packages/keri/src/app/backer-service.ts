/** Hosted TEL receipt production and handoff to the ordinary transport owner. */
import type { Operation } from "effection";
import type { Deck } from "../core/deck.ts";
import { consoleLogger } from "../core/logger.ts";
import { RECEIPT_MAILBOX_TOPIC } from "../core/mailbox-topics.ts";
import { Roles } from "../core/roles.ts";
import type { Backer, BackerRequest } from "../vdr/backing.ts";
import type { Poster } from "./forwarding.ts";
import { runtimeTurn } from "./runtime-turn.ts";

/** One selected signer consumes its own endorsement requests; Poster alone owns network execution. */
export class BackerService {
  /** Compose protocol endorsement, its private flow and the existing sender with explicit dependencies. */
  constructor(readonly backer: Backer, readonly requests: Deck<BackerRequest>, readonly postman: Poster) {}

  /** Persist one initial batch and publish concrete receipt transmissions after each successful commit. */
  processOnce(): void {
    const count = this.requests.length;
    for (let index = 0; index < count; index++) {
      const request = this.requests.peekHead();
      if (!request) break;
      const result = this.backer.endorse(request);
      if (result.kind === "reject") {
        consoleLogger.warn("TEL backer refused endorsement", {
          pre: request.pre,
          said: request.said,
          reason: result.reason,
        });
      } else if (result.kind === "contribution") {
        const ends = this.backer.hab.endsFor(result.issuer);
        if (!Object.keys(ends[Roles.controller] ?? {}).length && !Object.keys(ends[Roles.agent] ?? {}).length) {
          consoleLogger.warn("TEL backer receipt has no signed issuer controller or agent endpoint", {
            issuer: result.issuer,
            said: request.said,
          });
        } else {
          // First-present-role delivery uses the accepted issuer binding, never a request-supplied URL.
          this.postman.sendStream({
            src: this.backer.hab.pre,
            dest: result.issuer,
            topic: RECEIPT_MAILBOX_TOPIC,
            msgs: [result.message],
            replies: true,
          });
        }
      }
      this.requests.pull();
    }
  }

  /** Supervised host work; no retry timer, durable outbox or delivery-success claim. */
  *run(): Operation<never> {
    while (true) {
      this.processOnce();
      yield* runtimeTurn();
    }
  }
}
