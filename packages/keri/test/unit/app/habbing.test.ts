// @file-test-lane app-stateful-a

import { run } from "effection";
import {
  assertEquals,
  assertExists,
  assertInstanceOf,
  assertNotEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "jsr:@std/assert";
import { Cigar, Counter, CtrDexV1, SerderKERI, Siger, smell, Verfer } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createConfiger } from "../../../src/app/configing.ts";
import { createHabery, SIGNER } from "../../../src/app/habbing.ts";
import * as parsering from "../../../src/app/parsering.ts";
import { makeExchangeSerder } from "../../../src/core/messages.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

Deno.test("Hab.rotate reuses one Habery for success and rollback coverage", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-rotate-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const acceptedHab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const priorKey = acceptedHab.kever?.verfers[0]?.qb64 ?? "";
      const priorSaid = acceptedHab.kever?.said ?? "";

      const msg = acceptedHab.rotate({ ncount: 1, nsith: "1" });
      const nextState = hby.db.getState(acceptedHab.pre);
      const nextKever = acceptedHab.kever;

      assertEquals(nextKever?.sn, 1);
      assertEquals(nextState?.s, "1");
      assertNotEquals(nextState?.d, priorSaid);
      assertNotEquals(nextState?.k?.[0], priorKey);
      assertEquals(hby.db.kels.getLast(acceptedHab.pre, 1), nextState?.d);
      assertEquals(hby.db.getFel(acceptedHab.pre, 1), nextState?.d);
      assertEquals(msg.length > 0, true);

      const rollbackHab = hby.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const before = hby.ks.getSits(rollbackHab.pre);

      try {
        rollbackHab.rotate({ isith: "2", ncount: 1, nsith: "1" });
        throw new Error("Expected invalid rotation to throw.");
      } catch (error) {
        assertEquals(
          error instanceof Error ? error.message : String(error),
          "Invalid current threshold for 1 keys.",
        );
      }

      const after = hby.ks.getSits(rollbackHab.pre);
      assertEquals(after?.old.pubs, before?.old.pubs);
      assertEquals(after?.new.pubs, before?.new.pubs);
      assertEquals(after?.nxt.pubs, before?.nxt.pubs);
      assertEquals(rollbackHab.kever?.sn, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Hab.interact advances accepted state, preserves keys, and commits anchor data", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-interact-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const acceptedHab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const priorKey = acceptedHab.kever?.verfers[0]?.qb64 ?? "";
      const priorSaid = acceptedHab.kever?.said ?? "";
      const committed = [
        {
          i: acceptedHab.pre,
          s: "0",
          d: priorSaid,
        },
      ];

      const msg = acceptedHab.interact({ data: committed });
      const nextState = hby.db.getState(acceptedHab.pre);
      const nextKever = acceptedHab.kever;
      const event = nextState?.d
        ? hby.db.getEvtSerder(acceptedHab.pre, nextState.d)
        : null;

      assertEquals(nextKever?.sn, 1);
      assertEquals(nextState?.s, "1");
      assertNotEquals(nextState?.d, priorSaid);
      assertEquals(nextState?.k?.[0], priorKey);
      assertEquals(hby.db.kels.getLast(acceptedHab.pre, 1), nextState?.d);
      assertEquals(hby.db.getFel(acceptedHab.pre, 1), nextState?.d);
      if (!event) {
        throw new Error("Expected stored interaction event serder.");
      }
      assertInstanceOf(event, SerderKERI);
      assertEquals(event.ked?.["a"], committed);
      assertEquals(msg.length > 0, true);

      const estOnlyHab = hby.makeHab("est-only", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        estOnly: true,
      });
      assertThrows(
        () => estOnlyHab.interact(),
        Error,
        "was not accepted",
      );
      assertEquals(estOnlyHab.kever?.sn, 0);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Hab.interact preserves hex-width boundaries across successive accepted events", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `habery-interact-hex-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const acceptedHab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      for (let step = 1; step <= 256; step += 1) {
        const msg = acceptedHab.interact({ data: [{ step }] });
        assertEquals(msg.length > 0, true);
      }

      const finalState = hby.db.getState(acceptedHab.pre);
      assertEquals(acceptedHab.kever?.sn, 256);
      assertEquals(finalState?.s, "100");

      for (
        const [sn, expectedHex] of [
          [15, "f"],
          [16, "10"],
          [255, "ff"],
          [256, "100"],
        ] as const
      ) {
        const said = hby.db.kels.getLast(acceptedHab.pre, sn);
        assertExists(said);
        assertEquals(hby.db.getFel(acceptedHab.pre, sn), said);

        const event = hby.db.getEvtSerder(acceptedHab.pre, said);
        assertExists(event);
        assertInstanceOf(event, SerderKERI);
        assertEquals(event.ked?.["s"], expectedHex);

        if (sn === 256) {
          assertEquals(event.ked?.["a"], [{ step: 256 }]);
        }
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Habery eagerly loads persisted habitats on open", async () => {
  const name = `habery-load-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const alias = "alice";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      assertEquals(hby.habs.get(hab.pre)?.name, alias);
      const storedHab = hby.db.getHab(hab.pre);
      assertEquals(storedHab?.hid, hab.pre);
      assertEquals(storedHab?.name, alias);
      assertEquals(storedHab ? "sigs" in storedHab : false, false);
      const state = hby.db.getState(hab.pre);
      assertEquals(state?.i, hab.pre);
      assertEquals(state?.k, hab.kever?.verfers.map((verfer) => verfer.qb64));
      assertEquals(hby.db.kels.getLast(hab.pre, 0), state?.d);
      assertEquals(hby.db.getFel(hab.pre, 0), state?.d);
      assertEquals(hab.accepted, true);
      assertEquals(hby.db.getKever(hab.pre)?.pre, hab.pre);
      assertEquals(hby.prefixes.includes(hab.pre), true);
      assertStrictEquals(hab.kevery, hby.kevery);

      const evt = state?.d ? hby.db.getEvt(dgKey(hab.pre, state.d)) : null;
      const evtText = evt ? new TextDecoder().decode(evt) : "";
      const match = evtText.match(/"d":"([^"]+)"/);
      if (!match) {
        throw new Error("Expected inception event SAID in stored event.");
      }
      const said = match[1];
      assertEquals(hab.pre, said);
      assertEquals(hby.db.getSigs(hab.pre, said).length, 1);
      if (!evt) {
        throw new Error("Expected stored inception event bytes.");
      }
      assertEquals(smell(evt).smellage.size, evt.length);
      const evtSerder = hby.db.getEvtSerder(hab.pre, said);
      assertEquals(evtSerder instanceof SerderKERI, true);
      assertEquals(evtSerder?.pre, hab.pre);
      assertEquals(evtSerder?.said, said);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      assertEquals(hby.habs.size, 1);
      const hab = [...hby.habs.values()][0];
      assertEquals(hab?.name, alias);
      assertEquals(hby.habByName(alias)?.pre, hab?.pre);
      assertEquals(hab?.kever?.pre, hab?.pre);
      assertEquals(hab?.accepted, true);
      assertEquals(hby.prefixes.includes(hab?.pre ?? ""), true);
      assertStrictEquals(hab?.kevery, hby.kevery);
      const storedHab = hab ? hby.db.getHab(hab.pre) : null;
      assertEquals(storedHab?.hid, hab?.pre);
      assertEquals(storedHab?.name, alias);
      assertEquals(storedHab ? "sigs" in storedHab : false, false);
      const state = hab ? hby.db.getState(hab.pre) : null;
      assertEquals(state?.i, hab?.pre);
      assertEquals(state?.k, hab?.kever?.verfers.map((verfer) => verfer.qb64));
      assertEquals(
        hab ? hby.db.getKever(hab.pre)?.pre : null,
        hab?.pre ?? null,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery keeps a local kevery separate from runtime-owned kevery cues", async () => {
  const name = `habery-local-kevery-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipSignator: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });

      assertStrictEquals(hab.kevery, hby.kevery);
      assertStrictEquals(hby.kevery.local, true);
      assertStrictEquals(hby.kevery.lax, false);
      assertStrictEquals(runtime.reactor.kevery.cues, runtime.cues);
      assertEquals(runtime.reactor.kevery === hby.kevery, false);
      assertEquals(runtime.cues === hby.kevery.cues, false);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery reconfigure preserves top-level OOBI preload queues", async () => {
  const name = `habery-config-oobi-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    cf.put({
      dt: "2026-04-06T12:00:00.000Z",
      iurls: ["http://127.0.0.1:7001/oobi/i"],
      durls: ["http://127.0.0.1:7001/oobi/d"],
      wurls: ["http://127.0.0.1:7001/.well-known/keri/oobi/w"],
    });

    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
    });
    try {
      assertEquals(hby.db.oobis.cnt(), 2);
      assertEquals(hby.db.woobi.cnt(), 1);
      assertEquals(
        hby.db.oobis.get("http://127.0.0.1:7001/oobi/i")?.state,
        "queued",
      );
      assertEquals(
        hby.db.oobis.get("http://127.0.0.1:7001/oobi/d")?.state,
        "queued",
      );
      assertEquals(
        hby.db.woobi.get("http://127.0.0.1:7001/.well-known/keri/oobi/w")
          ?.state,
        "queued",
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab reconfigure applies alias-scoped controller curls through reply acceptance", async () => {
  const name = `habery-config-curls-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const url = "http://127.0.0.1:7002/controller";

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    cf.put({
      alice: {
        dt: "2026-04-06T12:30:00.000Z",
        curls: [url],
      },
    });

    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      assertEquals(
        hby.db.ends.get([hab.pre, "controller", hab.pre])?.allowed,
        true,
      );
      assertEquals(hby.db.locs.get([hab.pre, "http"])?.url, url);
      assertEquals(hab.fetchUrls(hab.pre, "http").http, url);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery reconfigure reapplies alias-scoped controller curls idempotently on reopen", async () => {
  const name = `habery-config-reopen-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const url = "http://127.0.0.1:7003/controller";
  let pre = "";
  let endSaid = "";
  let locSaid = "";

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    cf.put({
      alice: {
        dt: "2026-04-06T13:00:00.000Z",
        curls: [url],
      },
    });

    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      endSaid = hby.db.eans.get([pre, "controller", pre])?.qb64 ?? "";
      locSaid = hby.db.lans.get([pre, "http"])?.qb64 ?? "";
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
    });
    try {
      assertEquals(hby.db.ends.get([pre, "controller", pre])?.allowed, true);
      assertEquals(hby.db.locs.get([pre, "http"])?.url, url);
      assertEquals(hby.db.eans.get([pre, "controller", pre])?.qb64, endSaid);
      assertEquals(hby.db.lans.get([pre, "http"])?.qb64, locSaid);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab receives KERIpy-style config and local routing seams from Habery", async () => {
  const name = `habery-injected-seams-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const cf = yield* createConfiger({
      name,
      headDirPath,
      temp: false,
    });
    cf.put({
      alice: {
        dt: "2026-04-06T13:30:00.000Z",
        curls: ["http://127.0.0.1:7004/controller"],
      },
    });

    const hby = yield* createHabery({
      name,
      headDirPath,
      cf,
      skipSignator: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      assertStrictEquals(hab.cf, cf);
      assertStrictEquals(hab.rtr, hby.rtr);
      assertStrictEquals(hab.rvy, hby.rvy);
      assertStrictEquals(hab.kvy, hby.kevery);
      assertEquals(hab.hasConfigSection(), true);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Parsering exports no fake parser seam", () => {
  assertEquals("KeriParserAdapter" in parsering, false);
  assertEquals("KeriParserLike" in parsering, false);
  assertEquals("KeriEnvelopeStreamParser" in parsering, false);
  assertEquals(typeof parsering.envelopesFromFrames, "function");
});

