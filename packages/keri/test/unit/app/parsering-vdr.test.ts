import { call, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  Diger,
  NumberPrimitive,
  Prefixer,
  SealEvent,
  SealSource,
  SerderACDC,
  type SerderKERI,
  Vrsn_1_0,
} from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { encodeHugeNumber } from "../../../src/app/keeping.ts";
import { type AcdcDispatchArgs, dispatchEnvelope, type TelDispatchArgs } from "../../../src/app/parsering.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { KeriDispatchEnvelope } from "../../../src/core/dispatch.ts";
import { Kevery } from "../../../src/core/eventing.ts";
import { incept } from "../../../src/core/protocol-vdr-eventing.ts";
import { Revery } from "../../../src/core/routing.ts";
import { protocolFixture } from "../../protocol-fixture.ts";

const ISSUER = "DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx";
const REGISTRY = "EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2";
const SCHEMA = "EMQWEcCnVRk1hatTNyK3sIykYSrrFvafX3bHQ9Gkk1kC";

Deno.test("dispatchEnvelope routes TEL events with the last source seal couple", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `vdr-tel-dispatch-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const revery = new Revery(hby.db);
      const kevery = new Kevery(hby.db, { rvy: revery });
      const calls: TelDispatchArgs[] = [];
      const tvy = runtime.vdr!.tvy;
      const processEvent = tvy.processEvent;
      tvy.processEvent = function(args) {
        calls.push(args as TelDispatchArgs);
        return processEvent.call(this, args);
      };
      const serder = incept(ISSUER, { baks: [], toad: 0 });
      const first = SealSource.fromTuple([
        new NumberPrimitive({ qb64: encodeHugeNumber(1) }),
        new Diger({ qb64: serder.said! }),
      ]);
      const second = SealSource.fromTuple([
        new NumberPrimitive({ qb64: encodeHugeNumber(3) }),
        new Diger({ qb64: serder.said! }),
      ]);

      yield* call(() =>
        dispatchEnvelope(
          new KeriDispatchEnvelope({
            serder,
            attachmentGroups: [],
            local: false,
            sscs: [first, second],
          }),
          revery,
          kevery,
          undefined,
          tvy,
        )
      );

      assertEquals(calls.length, 1);
      assertEquals(calls[0]!.serder.said, serder.said);
      assertEquals(calls[0]!.seqner?.numh, "3");
      assertEquals(calls[0]!.saider?.qb64, serder.said);
      assertEquals(calls[0]!.sscs.length, 2);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("dispatchEnvelope routes ACDC messages with the last source seal triple", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `vdr-acdc-dispatch-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const revery = new Revery(hby.db);
      const kevery = new Kevery(hby.db, { rvy: revery });
      const calls: AcdcDispatchArgs[] = [];
      const vry = runtime.vdr!.vry;
      const processACDC = vry.processACDC;
      vry.processACDC = function(args) {
        calls.push(args);
        return processACDC.call(this, args);
      };
      const serder = new SerderACDC({
        sad: {
          v: "ACDC10JSON000000_",
          d: "",
          i: ISSUER,
          ri: REGISTRY,
          s: SCHEMA,
          a: { d: "", i: ISSUER, role: "holder" },
        },
        pvrsn: Vrsn_1_0,
        kind: "JSON",
        makify: true,
      });
      const first = SealEvent.fromTuple([
        new Prefixer({ qb64: ISSUER }),
        new NumberPrimitive({ qb64: encodeHugeNumber(1) }),
        new Diger({ qb64: serder.said! }),
      ]);
      const second = SealEvent.fromTuple([
        new Prefixer({ qb64: ISSUER }),
        new NumberPrimitive({ qb64: encodeHugeNumber(5) }),
        new Diger({ qb64: serder.said! }),
      ]);

      yield* call(() =>
        dispatchEnvelope(
          new KeriDispatchEnvelope({
            serder: serder as unknown as SerderKERI,
            attachmentGroups: [],
            local: false,
            ssts: [first, second],
          }),
          revery,
          kevery,
          undefined,
          undefined,
          vry,
        )
      );

      assertEquals(calls.length, 1);
      assertEquals(calls[0]!.serder.said, serder.said);
      assertEquals(calls[0]!.prefixer?.qb64, ISSUER);
      assertEquals(calls[0]!.seqner?.numh, "5");
      assertEquals(calls[0]!.saider?.qb64, serder.said);
      assertEquals(calls[0]!.ssts.length, 2);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("Reactor runs injected TEL and verifier escrow turns", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `vdr-escrow-turn-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      let telEscrows = 0;
      let verifierEscrows = 0;
      const { tvy, vry } = runtime.vdr!;
      const telEscrow = tvy.processEscrows, verifierEscrow = vry.processEscrows;
      tvy.processEscrows = function() {
        telEscrows++;
        return telEscrow.call(this);
      };
      vry.processEscrows = function() {
        verifierEscrows++;
        return verifierEscrow.call(this);
      };
      const reactor = new Reactor(protocolFixture(hby, {
        tevery: tvy,
        verifier: vry,
        cues: runtime.cues,
        protocolCues: runtime.vdr!.cues,
      }));

      assertEquals(yield* reactor.protocol.processEscrowsOnce(), false);
      assertEquals(telEscrows, 1);
      assertEquals(verifierEscrows, 1);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
