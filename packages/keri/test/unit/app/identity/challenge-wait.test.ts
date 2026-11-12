import { Diger } from "cesr-ts";
import { run, sleep, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createExchangeMessage } from "../../../../src/app/exchanges/exchange-messaging.ts";
import {
  CHALLENGE_RESPONSE_ROUTE,
  type ChallengeStatus,
  challengeStatus,
  markChallengeVerified,
  respondToChallenge,
  waitForChallengeResponse,
} from "../../../../src/app/identity/challenging.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";

const words = ["bake", "cole", "dino"];

function open() {
  return createHabery({ name: `challenge-${crypto.randomUUID()}`, temp: true, skipConfig: true });
}

/** Store a response from `hab` as the challenge handler does after exchange intake. */
function accept(hby: Habery, hab: Hab, body: string[]): string {
  const { serder } = createExchangeMessage(hab, {
    dest: "ERecipient",
    route: CHALLENGE_RESPONSE_ROUTE,
    payload: { i: hab.pre, words: body },
  });
  hby.db.exns.pin([serder.said!], serder);
  hby.db.reps.add([hab.pre], new Diger({ qb64: serder.said! }));
  return serder.said!;
}

Deno.test("challenge status moves from waiting to received to verified, keyed on words and signer", async () => {
  await run(function*() {
    const hby = yield* open();
    try {
      const signerHab = hby.makeHab("signer", undefined, {});
      const otherHab = hby.makeHab("other", undefined, {});
      const signer = signerHab.pre;
      assertEquals(challengeStatus(hby, signer, words), { state: "waiting" });
      accept(hby, signerHab, ["other"]);
      assertEquals(challengeStatus(hby, signer, words), { state: "waiting" });
      accept(hby, otherHab, words);
      assertEquals(challengeStatus(hby, signer, words), { state: "waiting" });
      const said = accept(hby, signerHab, words);
      const received = challengeStatus(hby, signer, words) as Extract<ChallengeStatus, { response: unknown }>;
      assertEquals([received.state, received.response.said], ["received", said]);
      markChallengeVerified(hby.db, signer, received.response);
      markChallengeVerified(hby.db, signer, received.response);
      assertEquals(challengeStatus(hby, signer, words).state, "verified");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("an expired challenge wait is a value; an arriving response settles it without workers", async () => {
  await run(function*() {
    const hby = yield* open();
    try {
      const signerHab = hby.makeHab("signer", undefined, {});
      const signer = signerHab.pre;
      const expired = yield* waitForChallengeResponse(hby, signer, words, { timeoutMs: 30, pollMs: 5 });
      assertEquals(expired, { outcome: "timed-out", status: { state: "waiting" }, timeoutMs: 30 });

      // Only `db` is declared; touching anything else fails the test.
      const strict = new Proxy({ db: hby.db }, {
        get(target, prop, receiver) {
          if (prop !== "db") throw new Error(`unexpected access: ${String(prop)}`);
          return Reflect.get(target, prop, receiver);
        },
      });
      yield* spawn(function*() {
        yield* sleep(20);
        accept(hby, signerHab, words);
      });
      const settled = yield* waitForChallengeResponse(strict, signer, words, { timeoutMs: 5_000, pollMs: 5 });
      assertEquals([settled.outcome, settled.status.state], ["settled", "received"]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("respondToChallenge refuses empty words before sending anything", async () => {
  await run(function*() {
    const hby = yield* open();
    try {
      const hab: Hab = hby.makeHab("responder", undefined, {});
      const http = {
        request() {
          throw new Error("nothing may be sent");
        },
      };
      let failure = "";
      try {
        yield* respondToChallenge({ hby, http: http as never, clock: systemClock }, hab, "ERecipient", []);
      } catch (error) {
        failure = String(error);
      }
      assertEquals(failure.includes("must not be empty"), true);
    } finally {
      yield* hby.close(true);
    }
  });
});
