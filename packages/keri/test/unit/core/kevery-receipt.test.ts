// @file-test-lane core-fast

import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { IdrDex, SerderKERI } from "../../../../cesr/mod.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { type KeverEventEnvelope, Kevery } from "../../../src/core/eventing.ts";

function eventEnvelope(args: {
  serder: SerderKERI;
  sigers: KeverEventEnvelope["sigers"];
}): KeverEventEnvelope {
  return {
    serder: args.serder,
    sigers: args.sigers,
    wigers: [],
    frcs: [],
    sscs: [],
    ssts: [],
    local: false,
  };
}

Deno.test("Kevery unescrows witness receipts against partially witnessed events", async () => {
  await run(function*() {
    const source = yield* createHabery({
      name: `kevery-rct-wit-src-${crypto.randomUUID()}`,
      temp: true,
    });
    const remote = yield* createHabery({
      name: `kevery-rct-wit-remote-${crypto.randomUUID()}`,
      temp: true,
    });

    try {
      const witness = source.makeHab("witness", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const controller = source.makeHab("controller", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const event = source.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      if (!event?.said) {
        throw new Error("Expected accepted controller event.");
      }

      const reactor = new Reactor(remote);
      const kvy = reactor.kevery;
      const decision = kvy.processEvent(eventEnvelope({
        serder: event,
        sigers: controller.sign(event.raw, true),
      }));
      assertEquals(decision.kind, "escrow");
      if (decision.kind !== "escrow") {
        throw new Error("Expected partial witness escrow.");
      }
      assertEquals(decision.reason, "partialWigs");

      reactor.ingest(witness.witness(event));
      reactor.processOnce();
      assertEquals(remote.db.uwes.cnt(), 1);

      kvy.processEscrowUnverWitness();
      const wigs = remote.db.wigs.get([controller.pre, event.said]);
      assertEquals(wigs.length, 1);
      assertEquals(wigs[0].code, IdrDex.Ed25519_Sig);
      kvy.processEscrowPartialWigs();
      assertEquals(remote.db.getState(controller.pre)?.i, controller.pre);
      assertEquals(remote.db.uwes.cnt(), 0);
    } finally {
      yield* remote.close(true);
      yield* source.close(true);
    }
  });
});
