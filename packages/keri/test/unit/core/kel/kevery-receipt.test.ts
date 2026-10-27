import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { IdrDex, SerderKERI } from "../../../../../cesr/mod.ts";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { type KeverEventEnvelope, Kevery } from "../../../../src/core/kel/eventing.ts";
import { interact, receipt } from "../../../../src/core/protocol-eventing.ts";
import { protocolFixture } from "../../../protocol-fixture.ts";

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

      const reactor = new Reactor(protocolFixture(remote));
      const kvy = reactor.kvy;
      const decision = kvy.processEvent(eventEnvelope({
        serder: event,
        sigers: controller.sign(event.raw, true),
      }));
      assertEquals(decision.kind, "escrow");
      if (decision.kind !== "escrow") {
        throw new Error("Expected partial witness escrow.");
      }
      assertEquals(decision.reason, "partialWigs");

      yield* reactor.processBytes(witness.witness(event));

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

Deno.test("historical interaction receipts use their establishment witness cohort, including an empty cohort", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const provider = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const before = provider.makeHab("before", undefined, { transferable: false });
      const after = provider.makeHab("after", undefined, { transferable: false });
      const controller = source.makeHab("controller", undefined, { wits: [before.pre], toad: 1 });
      controller.interact();
      const witnessed = controller.kever!.serder;
      controller.rotate({ cuts: [before.pre], toad: 0 });
      controller.interact();
      const empty = controller.kever!.serder;
      controller.rotate({ adds: [after.pre], toad: 1 });
      const reactor = new Reactor(protocolFixture(source));
      for (const event of [witnessed, empty]) {
        yield* reactor.processBytes(after.receipt(event));
        const key = [controller.pre, event.said!];
        assertEquals(source.db.wigs.get(key), [], "a later witness is only an ordinary receiptor of this event");
        assertEquals(source.db.rcts.get(key).map(([pre]) => pre.qb64), [after.pre]);
      }
      yield* reactor.processBytes(before.receipt(witnessed));
      assertEquals(source.db.wigs.get([controller.pre, witnessed.said!]).map((sig) => sig.index), [0]);
      assertEquals(source.db.wigs.get([controller.pre, empty.said!]), []);
    } finally {
      yield* provider.close(true);
      yield* source.close(true);
    }
  });
});

Deno.test("partial controller escrow cannot supply unverified witness quorum after local acceptance", async () => {
  await run(function*() {
    const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const provider = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      const witness = provider.makeHab("witness", undefined, { transferable: false });
      const controller = source.makeHab("controller", undefined, {
        icount: 2,
        isith: "2",
        wits: [witness.pre],
        toad: 1,
      });
      const inception = controller.kever!.serder;
      const event = interact(controller.pre, inception.said!, 1);
      const signatures = controller.sign(event.raw, true);
      const stale = witness.sign(inception.raw, true)[0];
      const partial = source.kevery.processEvent({
        ...eventEnvelope({ serder: event, sigers: signatures.slice(0, 1) }),
        wigers: [stale],
        local: true,
      });
      assertEquals(partial.kind === "escrow" ? partial.reason : null, "partialSigs");
      const key = [controller.pre, event.said!];
      assertEquals(source.db.pses.getOn(controller.pre, 1), [event.said]);
      assertEquals(source.db.wigs.get(key).map((sig) => sig.qb64), [stale.qb64]);
      assertEquals(source.db.fullyWitnessed(event), false, "unaccepted escrow evidence has no quorum authority");

      const accepted = source.kevery.processEvent({
        ...eventEnvelope({ serder: event, sigers: signatures }),
        local: true,
      });
      assertEquals(accepted.kind, "accept");
      assertEquals(source.db.getKever(controller.pre)!.said, event.said);
      assertEquals(source.db.wigs.get(key).map((sig) => sig.qb64), [stale.qb64]);
      assertEquals(source.db.fullyWitnessed(event), false, "a wrong-event escrowed signature is not a receipt");

      source.kevery.processReceipt({
        serder: receipt(controller.pre, 1, event.said!),
        cigars: witness.sign(event.raw, false),
        wigers: [],
        tsgs: [],
        local: false,
      });
      assertEquals(source.db.wigs.get(key).map((sig) => sig.index), [0, 0]);
      assertEquals(source.db.fullyWitnessed(event), true, "a valid signature at the same index must still count");
    } finally {
      yield* provider.close(true);
      yield* source.close(true);
    }
  });
});