Deno.test("Hab endorse matches KERIpy EXN pipelining modes", async () => {
  const name = `habery-endorse-exn-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const serder = makeExchangeSerder(
        "/challenge/response",
        { i: hab.pre, words: ["able", "baker"] },
        { sender: hab.pre, recipient: hab.pre },
      );

      const pipelined = hab.endorse(serder);
      const unpipelined = hab.endorse(serder, { pipelined: false });
      const pipelinedCtr = new Counter({ qb64b: pipelined.slice(serder.size) });
      const unpipelinedCtr = new Counter({
        qb64b: unpipelined.slice(serder.size),
      });

      assertEquals(pipelinedCtr.code, CtrDexV1.AttachmentGroup);
      assertEquals(unpipelinedCtr.code, CtrDexV1.TransIdxSigGroups);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Habery inception reuses one Habery across prefix and threshold variants", async () => {
  const name = `habery-inception-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const nested = [{ "1": ["1/2", "1/2"] }];

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const nonTransferableHab = hby.makeHab("bob", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const nonTransferableState = hby.db.getState(nonTransferableHab.pre);
      assertEquals(nonTransferableHab.pre, nonTransferableState?.k?.[0]);
      assertEquals(nonTransferableHab.pre.startsWith("B"), true);
      assertEquals(nonTransferableState?.n ?? [], []);
      assertEquals(nonTransferableState?.b ?? [], []);

      const ecdsaHab = hby.makeHab("bob-r1", undefined, {
        transferable: false,
        icode: "Q",
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const ecdsaState = hby.db.getState(ecdsaHab.pre);
      assertEquals(ecdsaHab.pre, ecdsaState?.k?.[0]);
      assertEquals(ecdsaHab.pre.startsWith("1AAI"), true);
      assertEquals(ecdsaState?.n ?? [], []);
      assertEquals(ecdsaState?.b ?? [], []);

      const digestiveHab = hby.makeHab("carol", undefined, {
        code: "I",
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const digestiveState = hby.db.getState(digestiveHab.pre);
      assertEquals(digestiveHab.pre.startsWith("I"), true);
      assertEquals(digestiveState?.d?.startsWith("E"), true);
      assertEquals(digestiveHab.pre === digestiveState?.k?.[0], false);

      const hab = hby.makeHab("weighted", undefined, {
        transferable: true,
        icount: 2,
        isith: ["1/2", "1/2"],
        ncount: 2,
        nsith: nested,
        toad: 0,
      });
      const state = hby.db.getState(hab.pre);

      assertEquals(state?.kt, ["1/2", "1/2"]);
      assertEquals(state?.nt, nested);
      assertEquals(hab.kever?.tholder?.sith, ["1/2", "1/2"]);
      assertEquals(hab.kever?.tholder?.weighted, true);
      assertEquals(hab.kever?.ntholder?.sith, nested);
      assertEquals(hab.kever?.ntholder?.weighted, true);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab and Signator signing keep indexed and unindexed overload behavior intact", async () => {
  const name = `habery-sign-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const hab = hby.makeHab("dave", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const ser = new TextEncoder().encode("hab-signatures");

      const indexed = hab.sign(ser, true);
      const unindexed = hab.sign(ser, false);
      const signatorSig = hby.signator?.sign(ser);

      assertEquals(indexed.length, 1);
      assertEquals(unindexed.length, 1);
      assertInstanceOf(indexed[0], Siger);
      assertInstanceOf(unindexed[0], Cigar);
      assertEquals(indexed[0]?.index, 0);
      assertInstanceOf(signatorSig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, hby.signator?.pre);
      assertEquals(
        hby.signator?.verfer.qb64,
        hby.signator?.hab.kever?.verfers[0]?.qb64,
      );
      assertEquals(
        signatorSig ? hby.signator?.verify(ser, signatorSig) : false,
        true,
      );
      assertEquals(
        signatorSig
          ? hby.signator?.verify(
            new TextEncoder().encode("wrong-message"),
            signatorSig,
          )
          : true,
        false,
      );
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("Hab receipt helpers reuse one Habery across witness and receipt variants", async () => {
  const name = `habery-receipts-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const witness = hby.makeHab("wit", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const witnessController = hby.makeHab("ctrl-wit", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        wits: [witness.pre],
        toad: 1,
      });
      const witnessEvent = hby.db.getEvtSerder(
        witnessController.pre,
        witnessController.kever?.said ?? "",
      );
      if (!witnessEvent?.said) {
        throw new Error(
          "Expected accepted witness controller inception event.",
        );
      }
      const witnessMsg = witness.witness(witnessEvent);
      assertEquals(witnessMsg.length > 0, true);
      assertEquals(
        hby.db.wigs.get([witnessController.pre, witnessEvent.said]).length,
        0,
      );

      const receiptor = hby.makeHab("receiptor", undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      const receiptController = hby.makeHab("ctrl-rct", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const receiptEvent = hby.db.getEvtSerder(
        receiptController.pre,
        receiptController.kever?.said ?? "",
      );
      if (!receiptEvent?.said) {
        throw new Error("Expected accepted non-transferable receipt event.");
      }
      const nonTransferableReceiptMsg = receiptor.receipt(receiptEvent);
      assertEquals(nonTransferableReceiptMsg.length > 0, true);
      assertEquals(
        hby.db.rcts.get([receiptController.pre, receiptEvent.said]).length,
        0,
      );

      const validator = hby.makeHab("val", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const controller = hby.makeHab("ctrl", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const event = hby.db.getEvtSerder(
        controller.pre,
        controller.kever?.said ?? "",
      );
      if (!event?.said) {
        throw new Error("Expected accepted controller inception event.");
      }

      const transferableReceiptMsg = validator.receipt(event);

      assertEquals(transferableReceiptMsg.length > 0, true);
      assertEquals(hby.db.vrcs.get([controller.pre, event.said]).length, 0);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("encrypted Habery reopens its signator and signs with the same passcode", async () => {
  const name = `habery-enc-signator-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  const bran = "MyPasscodeARealSecret";
  let signatoryPre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      bran,
    });
    try {
      hby.makeHab("erin", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const ser = new TextEncoder().encode("encrypted-signator");
      const sig = hby.signator?.sign(ser);

      signatoryPre = hby.db.getHby(SIGNER) ?? "";
      assertInstanceOf(sig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, signatoryPre);
      assertEquals(
        sig ? hby.signator?.verify(ser, sig) : false,
        true,
      );
      assertEquals(signatoryPre.length > 0, true);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      bran,
    });
    try {
      const ser = new TextEncoder().encode("encrypted-signator-reopen");
      const sig = hby.signator?.sign(ser);

      assertEquals(hby.signator?.pre, signatoryPre);
      assertEquals(hby.db.getHby(SIGNER), signatoryPre);
      assertInstanceOf(sig, Cigar);
      assertInstanceOf(hby.signator?.verfer, Verfer);
      assertEquals(hby.signator?.verfer.qb64, signatoryPre);
      assertEquals(
        hby.signator?.verfer.qb64,
        hby.signator?.hab.kever?.verfers[0]?.qb64,
      );
      assertEquals(
        sig ? hby.signator?.verify(ser, sig) : false,
        true,
      );
    } finally {
      yield* hby.close();
    }
  });

  await assertRejects(
    () =>
      run(function*() {
        const hby = yield* createHabery({
          name,
          headDirPath,
          bran: "WrongPasscodeSecretAB",
        });
        try {
          hby.signator?.sign(new TextEncoder().encode("wrong-passcode"));
        } finally {
          yield* hby.close();
        }
      }),
    Error,
    "Last seed missing or provided last seed not associated",
  );
});

Deno.test("Signator reuses the Habery narrow dependency seam across reopen", async () => {
  const name = `habery-signator-seams-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-habery-${crypto.randomUUID()}`;
  let signatoryPre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const signator = hby.signator;
      if (!signator) {
        throw new Error("Expected signator.");
      }

      signatoryPre = signator.pre;
      assertStrictEquals(signator.hab.cf, hby.cf);
      assertStrictEquals(signator.hab.rtr, hby.rtr);
      assertStrictEquals(signator.hab.rvy, hby.rvy);
      assertStrictEquals(signator.hab.kvy, hby.kevery);
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
    });
    try {
      const signator = hby.signator;
      if (!signator) {
        throw new Error("Expected signator.");
      }

      assertEquals(signator.pre, signatoryPre);
      assertStrictEquals(signator.hab.rtr, hby.rtr);
      assertStrictEquals(signator.hab.rvy, hby.rvy);
      assertStrictEquals(signator.hab.kvy, hby.kevery);
    } finally {
      yield* hby.close();
    }
  });
});
