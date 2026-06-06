// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { Diger, Prefixer } from "../../../../cesr/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { loadChallengeHandlers } from "../../../src/app/challenging.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange as exchangeMessage } from "../../../src/core/protocol-exchanging.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";

function makeExchangeSerder(
  route: string,
  payload: Record<string, unknown>,
  args: Parameters<typeof exchangeMessage>[2],
) {
  return exchangeMessage(route, payload, args)[0];
}

Deno.test("exchange mirrors KERIpy v1 recipient projection rules and changes SAIDs accordingly", () => {
  const recipient = "EBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const sender = "EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  const withRecipient = exchangeMessage(
    "/test",
    { words: ["able", "baker"] },
    {
      sender,
      recipient,
      stamp: "2026-04-10T00:00:00.000000+00:00",
    },
  )[0];
  const withoutRecipient = exchangeMessage(
    "/test",
    { words: ["able", "baker"] },
    {
      sender,
      stamp: "2026-04-10T00:00:00.000000+00:00",
    },
  )[0];

  assertEquals(withRecipient.ked?.rp, recipient);
  assertEquals(
    Object.keys(withRecipient.ked ?? {}),
    ["v", "t", "d", "i", "rp", "p", "dt", "r", "q", "a", "e"],
  );
  assertEquals(
    Object.keys((withRecipient.ked?.a as Record<string, unknown>) ?? {}),
    ["i", "words"],
  );
  assertEquals(
    (withRecipient.ked?.a as Record<string, unknown>)["i"],
    recipient,
  );
  assertEquals(withoutRecipient.ked?.rp, "");
  assertEquals(
    Object.keys(withoutRecipient.ked ?? {}),
    ["v", "t", "d", "i", "rp", "p", "dt", "r", "q", "a", "e"],
  );
  assertEquals(
    Object.keys((withoutRecipient.ked?.a as Record<string, unknown>) ?? {}),
    ["words"],
  );
  assertEquals(
    (withoutRecipient.ked?.a as Record<string, unknown>)["i"],
    undefined,
  );
  assertEquals(withRecipient.said === withoutRecipient.said, false);
});

Deno.test("Exchanger accepts signed challenge responses and records exchange state", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `exchange-accept-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, sender.makeLocScheme("http://127.0.0.1:9001"));
      ingestKeriBytes(
        runtime,
        sender.makeEndRole(sender.pre, EndpointRoles.controller, true),
      );
      ingestKeriBytes(
        runtime,
        recipient.makeLocScheme("http://127.0.0.1:9002"),
      );
      ingestKeriBytes(
        runtime,
        recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab: sender });

      const exchanger = new Exchanger(hby);
      loadChallengeHandlers(hby.db, exchanger);
      const serder = makeExchangeSerder(
        "/challenge/response",
        { i: sender.pre, words: ["baba", "coco"] },
        { sender: sender.pre, recipient: recipient.pre },
      );
      const sigers = sender.sign(serder.raw, true);
      const decision = exchanger.processEvent({
        serder,
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: sender.pre }),
            sender.kever!.sner,
            new Diger({ qb64: sender.kever!.said }),
            sigers,
          ),
        ],
      });

      const said = serder.said;
      assertExists(said);
      assertEquals(decision.kind, "accept");
      assertEquals(hby.db.exns.get([said])?.said, said);
      assertEquals(
        hby.db.reps.get([sender.pre]).some((diger) => diger.qb64 === said),
        true,
      );
      assertEquals(
        [...hby.db.esigs.getTopItemIter([said, ""])].length > 0,
        true,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Exchanger replays partial-signature escrows once the missing signatures arrive", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `exchange-escrow-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 2,
        isith: "2",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const recipient = hby.makeHab("recipient", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, sender.makeLocScheme("http://127.0.0.1:9011"));
      ingestKeriBytes(
        runtime,
        sender.makeEndRole(sender.pre, EndpointRoles.controller, true),
      );
      ingestKeriBytes(
        runtime,
        recipient.makeLocScheme("http://127.0.0.1:9012"),
      );
      ingestKeriBytes(
        runtime,
        recipient.makeEndRole(recipient.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab: sender });

      const exchanger = new Exchanger(hby);
      loadChallengeHandlers(hby.db, exchanger);
      const serder = makeExchangeSerder(
        "/challenge/response",
        { i: sender.pre, words: ["dede", "fifi"] },
        { sender: sender.pre, recipient: recipient.pre },
      );
      const sigers = sender.sign(serder.raw, true);
      const group = new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sigers,
      );

      const initial = exchanger.processEvent({
        serder,
        tsgs: [
          new TransIdxSigGroup(group.prefixer, group.seqner, group.diger, [
            sigers[0],
          ]),
        ],
      });
      const said = serder.said;
      assertExists(said);
      assertEquals(initial.kind, "escrow");
      assertExists(hby.db.epse.get([said]));

      const quadKey = [said, group.pre, group.snh, group.said] as const;
      hby.db.esigs.add(quadKey, sigers[1]);
      exchanger.processEscrows();

      assertEquals(hby.db.epse.get([said]), null);
      assertEquals(hby.db.exns.get([said])?.said, said);
      assertEquals(
        hby.db.reps.get([sender.pre]).some((diger) => diger.qb64 === said),
        true,
      );
    } finally {
      yield* hby.close(true);
    }
  });
});
