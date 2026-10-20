import { call, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import {
  Diger,
  NumberPrimitive,
  NumDex,
  parseBytes,
  Prefixer,
  SerderACDC,
  SerderKERI,
  Siger,
  TraitDex,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntimeUntil } from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { createHabery, type Hab } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { envelopeFromFrame, queryEnvelopeFromDispatch } from "../../../src/app/parsering.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { consoleLogger } from "../../../src/core/logger.ts";
import { query, reply } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import {
  backerIssue,
  backerRevoke,
  incept as inceptRegistry,
  issue,
  revoke,
  rotate as rotateRegistry,
} from "../../../src/core/protocol-vdr-eventing.ts";
import { Revery, Router } from "../../../src/core/routing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { createReger, type Reger } from "../../../src/db/reger.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import { Backer, type BackerRequest } from "../../../src/vdr/backing.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";
import { prepareTsnQuery } from "../../../src/vdr/tsn-query.ts";
import { expectKind } from "../../private-access.ts";
import { httpClient } from "../../support/http-client.ts";

/** Consume one ordinary runtime cue and assert its protocol meaning. */
function assertRuntimeCue(runtime: AgentRuntime, expected: AgentCue | AgentCue["kin"], message?: string): void {
  const cue = runtime.cues.pull();
  assertEquals(typeof expected === "string" ? cue?.kin : cue, expected, message);
}

const SCHEMA_SAID = "Eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function ordinal(num: number | bigint): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

function makeCredential(issuer: string): SerderACDC {
  return new SerderACDC({
    sad: {
      d: "",
      i: issuer,
      s: SCHEMA_SAID,
      a: { i: issuer },
    },
    makify: true,
  });
}

function anchorTel(hab: Hab, tel: { pre: string | null; snh: string | null; said: string | null }) {
  if (!tel.pre || !tel.snh || !tel.said) {
    throw new Error("TEL event missing seal fields.");
  }
  hab.interact({
    data: [{
      i: tel.pre,
      s: tel.snh,
      d: tel.said,
    }],
  });
  const sn = hab.kever?.sn;
  const said = hab.kever?.said;
  if (sn === undefined || sn === null || !said) {
    throw new Error("Anchor interaction did not advance accepted state.");
  }
  return {
    seqner: ordinal(sn),
    saider: new Diger({ qb64: said }),
  };
}

Deno.test("vdr/eventing - accepts backerless registry inception and pins state", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `tvy-vcp-${crypto.randomUUID()}`,
      temp: true,
    });
    const reger = yield* createReger({
      name: `tvy-vcp-reg-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(hab.pre, { cnfg: [TraitDex.NoBackers] });
      const anchor = anchorTel(hab, vcp);

      const decision = tvy.processEvent({ serder: vcp, ...anchor });

      assertEquals(decision.kind, "accept");
      assertEquals(reger.states.get(vcp.pre!)?.i, vcp.pre);
      assertEquals(reger.tels.getOn(vcp.pre!, 0)?.qb64, vcp.said);
      assertEquals(reger.tvts.get(dgKey(vcp.pre!, vcp.said!)), vcp.raw);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("vdr/eventing - shared accepted state does not retain another input's backer policy or cues", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const backer = hby.makeHab("backer", undefined, { transferable: false });
      const localCues = new Deck<AgentCue>(), remoteCues = new Deck<AgentCue>();
      const local = new Tevery({ db: hby.db, reger, local: true, cues: localCues });
      const vcp = inceptRegistry(issuer.pre, { baks: [backer.pre], toad: 1 });
      assertEquals(local.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const remote = new Tevery({ db: hby.db, reger, cues: remoteCues });
      const credential = makeCredential(issuer.pre);
      const issued = backerIssue(credential.said!, vcp.pre!, 0, vcp.said!);
      const anchor = anchorTel(issuer, issued);
      const missingProof = remote.processEvent({ serder: issued, ...anchor });
      assertEquals(missingProof.kind, "escrow");
      assertEquals(missingProof.kind === "escrow" && missingProof.escrow, "partialWitness");
      assertEquals(reger.tels.getOn(issued.pre!, 0), null);
      assertEquals(
        remote.processEvent({ serder: issued, ...anchor, wigers: backer.sign(issued.raw, true) }).kind,
        "accept",
      );
      const revoked = backerRevoke(credential.said!, vcp.pre!, 0, vcp.said!, issued.said!);
      assertEquals(
        remote.processEvent({
          serder: revoked,
          ...anchorTel(issuer, revoked),
          wigers: backer.sign(revoked.raw, true),
        }).kind,
        "accept",
      );
      assertEquals(remoteCues.pull()?.kin, "revoked");
      assertEquals(localCues.empty, true);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("vdr/eventing - failed rotation writes and commit preserve accepted TEL state", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(issuer.pre);
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const accepted = tvy.tevers.get(vcp.pre!)!;
      const state = reger.states.get(vcp.pre!);
      const rotation = rotateRegistry(vcp.pre!, vcp.said!, { sn: 1 });
      const args = { serder: rotation, ...anchorTel(issuer, rotation) };
      const pin = reger.states.pin, transaction = reger.env!.transactionSync;
      const write = transaction.bind(reger.env);
      for (const phase of ["write", "commit"]) {
        const failure = new Error(`TEL ${phase} failed`);
        try {
          if (phase === "write") {
            reger.states.pin = () => {
              throw failure;
            };
          } else {
            let entered = false;
            reger.env!.transactionSync = function(callback) {
              if (entered) return write(callback);
              entered = true;
              return write(() => {
                callback();
                throw failure;
              });
            };
          }
          assertEquals(assertThrows(() => tvy.processEvent(args)), failure);
          assertEquals(tvy.tevers.get(vcp.pre!), accepted);
          assertEquals(accepted.sn, 0);
          assertEquals(accepted.serder.said, vcp.said);
          assertEquals(reger.states.get(vcp.pre!), state);
          assertEquals(reger.tels.getOn(vcp.pre!, 1), null);
          assertEquals(reger.tvts.get(dgKey(vcp.pre!, rotation.said!)), null);
        } finally {
          reger.states.pin = pin;
          reger.env!.transactionSync = transaction;
        }
      }
      assertThrows(
        () => reger.env!.transactionSync(() => tvy.processEvent(args)),
        Error,
        "Tevery must own the TEL transaction",
      );
      assertEquals(accepted.sn, 0);
      assertEquals(tvy.processEvent(args).kind, "accept");
      assertEquals(tvy.tevers.get(vcp.pre!)?.sn, 1);
      assertEquals(reger.tels.getOn(vcp.pre!, 1)?.qb64, rotation.said);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("vdr/eventing - escrows out-of-order issue and unescrows after registry inception", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `tvy-ooo-${crypto.randomUUID()}`,
      temp: true,
    });
    const reger = yield* createReger({
      name: `tvy-ooo-reg-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(hab.pre, { cnfg: [TraitDex.NoBackers] });
      const creder = makeCredential(hab.pre);
      const iss = issue(creder.said!, vcp.pre!);
      const issAnchor = anchorTel(hab, iss);

      const outOfOrder = tvy.processEvent({ serder: iss, ...issAnchor });
      assertEquals(outOfOrder.kind, "escrow");
      assertEquals(outOfOrder.kind === "escrow" && outOfOrder.escrow, "outOfOrder");
      assertEquals(reger.oots.getOn(iss.pre!, 0), [iss.said]);

      const vcpAnchor = anchorTel(hab, vcp);
      assertEquals(tvy.processEvent({ serder: vcp, ...vcpAnchor }).kind, "accept");

      const put = reger.tvts.put;
      const failure = new Error("TEL storage unavailable");
      try {
        reger.tvts.put = () => {
          throw failure;
        };
        assertEquals(assertThrows(() => tvy.processEscrows()), failure);
        assertEquals(reger.oots.getOn(iss.pre!, 0), [iss.said], "Storage failure preserves pending source evidence");
      } finally {
        reger.tvts.put = put;
      }
      tvy.processEscrows();
      assertEquals(reger.oots.getOn(iss.pre!, 0), []);
      assertEquals(reger.tels.getOn(iss.pre!, 0)?.qb64, iss.said);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("vdr/eventing - reports missing TEL artifacts only when their escrow rows are removed", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    const warnings: Parameters<typeof consoleLogger.warn>[] = [];
    const warn = consoleLogger.warn;
    consoleLogger.warn = (...args) => warnings.push(args);
    try {
      const issuer = hby.makeHab("issuer");
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      const key = dgKey(vcp.pre!, vcp.said!);
      reger.oots.addOn(vcp.pre!, 0, vcp.said!);
      reger.taes.addOn(vcp.pre!, 0, vcp.said!);
      // An existing body without its source seal stays anchorless, but cannot remain out of order.
      reger.tvts.put(key, vcp.raw);
      tvy.processEscrows();
      assertEquals(reger.oots.getOn(vcp.pre!, 0), []);
      assertEquals(reger.taes.getOn(vcp.pre!, 0), [vcp.said]);
      assertEquals(warnings.map((entry) => entry[1]), [{
        family: "outOfOrder",
        pre: vcp.pre,
        sn: 0,
        said: vcp.said,
        reason: "missingSourceSeal",
      }]);
      reger.tvts.rem(key);
      tvy.processEscrows();
      assertEquals(reger.taes.getOn(vcp.pre!, 0), []);
      assertEquals(warnings[1][1], {
        family: "anchorless",
        pre: vcp.pre,
        sn: 0,
        said: vcp.said,
        reason: "missingEvent",
      });
      tvy.processEscrows();
      assertEquals(warnings.length, 2, "Removed evidence is not reported again");
    } finally {
      consoleLogger.warn = warn;
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Tevery retains pending inception and completes a TSN horizon larger than one page", async () => {
  await run(function*() {
    const sender = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const source = yield* createReger({ name: crypto.randomUUID(), temp: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(target, new FetchHttpClient(), systemClock);
    try {
      const issuer = sender.makeHab("issuer");
      const producing = new Tevery({ db: sender.db, reger: source });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      const anchor = anchorTel(issuer, vcp);
      assertEquals(producing.processEvent({ serder: vcp, ...anchor }).kind, "accept");
      const { tvy, reger } = runtime.vdr!;
      assertEquals(tvy.processEvent({ serder: vcp, ...anchor }).kind, "escrow");
      tvy.processEscrows();
      assertEquals(reger.taes.getOn(vcp.pre!, 0), [vcp.said]);

      const state = producing.tevers.get(vcp.pre!)!.state().asDict();
      let last: SerderKERI | undefined;
      const now = Date.now();
      for (let i = 0; i < 65; i++) {
        last = reply(`/tsn/registry/${issuer.pre}`, state, {
          pre: issuer.pre,
          stamp: makeNowIso8601(new Date(now + i)),
        });
        yield* runtime.reactor.processBytes(issuer.endorse(last));
      }
      assertEquals(reger.txnsb.escrowdb.cnt(), 65);
      tvy.processEscrows();
      for (const wire of sender.db.clonePreIter(issuer.pre)) yield* runtime.reactor.processBytes(wire);
      tvy.processEscrows();
      assertEquals(reger.taes.getOn(vcp.pre!, 0), []);
      assertEquals(reger.tels.getOn(vcp.pre!, 0)?.qb64, vcp.said);
      assertEquals(reger.txnsb.escrowdb.cnt(), 0, "A complete sweep processes all 65 notices");
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, last!.said);
    } finally {
      yield* runtime.close();
      yield* target.close(true);
      yield* source.close(true);
      yield* sender.close(true);
    }
  });
});

Deno.test("vdr/eventing - rejects simple issue against a backer registry", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `tvy-mode-${crypto.randomUUID()}`,
      temp: true,
    });
    const reger = yield* createReger({
      name: `tvy-mode-reg-${crypto.randomUUID()}`,
      temp: true,
    });
    try {
      const backer = hby.makeHab("backer", undefined, {
        transferable: false,
      });
      const hab = hby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const tvy = new Tevery({ db: hby.db, reger, local: true });
      const vcp = inceptRegistry(hab.pre, { baks: [backer.pre] });
      const vcpAnchor = anchorTel(hab, vcp);
      assertEquals(
        tvy.processEvent({ serder: vcp, ...vcpAnchor, wigers: [] }).kind,
        "accept",
      );

      const creder = makeCredential(hab.pre);
      const iss = issue(creder.said!, vcp.pre!);
      const issAnchor = anchorTel(hab, iss);
      const decision = tvy.processEvent({ serder: iss, ...issAnchor });

      assertEquals(decision.kind, "reject");
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

for (const backed of [false, true]) {
  Deno.test(`vdr/eventing - records ${backed ? "backer" : "simple"} revoke with ordinary cues`, async () => {
    await run(function*() {
      const hby = yield* createHabery({
        name: `tvy-vcstate-${crypto.randomUUID()}`,
        temp: true,
      });
      const reger = yield* createReger({
        name: `tvy-vcstate-reg-${crypto.randomUUID()}`,
        temp: true,
      });
      try {
        const hab = hby.makeHab("issuer", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const cues = new Deck<AgentCue>();
        const backer = backed ? hby.makeHab("backer", undefined, { transferable: false }) : undefined;
        const tvy = new Tevery({ db: hby.db, reger, cues });
        const vcp = inceptRegistry(
          hab.pre,
          backer ? { baks: [backer.pre], toad: 1 } : { cnfg: [TraitDex.NoBackers] },
        );
        assertEquals(
          tvy.processEvent({ serder: vcp, ...anchorTel(hab, vcp), wigers: backer?.sign(vcp.raw, true) }).kind,
          "accept",
        );

        const creder = makeCredential(hab.pre);
        const iss = backed ? backerIssue(creder.said!, vcp.pre!, 0, vcp.said!) : issue(creder.said!, vcp.pre!);
        assertEquals(
          tvy.processEvent({ serder: iss, ...anchorTel(hab, iss), wigers: backer?.sign(iss.raw, true) }).kind,
          "accept",
        );
        let state = tvy.tevers.get(vcp.pre!)?.vcState(creder.said!);
        assertEquals(state?.et, backed ? "bis" : "iss");
        assertEquals(state?.s, "0");

        const rev = backed
          ? backerRevoke(creder.said!, vcp.pre!, 0, vcp.said!, iss.said!)
          : revoke(creder.said!, vcp.pre!, iss.said!);
        const args = { serder: rev, ...anchorTel(hab, rev), wigers: backer?.sign(rev.raw, true) };
        const key = dgKey(creder.said!, rev.said!);
        const put = reger.ancs.put;
        try {
          for (const fault of [new Error("storage failure"), undefined]) {
            reger.ancs.put = () => {
              throw fault;
            };
            let threw = false;
            try {
              tvy.processEvent(args);
            } catch (error) {
              threw = true;
              assertEquals(error === fault, true);
            }
            assertEquals(threw, true, "publication infrastructure failure retains its exact identity");
          }
        } finally {
          reger.ancs.put = put;
        }
        assertEquals(tvy.processEvent(args).kind, "accept");
        state = tvy.tevers.get(vcp.pre!)?.vcState(creder.said!);
        assertEquals(state?.et, backed ? "brv" : "rev");
        assertEquals(state?.s, "1");
        assertEquals(reger.tels.getOn(creder.said!, 1)?.qb64, rev.said);
        assertEquals(cues.pull()?.kin, "revoked");
      } finally {
        yield* reger.close(true);
        yield* hby.close(true);
      }
    });
  });
}

Deno.test("protocol-vdr-eventing - NoBackers inception rejects configured backers", () => {
  assertThrows(
    () =>
      inceptRegistry("Eaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", {
        cnfg: [TraitDex.NoBackers],
        baks: ["Bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
      }),
    Error,
    "NoBackers",
  );
});
Deno.test("tels queries reach the built-in owner and retain captured management/credential replay", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = hby.makeHab("issuer");
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    const reger = runtime.vdr!.reger! as Reger, tvy = runtime.vdr!.tvy! as Tevery;
    try {
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      const credential = makeCredential(issuer.pre);
      const iss = issue(credential.said!, vcp.pre!);
      const anchors = [anchorTel(issuer, vcp), anchorTel(issuer, iss)];
      for (const [index, serder] of [vcp, iss].entries()) {
        assertEquals(tvy.processEvent({ serder, ...anchors[index] }).kind, "accept");
      }
      // Frozen 927 processQuery emits management then credential, using default v2 proof counters.
      const responses: Iterable<Uint8Array>[] = [];
      for (const pvrsn of [Vrsn_1_0, Vrsn_2_0]) {
        const request = query("tels", { ri: vcp.pre!, src: issuer.pre, i: iss.pre! }, { pre: issuer.pre, pvrsn });
        const reply = runtime.replies.reserve(request.said!);
        try {
          const wire = messagize(request, {
            sigers: issuer.sign(request.raw, true),
            seal: { i: new Prefixer({ qb64: issuer.pre }) },
            gvrsn: pvrsn,
          });
          yield* runtime.reactor.processBytes(wire);
          const batch = reply.takeAll();
          assertExists(batch);
          const [cue] = batch.cues;
          assertExists(cue);
          if (cue.kin !== "replay") throw new Error("Expected TEL replay");
          assertEquals([cue.querySaid, cue.src, cue.dest], [request.said, issuer.pre, issuer.pre]);
          const admitted = new Deck<AgentCue>();
          const clone = reger.cloneTvt;
          let reads = 0;
          try {
            reger.cloneTvt = () => {
              reads++;
              throw new Error("Unexpected TEL body read during cue publication");
            };
            const producing = new Tevery({ db: hby.db, reger, cues: admitted });
            producing.processQuery({ serder: request, source: issuer.kever!.prefixer });
            assertEquals(admitted.pull()?.kin, "replay");
            assertEquals(reads, 0);
          } finally {
            reger.cloneTvt = clone;
          }
          responses.push(cue.msgs);
        } finally {
          reply.close();
        }
      }
      const rev = revoke(iss.pre!, vcp.pre!, iss.said!);
      assertEquals(tvy.processEvent({ serder: rev, ...anchorTel(issuer, rev) }).kind, "accept");
      for (const response of responses) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const messages = [...response];
          assertEquals(messages.length, 2, "Later revocation remains outside both captured responses");
          for (const [index, message] of messages.entries()) {
            const [frame] = yield* call(() => parseBytes(message));
            {
              const envelope = envelopeFromFrame(frame);
              assertEquals(envelope.serder.raw, [vcp, iss][index].raw);
              assertEquals(envelope.lastSsc?.s.num, anchors[index].seqner.num);
              assertEquals(envelope.lastSsc?.d.qb64, anchors[index].saider.qb64);
              assertEquals(frame.gvrsn?.major, 2);
            }
          }
        }
      }
      yield* runtime.protocol.processEscrowsOnce();
      assertRuntimeCue(runtime, "revoked", "Accepted later revocation keeps its independent cue");
      const request = (ri = vcp.pre!, i = "", route = "tels") =>
        query(route, { ri, src: issuer.pre, i }, { pre: issuer.pre, pvrsn: Vrsn_2_0 });
      const source = new Prefixer({ qb64: issuer.pre });
      assertEquals(tvy.processQuery({ serder: request(), source }), undefined);
      assertEquals(tvy.cues.pull()?.kin, "replay");
      tvy.processQuery({ serder: request(vcp.pre!, vcp.pre!), source });
      const duplicate = tvy.cues.pull();
      if (duplicate?.kin !== "replay") throw new Error("Expected duplicate TEL replay");
      const first = [...responses[0]][0];
      assertEquals([...duplicate.msgs], [first, first], "Repeated ranges preserve management/credential order");
      assertEquals(tvy.processQuery({ serder: request(issuer.pre), source }), undefined);
      assertEquals(tvy.cues.length, 0, "Unknown TEL has no response or query escrow");
      assertEquals(tvy.processQuery({ serder: request(), source: undefined }), {
        kind: "drop",
        reason: "missingAuthentication",
      });
      assertEquals(tvy.processQuery({ serder: request(""), source }), { kind: "drop", reason: "invalidQuery" });
      for (const q of [null, false, "query", [], { ri: vcp.pre!, i: "" }, { ri: vcp.pre!, src: issuer.pre, i: 0 }]) {
        const malformed = new SerderKERI({ sad: { ...request().ked, q }, makify: true });
        assertEquals(tvy.processQuery({ serder: malformed, source }), { kind: "drop", reason: "invalidQuery" });
      }
      assertEquals(tvy.cues.length, 0);
      assertEquals(tvy.processQuery({ serder: request(vcp.pre!, "", "tsn"), source }), undefined);
      assertEquals(tvy.cues.pull()?.kin, "reply");
      const unsigned = hby.makeHab("nontransferable", undefined, { transferable: false });
      const serder = request();
      assertEquals(tvy.processQuery({ serder, cigars: unsigned.sign(serder.raw, false) }), undefined);
      assertEquals(tvy.cues.pull()?.kin, "replay");
      yield* reger.close();
      assertThrows(() => [...responses[0]], Error, "not open");
      yield* reger.reopen();
      assertEquals([...responses[0]].length, 2, "Captured response reopens independently of query processing");
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("TSN producer prepares ordered independent state replies without publishing cues", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      const credential = makeCredential(issuer.pre);
      const iss = issue(credential.said!, vcp.pre!);
      const anchors = [anchorTel(issuer, vcp), anchorTel(issuer, iss)];
      for (const [index, serder] of [vcp, iss].entries()) {
        assertEquals(tvy.processEvent({ serder, ...anchors[index] }).kind, "accept");
      }
      const source = new Prefixer({ qb64: issuer.pre });
      const request = (ri = vcp.pre!, i = credential.said!, route = "tsn") =>
        query(route, { ri, i }, { pre: issuer.pre, pvrsn: Vrsn_2_0 });
      const serder = request();
      const [frame] = yield* call(() =>
        parseBytes(messagize(serder, {
          sigers: issuer.sign(serder.raw, true),
          seal: { i: source },
          gvrsn: Vrsn_2_0,
        }))
      );
      {
        const result = prepareTsnQuery(queryEnvelopeFromDispatch(envelopeFromFrame(frame)), tvy.tevers);
        if (result.kind !== "reply") throw new Error("Expected TSN replies");
        // Actual714 parsed query emits registry then hits vcpre= TypeError; positional vcState proves this record.
        assertEquals(result.replies.map((reply) => [reply.route, reply.dest, reply.querySaid]), [
          ["/tsn/registry", issuer.pre, serder.said!],
          ["/tsn/credential", issuer.pre, serder.said!],
        ]);
        const { dt, ...registry } = result.replies[0].data.asDict();
        assertEquals(typeof dt, "string");
        assertEquals(registry, {
          vn: [1, 0],
          i: vcp.pre,
          s: "0",
          d: vcp.said,
          ii: issuer.pre,
          et: "vcp",
          bt: "0",
          b: [],
          c: [TraitDex.NoBackers],
        });
        assertEquals(result.replies[1]!.data.asDict(), {
          vn: [1, 0],
          i: credential.said,
          s: "0",
          d: iss.said,
          ri: vcp.pre!,
          ra: {},
          a: { s: Number(anchors[1].seqner.num), d: anchors[1].saider.qb64 },
          dt: iss.ked!.dt,
          et: "iss",
        });
        result.replies[0].data.b = ["foreign"];
        assertEquals(tvy.tevers.get(vcp.pre!)!.baks, [], "Replies are detached record data");
      }
      const partial = prepareTsnQuery({ serder: request(vcp.pre!, issuer.pre), source }, tvy.tevers);
      if (partial.kind !== "reply") throw new Error("Expected registry reply");
      assertEquals(partial.replies.length, 1, "Missing credential retains the registry reply");
      const registryOnly = prepareTsnQuery({ serder: request(vcp.pre!, ""), source }, tvy.tevers);
      if (registryOnly.kind !== "reply") throw new Error("Expected registry reply");
      assertEquals(registryOnly.replies.length, 1);
      assertEquals(prepareTsnQuery({ serder: request(issuer.pre), source }, tvy.tevers), {
        kind: "unavailable",
      });
      assertEquals(prepareTsnQuery({ serder: request() }, tvy.tevers), {
        kind: "drop",
        reason: "missingAuthentication",
      });
      assertEquals(prepareTsnQuery({ serder: request(""), source }, tvy.tevers), {
        kind: "drop",
        reason: "invalidQuery",
      });

      for (const q of [null, false, "query", [], { ri: vcp.pre }, { ri: vcp.pre!, i: 0 }]) {
        const malformed = new SerderKERI({ sad: { ...request().ked, q }, makify: true });
        assertEquals(prepareTsnQuery({ serder: malformed, source }, tvy.tevers), {
          kind: "drop",
          reason: "invalidQuery",
        });
      }
      assertEquals(prepareTsnQuery({ serder: request(vcp.pre!, "", "tels"), source }, tvy.tevers), {
        kind: "drop",
        reason: "unsupportedRoute",
      });
      const outsider = hby.makeHab("outsider", undefined, { transferable: false });
      const nontrans = request(vcp.pre!, "");
      const cigarResult = prepareTsnQuery({ serder: nontrans, cigars: outsider.sign(nontrans.raw, false) }, tvy.tevers);
      if (cigarResult.kind !== "reply") throw new Error("Expected cigar destination");
      assertEquals(cigarResult.replies[0].dest, outsider.pre);
      assertEquals(tvy.cues.length, 0, "Preparing replies publishes nothing");
      tvy.processQuery({ serder: request(), source });
      assertEquals(tvy.cues.toArray().map((cue) => cue.kin), ["reply", "reply"]);
      tvy.cues.clear();
      yield* reger.close();
      assertThrows(() => prepareTsnQuery({ serder: request(), source }, tvy.tevers), Error, "not open");
      yield* reger.reopen();
      reger.ancs.rem(dgKey(vcp.pre!, vcp.said!));
      assertThrows(() => prepareTsnQuery({ serder: request(), source }, tvy.tevers), Error, "Missing TEL anchor");
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});
Deno.test("registry TSN runtime verifies independent proof, accepted trust and microsecond BADA", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = hby.makeHab("issuer"), outsider = hby.makeHab("outsider", undefined, { transferable: false });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      reger,
    });
    const tvy = runtime.vdr!.tvy;
    try {
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const state = tvy.tevers.get(vcp.pre!)!.state().asDict();
      const oldStamp = makeNowIso8601().replace(/0\+00:00$/, "1+00:00");
      const newStamp = oldStamp.replace(/1\+00:00$/, "2+00:00");
      const notice = (data = state, stamp = newStamp, author = issuer) =>
        reply(`/tsn/registry/${author.pre}`, data, { pre: author.pre, stamp });
      const valid = notice();
      yield* runtime.reactor.processBytes(issuer.endorse(valid));
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, valid.said, "Pointer is outer reply SAID");
      assertRuntimeCue(runtime, "txnStateSaved");
      assertEquals(tvy.cues.length, 0, "Borrowed Tevery does not capture reply-owned notifications");
      yield* runtime.reactor.processBytes(issuer.endorse(notice(state, oldStamp)));
      assertEquals(
        reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64,
        valid.said,
        "Older microsecond cannot replace it",
      );
      yield* runtime.reactor.processBytes(outsider.endorse(notice()));
      assertEquals(runtime.cues.length, 0, "A foreign endorsement does not authenticate the claimed attester");
      // Actual714 accepts this signed self-listing in strict mode; accepted configuration must supply trust.
      const fabricated = notice({ ...state, c: [], b: [outsider.pre] }, newStamp, outsider);
      yield* runtime.reactor.processBytes(outsider.endorse(fabricated));
      assertEquals(reger.txnsb.current([vcp.pre!, outsider.pre]), null);
      assertEquals(runtime.cues.length, 0);
      for (
        const malformed of [
          notice({ ...state, i: `${vcp.pre}suffix` }),
          notice({ ...state, s: "20000000000001" }),
          notice({ ...state, vn: [1, "0"] }),
          notice({ ...state, b: [1] }),
          notice({ ...state, c: [1] }),
          reply(`/tsn/registry/${issuer.pre}suffix`, state, { pre: issuer.pre }),
        ]
      ) {
        yield* runtime.reactor.processBytes(issuer.endorse(malformed));
      }
      assertEquals(reger.txnsb.escrowdb.cnt(), 0, "Malformed qualified coordinates never reach storage");
      assertEquals(runtime.cues.length, 0);
      const habRecord = hby.db.getHab(issuer.pre)!;
      habRecord.watchers = [outsider.pre];
      hby.db.habs.pin(issuer.pre, habRecord);
      const watcher = notice(state, newStamp, outsider);
      yield* runtime.reactor.processBytes(outsider.endorse(watcher));
      assertEquals(reger.txnsb.current([vcp.pre!, outsider.pre])?.qb64, watcher.said);
      const notification = runtime.cues.pull()!;
      assertEquals(notification.kin, "txnStateSaved");
      assertEquals([...issuer.processCuesIter([notification])], []);
      habRecord.watchers = [];
      hby.db.habs.pin(issuer.pre, habRecord);
      const backed = inceptRegistry(issuer.pre, { baks: [outsider.pre], toad: 1 });
      assertEquals(
        tvy.processEvent({ serder: backed, ...anchorTel(issuer, backed), wigers: outsider.sign(backed.raw, true) })
          .kind,
        "accept",
      );
      const backerNotice = reply(`/tsn/registry/${outsider.pre}`, tvy.tevers.get(backed.pre!)!.state().asDict(), {
        pre: outsider.pre,
      });
      yield* runtime.reactor.processBytes(outsider.endorse(backerNotice));
      assertEquals(
        reger.txnsb.current([backed.pre!, outsider.pre])?.qb64,
        backerNotice.said,
        "Accepted registry backers supply trust independently of watcher configuration",
      );
      assertRuntimeCue(runtime, "txnStateSaved");
      const wrong = notice(
        {
          ...state,
          d: new Diger({ code: "E", raw: Diger.digest(new TextEncoder().encode("wrong digest"), "E") }).qb64,
        },
        newStamp.replace(/2\+00:00$/, "3+00:00"),
      );
      for (const rejected of [wrong, notice({ ...state, c: [] }, newStamp.replace(/2\+00:00$/, "4+00:00"))]) {
        yield* runtime.reactor.processBytes(issuer.endorse(rejected));
        assertEquals(hby.db.rpys.get([rejected.said!]), null, "Unaccepted authenticated body has no orphan owner");
        assertEquals(hby.db.sdts.get([rejected.said!]), null);
        assertEquals([...hby.db.ssgs.getTopItemIter([rejected.said!], { topive: true })].length, 0);
      }
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, valid.said);
      assertExists(hby.db.sdts.get([valid.said!]), "Pending/rejected semantic state retains previous BADA metadata");
      assertEquals(runtime.cues.length, 0);
      tvy.processQuery({ serder: query("tsn", { ri: vcp.pre!, i: "" }), source: issuer.kever!.prefixer });
      assertEquals(
        tvy.cues.pull()?.kin,
        "reply",
        "Direct borrowed processor calls retain their supplied cue owner",
      );
      yield* reger.close();
      let failure: unknown;
      try {
        yield* runtime.reactor.processBytes(issuer.endorse(valid));
      } catch (error) {
        failure = error;
      }
      assertEquals(
        failure instanceof Error && failure.message.includes("not open"),
        true,
        "Storage failure propagates through runtime reply intake",
      );
      yield* reger.reopen();
    } finally {
      yield* runtime.close();
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("registry TSN admits prospective state and dependency cues before proof or Broker effects", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const cues = new Deck<AgentCue>();
      const rvy = new Revery(hby.db, { cues });
      const tvy = new Tevery({ db: hby.db, reger, rvy });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const state = tvy.tevers.get(vcp.pre!)!.state().asDict();
      const est = hby.db.getEvtSerder(issuer.pre, hby.db.kels.getLast(issuer.pre, 0)!)!;
      const stamp = makeNowIso8601().replace(/0\+00:00$/, "1+00:00");
      const args = (stamp: string) => {
        const serder = reply(`/tsn/registry/${issuer.pre}`, state, { pre: issuer.pre, stamp });
        return {
          serder,
          diger: new Diger({ qb64: serder.said! }),
          route: serder.route!,
          aid: issuer.pre,
          cigars: [],
          tsgs: [
            new TransIdxSigGroup(
              new Prefixer({ qb64: issuer.pre }),
              est.sner!,
              new Diger({ qb64: est.said! }),
              issuer.sign(serder.raw, true),
            ),
          ],
        };
      };
      const prior = args(stamp), incoming = args(stamp.replace(/1\+00:00$/, "2+00:00"));
      assertEquals(tvy.processReplyRegistryTxnState(prior).kind, "accept");
      cues.clear();
      const unchanged = () => {
        assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, prior.diger.qb64);
        assertEquals(hby.db.rpys.get([incoming.diger.qb64]), null);
        assertEquals(hby.db.sdts.get([incoming.diger.qb64]), null);
        assertEquals([...hby.db.ssgs.getTopItemIter([incoming.diger.qb64], { topive: true })], []);
        assertEquals(reger.txnsb.serderdb.get([incoming.diger.qb64]), null);
        assertEquals(reger.txnsb.daterdb.get([incoming.diger.qb64]), null);
        assertEquals(reger.txnsb.escrowdb.cnt(), 0);
        assertExists(hby.db.rpys.get([prior.diger.qb64]));
        assertEquals(cues.length, 0);
      };
      unchanged();
      assertEquals(tvy.processReplyRegistryTxnState(incoming).kind, "accept");
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, incoming.diger.qb64);
      assertEquals(hby.db.rpys.get([prior.diger.qb64]), null);
      assertEquals(cues.pull()?.kin, "txnStateSaved");

      const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const pendingReger = yield* createReger({ name: crypto.randomUUID(), temp: true });
      try {
        const pendingCues = new Deck<AgentCue>();
        const pending = new Tevery({
          db: target.db,
          reger: pendingReger,
          rvy: new Revery(target.db, { cues: pendingCues }),
        });
        assertEquals(pending.processReplyRegistryTxnState(incoming), {
          kind: "unverified",
          reason: "dependencyPending",
          family: "registry-mae",
          message: "Registry state dependency unavailable.",
        });
        assertEquals(pendingCues.toArray(), [{
          kin: "query",
          pre: issuer.pre,
          src: issuer.pre,
          route: "logs",
          q: {},
        }]);
        pendingCues.clear();
        assertEquals(
          pending.processReplyRegistryTxnState(incoming),
          {
            kind: "unverified",
            reason: "dependencyPending",
            family: "registry-mae",
            message: "Registry state dependency unavailable.",
          },
          "existing bucket membership produces no second query cue",
        );
        assertEquals(pendingReger.txnsb.escrowdb.cnt(), 1);
        assertEquals(pendingCues.length, 0);
      } finally {
        yield* pendingReger.close(true);
        yield* target.close(true);
      }
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});
Deno.test("Tevery keeps TEL-only use independent and requires Revery before registering TSN routes", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      tvy.processEscrows();
      assertEquals(reger.states.get(vcp.pre!)?.d, vcp.said);
      const router = new Router();
      assertThrows(() => tvy.registerReplyRoutes(router), TypeError, "requires Revery");
      assertEquals(router.routes.length, 0, "Composition failure must precede either route registration");
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("Tevery routes both signed TSNs and completes their dependencies in one escrow pass", async () => {
  await run(function*() {
    const sender = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const source = yield* createReger({ name: crypto.randomUUID(), temp: true });
    const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(target, new FetchHttpClient(), systemClock);
    const received = runtime.vdr!.reger, tvy = runtime.vdr!.tvy;
    try {
      const issuer = sender.makeHab("issuer"), producing = new Tevery({ db: sender.db, reger: source });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(producing.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const credential = makeCredential(issuer.pre), iss = issue(credential.said!, vcp.pre!);
      assertEquals(producing.processEvent({ serder: iss, ...anchorTel(issuer, iss) }).kind, "accept");
      const tever = producing.tevers.get(vcp.pre!)!;
      const registry = reply(`/tsn/registry/${issuer.pre}`, tever.state().asDict(), { pre: issuer.pre });
      const notice = reply(`/tsn/credential/${issuer.pre}`, tever.vcState(credential.said!)!.asDict(), {
        pre: issuer.pre,
      });
      for (const wire of sender.db.clonePreIter(issuer.pre)) yield* runtime.reactor.processBytes(wire);
      yield* runtime.reactor.processBytes(issuer.endorse(registry));
      yield* runtime.reactor.processBytes(issuer.endorse(notice));
      assertEquals(received.txnsb.escrowdb.get(["registry-ooo", vcp.pre!, issuer.pre]).length, 1);
      assertEquals(received.txnsb.escrowdb.get(["credential-mre", credential.said!, issuer.pre]).length, 1);
      assertEquals(received.txnsb.current([vcp.pre!, issuer.pre]), null);
      assertEquals(received.txnsb.current([credential.said!, issuer.pre]), null);
      yield* runtime.reactor.processBytes(source.cloneTvt(vcp.pre!, vcp.said!));
      yield* runtime.reactor.processBytes(source.cloneTvt(credential.said!, iss.said!));
      runtime.protocol.rvy.cues.clear();
      tvy.processEscrows();
      assertEquals(received.txnsb.current([vcp.pre!, issuer.pre])?.qb64, registry.said);
      assertEquals(received.txnsb.current([credential.said!, issuer.pre])?.qb64, notice.said);
      assertEquals(received.txnsb.escrowdb.cnt(), 0);
      assertEquals(target.db.rpes.cnt(), 0, "Notice dependencies retain one Broker owner");
      assertEquals(
        runtime.protocol.rvy.cues.toArray().flatMap((cue) => cue.kin === "txnStateSaved" ? [cue.record.i] : []),
        [vcp.pre!, credential.said!],
        "Registry publication precedes credential publication",
      );
    } finally {
      yield* runtime.close();
      yield* target.close(true);
      yield* source.close(true);
      yield* sender.close(true);
    }
  });
});

Deno.test("registry TSN missing issuer and TEL retry through the normal runtime turn", async () => {
  await run(function*() {
    const sender = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = sender.makeHab("issuer");
    const source = yield* createReger({ name: crypto.randomUUID(), temp: true });
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const local = hby.makeHab("receiver");
    const queries: Record<string, unknown>[] = [];
    hby.db.locs.pin([issuer.pre, "http"], { url: "http://issuer.test/" });
    hby.db.ends.pin([issuer.pre, "controller", issuer.pre], { allowed: true });
    const runtime = yield* createAgentRuntime(
      hby,
      httpClient(async (url, init) => {
        const wire = await readCesrRequestBytes(new Request(url, init));
        const message = new SerderKERI({ raw: wire });
        if (message.ilk === "qry") queries.push(message.ked!.q as Record<string, unknown>);
        return new Response(null, { status: 204 });
      }),
      systemClock,
    );
    const reger = runtime.vdr!.reger! as Reger;
    const warnings: Parameters<typeof consoleLogger.warn>[] = [];
    const warn = consoleLogger.warn;
    consoleLogger.warn = (...args) => warnings.push(args);
    try {
      const tvy = new Tevery({ db: sender.db, reger: source });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const state = tvy.tevers.get(vcp.pre!)!.state().asDict();
      const serder = reply(`/tsn/registry/${issuer.pre}`, state, { pre: issuer.pre });
      yield* runtime.reactor.processBytes(issuer.endorse(serder));
      assertEquals(reger.txnsb.escrowdb.get(["registry-mae", vcp.pre!, issuer.pre]).length, 1);
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre]), null);
      yield* runAgentRuntimeUntil(runtime, () => queries.length > 0 && !runtime.querying.hasPendingDelivery, {
        hab: local,
        timeoutMs: 2_000,
        pollMailbox: false,
      });
      assertEquals(queries[0].i, issuer.pre);
      for (const wire of sender.db.clonePreIter(issuer.pre)) yield* runtime.reactor.processBytes(wire);
      yield* runAgentRuntimeUntil(
        runtime,
        () =>
          reger.txnsb.escrowdb.get(["registry-ooo", vcp.pre!, issuer.pre]).length === 1
          && queries.at(-1)?.ri === vcp.pre && !runtime.querying.hasPendingDelivery,
        { hab: local, timeoutMs: 2_000, pollMailbox: false },
      );
      assertEquals(reger.txnsb.escrowdb.get(["registry-mae", vcp.pre!, issuer.pre]).length, 0);
      assertEquals(reger.txnsb.escrowdb.get(["registry-ooo", vcp.pre!, issuer.pre]).length, 1);
      assertExists(reger.txnsb.serderdb.get([serder.said!]), "Broker retains the pending authenticated body");
      assertEquals(hby.db.rpys.get([serder.said!]), null, "Pending proof has one external owner");
      assertEquals(queries.at(-1), { ri: vcp.pre!, i: "", src: issuer.pre }, "Recovery preserves TEL coordinates");
      yield* runtime.reactor.processBytes(source.cloneTvt(vcp.pre!, vcp.said!));
      yield* runAgentRuntimeUntil(runtime, () => reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64 === serder.said, {
        hab: local,
        timeoutMs: 2_000,
        pollMailbox: false,
      });
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, serder.said);
      assertEquals(reger.txnsb.escrowdb.cnt(), 0);
      issuer.rotate({ ncount: 1, nsith: "1", toad: 0 });
      const fresh = reply(`/tsn/registry/${issuer.pre}`, state, { pre: issuer.pre });
      yield* runtime.reactor.processBytes(issuer.endorse(fresh));
      assertEquals(
        reger.txnsb.escrowdb.get(["registry-mae", vcp.pre!, issuer.pre]).length,
        1,
        "Known issuer with missing future establishment remains owned by Broker",
      );
      assertEquals(hby.db.rpes.cnt(), 0, "External proof ownership does not double-index legacy RPE");
      for (const wire of sender.db.clonePreIter(issuer.pre, 2)) yield* runtime.reactor.processBytes(wire);
      yield* runAgentRuntimeUntil(runtime, () => reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64 === fresh.said, {
        hab: local,
        timeoutMs: 2_000,
        pollMailbox: false,
      });
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, fresh.said);
      assertEquals(reger.txnsb.escrowdb.cnt(), 0);
      yield* reger.close();
      yield* reger.reopen();
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, fresh.said, "Accepted notice survives reopen");
      assertEquals(warnings, [], "Dependency migration and successful recovery are not terminal ejections");
    } finally {
      consoleLogger.warn = warn;
      yield* runtime.close();
      yield* hby.close(true);
      yield* source.close(true);
      yield* sender.close(true);
    }
  });
});

Deno.test("registry TSN partial proof ownership stays in finite Broker retry", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = hby.makeHab("issuer", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    const reger = runtime.vdr!.reger! as Reger, tvy = runtime.vdr!.tvy! as Tevery;
    try {
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const serder = reply(`/tsn/registry/${issuer.pre}`, tvy.tevers.get(vcp.pre!)!.state().asDict(), {
        pre: issuer.pre,
      });
      const est = hby.db.getEvtSerder(issuer.pre, hby.db.kels.getLast(issuer.pre, 0)!)!;
      const signatures = issuer.sign(serder.raw, true);
      const wire = (index: number) =>
        messagize(serder, {
          sigers: [signatures[index]],
          seal: { i: issuer.kever!.prefixer, s: est.sner!, d: new Diger({ qb64: est.said! }) },
        });
      yield* runtime.reactor.processBytes(wire(0));
      yield* runtime.protocol.processEscrowsOnce();
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre]), null);
      assertEquals(reger.txnsb.escrowdb.get(["registry-mae", vcp.pre!, issuer.pre]).length, 1);
      assertEquals(hby.db.rpes.cnt(), 0);
      assertEquals(hby.db.ssgs.cnt(), 0, "Unaccepted signature pool stays with its explicit Broker owner");
      yield* runtime.reactor.processBytes(wire(1));
      yield* runtime.protocol.processEscrowsOnce();
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, serder.said);
      assertEquals(reger.txnsb.escrowdb.cnt(), 0);
      assertEquals(hby.db.rpes.cnt(), 0);
      assertRuntimeCue(runtime, "txnStateSaved");
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("credential TSN verifies current commitment, independent attester and proof ownership", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = hby.makeHab("issuer"), outsider = hby.makeHab("outsider", undefined, { transferable: false });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    const reger = runtime.vdr!.reger! as Reger, tvy = runtime.vdr!.tvy! as Tevery;
    try {
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const credential = makeCredential(issuer.pre), iss = issue(credential.said!, vcp.pre!);
      assertEquals(tvy.processEvent({ serder: iss, ...anchorTel(issuer, iss) }).kind, "accept");
      const state = tvy.tevers.get(vcp.pre!)!.vcState(credential.said!)!.asDict();
      const oldStamp = makeNowIso8601().replace(/0\+00:00$/, "1+00:00"),
        stamp = oldStamp.replace(/1\+00:00$/, "2+00:00");
      const notice = (data = state, at = stamp, author = issuer) =>
        reply(`/tsn/credential/${author.pre}`, data, { pre: author.pre, stamp: at });
      const valid = notice();
      yield* runtime.reactor.processBytes(issuer.endorse(valid));
      assertEquals(reger.txnsb.current([credential.said!, issuer.pre])?.qb64, valid.said);
      assertRuntimeCue(runtime, "txnStateSaved");
      const ownedCues = new Deck<AgentCue>();
      const notices = new Tevery({ db: hby.db, reger, rvy: new Revery(hby.db, { cues: ownedCues }) });
      const est = hby.db.getEvtSerder(issuer.pre, hby.db.kels.getLast(issuer.pre, 0)!)!;
      const args = (serder: ReturnType<typeof reply>) => ({
        serder,
        diger: new Diger({ qb64: serder.said! }),
        route: serder.route!,
        aid: issuer.pre,
        cigars: [],
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: issuer.pre }),
            est.sner!,
            new Diger({ qb64: est.said! }),
            issuer.sign(serder.raw, true),
          ),
        ],
      });
      const incoming = args(notice(state, stamp.replace(/2\+00:00$/, "7+00:00")));
      const unchanged = () => {
        assertEquals(reger.txnsb.current([credential.said!, issuer.pre])?.qb64, valid.said);
        assertExists(hby.db.rpys.get([valid.said!]));
        assertEquals(hby.db.rpys.get([incoming.diger.qb64]), null);
        assertEquals(hby.db.sdts.get([incoming.diger.qb64]), null);
        assertEquals([...hby.db.ssgs.getTopItemIter([incoming.diger.qb64], { topive: true })], []);
        assertEquals(reger.txnsb.serderdb.get([incoming.diger.qb64]), null);
        assertEquals(reger.txnsb.daterdb.get([incoming.diger.qb64]), null);
        assertEquals(reger.txnsb.escrowdb.cnt(), 0);
        assertEquals(ownedCues.length, 0);
      };
      unchanged();
      assertEquals(notices.processReplyCredentialTxnState(args(valid)).kind, "accept");
      assertEquals(ownedCues.pull()?.kin, "txnStateSaved");
      yield* runtime.reactor.processBytes(issuer.endorse(notice(state, oldStamp)));
      yield* runtime.reactor.processBytes(outsider.endorse(notice()));
      yield* runtime.reactor.processBytes(outsider.endorse(notice(state, stamp, outsider)));
      assertEquals(reger.txnsb.current([credential.said!, outsider.pre]), null);
      assertEquals(runtime.cues.length, 0);
      for (
        const data of [
          { ...state, d: vcp.said },
          { ...state, s: "20000000000001" },
          {
            ...state,
            a: { ...(state.a as Record<string, unknown>), s: Number((state.a as Record<string, unknown>).s) + 1 },
          },
          { ...state, et: "rev" },
          { ...state, ra: { i: vcp.pre, s: "0", d: vcp.said } },
        ]
      ) {
        const wrong = notice(data, stamp.replace(/2\+00:00$/, "3+00:00"));
        yield* runtime.reactor.processBytes(issuer.endorse(wrong));
        assertEquals(hby.db.rpys.get([wrong.said!]), null, "Rejected proof has no orphan Baser owner");
        assertEquals(hby.db.sdts.get([wrong.said!]), null);
        assertEquals([...hby.db.ssgs.getTopItemIter([wrong.said!], { topive: true })].length, 0);
      }
      assertEquals(reger.txnsb.current([credential.said!, issuer.pre])?.qb64, valid.said);
      assertExists(hby.db.sdts.get([valid.said!]), "Accepted BADA proof survives semantic rejection");
      const other = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: other, ...anchorTel(issuer, other) }).kind, "accept");
      const crossRegistry = notice({ ...state, ri: other.pre }, stamp.replace(/2\+00:00$/, "4+00:00"));
      yield* runtime.reactor.processBytes(issuer.endorse(crossRegistry));
      assertEquals(hby.db.rpys.get([crossRegistry.said!]), null);
      const habRecord = hby.db.getHab(issuer.pre)!;
      habRecord.watchers = [outsider.pre];
      hby.db.habs.pin(issuer.pre, habRecord);
      const watcher = notice(state, stamp, outsider);
      yield* runtime.reactor.processBytes(outsider.endorse(watcher));
      assertEquals(reger.txnsb.current([credential.said!, outsider.pre])?.qb64, watcher.said);
      assertRuntimeCue(runtime, "txnStateSaved");
      const rev = revoke(credential.said!, vcp.pre!, iss.said!);
      assertEquals(tvy.processEvent({ serder: rev, ...anchorTel(issuer, rev) }).kind, "accept");
      yield* runtime.protocol.processEscrowsOnce();
      assertRuntimeCue(runtime, "revoked");
      const stale = notice(state, stamp.replace(/2\+00:00$/, "5+00:00"));
      yield* runtime.reactor.processBytes(issuer.endorse(stale));
      assertEquals(
        reger.txnsb.current([credential.said!, issuer.pre])?.qb64,
        valid.said,
        "Accepted revocation blocks old issuance replay",
      );
      assertEquals(hby.db.rpys.get([stale.said!]), null);
      const revoked = notice(
        tvy.tevers.get(vcp.pre!)!.vcState(credential.said!)!.asDict(),
        stamp.replace(/2\+00:00$/, "6+00:00"),
      );
      yield* runtime.reactor.processBytes(issuer.endorse(revoked));
      assertEquals(reger.txnsb.current([credential.said!, issuer.pre])?.qb64, revoked.said);
      assertEquals(
        hby.db.rpys.get([valid.said!]),
        null,
        "Replacement releases old accepted proof only after publication",
      );
      assertRuntimeCue(runtime, "txnStateSaved");
      const backed = inceptRegistry(issuer.pre, { baks: [outsider.pre], toad: 1 });
      assertEquals(
        tvy.processEvent({ serder: backed, ...anchorTel(issuer, backed), wigers: outsider.sign(backed.raw, true) })
          .kind,
        "accept",
      );
      const otherCredential =
        new Diger({ code: "E", raw: Diger.digest(new TextEncoder().encode("backed credential"), "E") }).qb64;
      const bis = backerIssue(otherCredential, backed.pre!, 0, backed.said!);
      assertEquals(
        tvy.processEvent({ serder: bis, ...anchorTel(issuer, bis), wigers: outsider.sign(bis.raw, true) }).kind,
        "accept",
      );
      habRecord.watchers = [];
      hby.db.habs.pin(issuer.pre, habRecord);
      const backedNotice = notice(tvy.tevers.get(backed.pre!)!.vcState(otherCredential)!.asDict(), stamp, outsider);
      yield* runtime.reactor.processBytes(outsider.endorse(backedNotice));
      assertEquals(
        reger.txnsb.current([otherCredential, outsider.pre])?.qb64,
        backedNotice.said,
        "Accepted backers authenticate independent credential notice",
      );
      assertRuntimeCue(runtime, "txnStateSaved");
      yield* reger.close();
      let failure: unknown;
      try {
        yield* runtime.reactor.processBytes(issuer.endorse(revoked));
      } catch (error) {
        failure = error;
      }
      assertEquals(failure instanceof Error && failure.message.includes("not open"), true);
      yield* reger.reopen();
      yield* runtime.reactor.processBytes(issuer.endorse(revoked));
      assertEquals(
        reger.txnsb.current([credential.said!, issuer.pre])?.qb64,
        revoked.said,
        "Notice replay survives reopen",
      );
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
Deno.test("credential TSN missing registry, TEL and partial proofs retry through the runtime", async () => {
  await run(function*() {
    const sender = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = sender.makeHab("issuer", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const source = yield* createReger({ name: crypto.randomUUID(), temp: true });
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock),
      reger = runtime.vdr!.reger! as Reger;
    try {
      const tvy = new Tevery({ db: sender.db, reger: source });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const credential = makeCredential(issuer.pre), iss = issue(credential.said!, vcp.pre!);
      assertEquals(tvy.processEvent({ serder: iss, ...anchorTel(issuer, iss) }).kind, "accept");
      const notice = reply(
        `/tsn/credential/${issuer.pre}`,
        tvy.tevers.get(vcp.pre!)!.vcState(credential.said!)!.asDict(),
        { pre: issuer.pre },
      );
      const cues = new Deck<AgentCue>();
      const owned = new Tevery({ db: hby.db, reger, rvy: new Revery(hby.db, { cues }) });
      const first = sender.db.getEvtSerder(issuer.pre, sender.db.kels.getLast(issuer.pre, 0)!)!;
      const incoming = {
        serder: notice,
        diger: new Diger({ qb64: notice.said! }),
        route: notice.route!,
        aid: issuer.pre,
        cigars: [],
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: issuer.pre }),
            first.sner!,
            new Diger({ qb64: first.said! }),
            issuer.sign(notice.raw, true),
          ),
        ],
      };
      for (const et of [["iss"], null]) {
        const malformed = reply(`/tsn/credential/${issuer.pre}`, {
          ...tvy.tevers.get(vcp.pre!)!.vcState(credential.said!)!.asDict(),
          et,
        }, { pre: issuer.pre });
        yield* runtime.reactor.processBytes(issuer.endorse(malformed));
        assertEquals(reger.txnsb.escrowdb.cnt(), 0, "Malformed kinds must not acquire dependency escrow");
        assertEquals(reger.txnsb.serderdb.get([malformed.said!]), null);
        assertEquals(reger.txnsb.daterdb.get([malformed.said!]), null);
        assertEquals(hby.db.rpys.get([malformed.said!]), null);
        assertEquals(runtime.cues.length, 0);
      }
      yield* runtime.reactor.processBytes(issuer.endorse(notice));
      assertEquals(reger.txnsb.escrowdb.get(["credential-mre", credential.said!, issuer.pre]).length, 1);
      assertRuntimeCue(runtime, {
        kin: "query",
        pre: issuer.pre,
        src: issuer.pre,
        route: "tels",
        q: { ri: vcp.pre!, i: "" },
      });
      assertEquals(owned.processReplyCredentialTxnState(incoming), {
        kind: "unverified",
        reason: "dependencyPending",
        family: "credential-mre",
        message: "Credential state dependency unavailable.",
      });
      assertEquals(cues.length, 0);
      assertEquals(reger.txnsb.escrowdb.cnt(), 1);
      for (const wire of sender.db.clonePreIter(issuer.pre)) yield* runtime.reactor.processBytes(wire);
      assertEquals([...runtime.cues].map((cue) => cue.kin), [
        "receipt",
        "receipt",
        "receipt",
      ]);
      runtime.cues.clear();
      yield* runtime.reactor.processBytes(source.cloneTvt(vcp.pre!, vcp.said!));
      yield* runtime.protocol.processEscrowsOnce();
      assertEquals(reger.txnsb.escrowdb.get(["credential-mre", credential.said!, issuer.pre]).length, 0);
      assertEquals(reger.txnsb.escrowdb.get(["credential-ooo", credential.said!, issuer.pre]).length, 1);
      assertRuntimeCue(runtime, {
        kin: "query",
        pre: issuer.pre,
        src: issuer.pre,
        route: "tels",
        q: { ri: vcp.pre!, i: credential.said! },
      });
      assertExists(reger.txnsb.serderdb.get([notice.said!]));
      assertEquals(hby.db.rpys.get([notice.said!]), null, "Pending proof belongs only to Broker");
      yield* runtime.reactor.processBytes(source.cloneTvt(iss.pre!, iss.said!));
      yield* runtime.protocol.processEscrowsOnce();
      assertEquals(reger.txnsb.current([credential.said!, issuer.pre])?.qb64, notice.said);
      assertEquals(reger.txnsb.escrowdb.cnt(), 0);
      assertRuntimeCue(runtime, "txnStateSaved");
      issuer.rotate({ ncount: 2, nsith: "2" });
      const fresh = reply(`/tsn/credential/${issuer.pre}`, notice.ked!.a as Record<string, unknown>, {
        pre: issuer.pre,
      });
      const est = issuer.kever!.serder, signatures = issuer.sign(fresh.raw, true);
      const wire = (index: number) =>
        messagize(fresh, {
          sigers: [signatures[index]],
          seal: { i: issuer.kever!.prefixer, s: est.sner!, d: new Diger({ qb64: est.said! }) },
        });
      yield* runtime.reactor.processBytes(wire(0));
      assertEquals(reger.txnsb.escrowdb.get(["credential-mae", credential.said!, issuer.pre]).length, 1);
      assertEquals(hby.db.rpes.cnt(), 0);
      for (const bytes of sender.db.clonePreIter(issuer.pre, issuer.kever!.sn)) {
        yield* runtime.reactor.processBytes(bytes);
      }
      yield* runtime.protocol.processEscrowsOnce();
      assertEquals(
        reger.txnsb.current([credential.said!, issuer.pre])?.qb64,
        notice.said,
        "One signature cannot satisfy threshold two",
      );
      assertExists(hby.db.rpys.get([notice.said!]), "Prior accepted proof remains in Baser");
      assertEquals([...hby.db.ssgs.getTopItemIter([fresh.said!], { topive: true })].length, 0);
      yield* runtime.reactor.processBytes(wire(1));
      yield* runtime.protocol.processEscrowsOnce();
      assertEquals(reger.txnsb.current([credential.said!, issuer.pre])?.qb64, fresh.said);
      assertEquals(reger.txnsb.escrowdb.cnt(), 0);
      assertEquals(hby.db.rpes.cnt(), 0);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
      yield* source.close(true);
      yield* sender.close(true);
    }
  });
});
Deno.test("TSN runtime query delivers ordered replies with independent credential acceptance", async () => {
  await run(function*() {
    const sender = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = sender.makeHab("issuer"),
      runtime = yield* createAgentRuntime(sender, new FetchHttpClient(), systemClock);
    const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const requester = receiver.makeHab("requester"),
      target = yield* createAgentRuntime(receiver, new FetchHttpClient(), systemClock);
    const reger = runtime.vdr!.reger! as Reger,
      tvy = runtime.vdr!.tvy! as Tevery,
      received = target.vdr!.reger! as Reger;
    try {
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const credential = makeCredential(issuer.pre), iss = issue(credential.said!, vcp.pre!);
      assertEquals(tvy.processEvent({ serder: iss, ...anchorTel(issuer, iss) }).kind, "accept");
      for (const bytes of sender.db.clonePreIter(issuer.pre)) yield* target.reactor.processBytes(bytes);
      for (const event of [vcp, iss]) yield* target.reactor.processBytes(reger.cloneTvt(event.pre!, event.said!));
      const queryWire = requester.query(issuer.pre, issuer.pre, {
        route: "tsn",
        q: { ri: vcp.pre!, i: credential.said! },
      });
      yield* runtime.reactor.processBytes(queryWire);
      const cues = runtime.cues.toArray();
      runtime.cues.clear();
      {
        const replies = [...issuer.processCuesIter(cues)];
        assertEquals(
          cues.map((cue) => [cue.kin, cue.kin === "reply" ? cue.dest : undefined]),
          [["reply", requester.pre], [
            "reply",
            requester.pre,
          ]],
        );
        const bodies = [];
        for (const msg of replies) {
          const [frame] = yield* call(() => parseBytes(msg));
          {
            bodies.push(envelopeFromFrame(frame).serder);
          }
        }
        assertEquals(bodies.map((body) => body.route), [
          `/tsn/registry/${issuer.pre}`,
          `/tsn/credential/${issuer.pre}`,
        ]);
        yield* target.reactor.processBytes(replies[0]);
        assertEquals(received.txnsb.current([vcp.pre!, issuer.pre])?.qb64, bodies[0].said);
        assertEquals(
          received.txnsb.current([credential.said!, issuer.pre]),
          null,
          "Registry reply cannot authenticate child state",
        );
        yield* target.reactor.processBytes(requester.endorse(bodies[1]));
        assertEquals(
          received.txnsb.current([credential.said!, issuer.pre]),
          null,
          "Foreign proof cannot authenticate credential attester",
        );
        yield* target.reactor.processBytes(replies[1]);
        assertEquals(received.txnsb.current([credential.said!, issuer.pre])?.qb64, bodies[1].said);
        yield* received.close();
        yield* received.reopen();
        yield* target.reactor.processBytes(replies[1]);
        assertEquals(received.txnsb.current([credential.said!, issuer.pre])?.qb64, bodies[1].said);
      }
      yield* runtime.reactor.processBytes(
        requester.query(issuer.pre, issuer.pre, { route: "tsn", q: { ri: vcp.pre!, i: requester.pre } }),
      );
      assertEquals(
        runtime.cues.toArray().map((cue) => cue.kin),
        ["reply"],
        "Unknown credential keeps registry response only",
      );
      runtime.cues.clear();
      tvy.processQuery({
        serder: query("tsn", { ri: vcp.pre!, i: credential.said! }),
        source: requester.kever!.prefixer,
      });
      yield* runtime.protocol.processEscrowsOnce();
      assertEquals(runtime.cues.toArray().map((cue) => cue.kin), ["reply", "reply"]);
    } finally {
      yield* target.close();
      yield* receiver.close(true);
      yield* runtime.close();
      yield* sender.close(true);
    }
  });
});

Deno.test("backer cohorts require accepted management coordinates and retain historical rosters", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const old = hby.makeHab("old-backer", undefined, { transferable: false });
      const next = hby.makeHab("new-backer", undefined, { transferable: false });
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(issuer.pre, { baks: [old.pre], toad: 1 });
      assertEquals(
        tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp), wigers: old.sign(vcp.raw, true) }).kind,
        "accept",
      );
      const vrt = rotateRegistry(vcp.pre!, vcp.said!, { baks: [old.pre], cuts: [old.pre], adds: [next.pre], toad: 1 });
      // Staging records the rotated roster, but neither its body nor roster is accepted authority.
      assertEquals(tvy.processEvent({ serder: vrt, wigers: next.sign(vrt.raw, true) }).kind, "escrow");
      assertEquals(reger.baks.get(dgKey(vrt.pre!, vrt.said!)), [next.pre]);
      const credential = makeCredential(issuer.pre);
      const bis = backerIssue(credential.said!, vcp.pre!, 1, vrt.said!);
      const anchored = anchorTel(issuer, bis);
      const pending = tvy.processEvent({ serder: bis, ...anchored, wigers: next.sign(bis.raw, true) });
      assertEquals(pending.kind === "escrow" && pending.escrow, "outOfOrder");
      assertEquals(reger.tels.getOn(bis.pre!, 0), null);
      assertEquals(tvy.processEvent({ serder: vrt, ...anchorTel(issuer, vrt) }).kind, "accept");
      tvy.processEscrows();
      assertEquals(reger.tels.getOn(bis.pre!, 0)?.qb64, bis.said);
      assertEquals(reger.oots.getOn(bis.pre!, 0), []);

      // Reuse a historical cohort after rotation; a sequence/digest mismatch is not that cohort.
      const other = new SerderACDC({
        sad: { d: "", i: issuer.pre, s: SCHEMA_SAID, a: { name: "other" } },
        makify: true,
      });
      const mismatched = backerIssue(other.said!, vcp.pre!, 1, vcp.said!);
      assertEquals(
        tvy.processEvent({
          serder: mismatched,
          ...anchorTel(issuer, mismatched),
          wigers: old.sign(mismatched.raw, true),
        }).kind,
        "reject",
      );
      const historic = backerIssue(other.said!, vcp.pre!, 0, vcp.said!);
      assertEquals(
        tvy.processEvent({ serder: historic, ...anchorTel(issuer, historic), wigers: old.sign(historic.raw, true) })
          .kind,
        "accept",
      );
      const brv = backerRevoke(other.said!, vcp.pre!, 1, vrt.said!, historic.said!);
      assertEquals(
        tvy.processEvent({ serder: brv, ...anchorTel(issuer, brv), wigers: next.sign(brv.raw, true) }).kind,
        "accept",
      );
      assertEquals(tvy.tevers.get(vcp.pre!)!.vcState(other.said!)?.et, "brv");
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("backer contributions accumulate by verified index across reopen and escrow retry", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const backers = [0, 1, 2].map((i) => hby.makeHab(`backer-${i}`, undefined, { transferable: false }));
      const vcp = inceptRegistry(issuer.pre, { baks: backers.map((hab) => hab.pre), toad: 2 });
      const source = anchorTel(issuer, vcp);
      const sigs = backers.map((hab, index) => {
        const signature = hab.sign(vcp.raw, true)[0];
        return new Siger({ code: signature.code, raw: signature.raw, index });
      });
      let tvy = new Tevery({ db: hby.db, reger });
      const first = tvy.processEvent({ serder: vcp, ...source, wigers: [sigs[0], sigs[0]] });
      assertEquals(first.kind === "escrow" && first.escrow, "partialWitness");
      assertEquals(reger.tibs.get(dgKey(vcp.pre!, vcp.said!)).map((sig) => sig.index), [0]);
      yield* reger.reopen();
      tvy = new Tevery({ db: hby.db, reger });
      tvy.processEscrows();
      assertEquals(reger.tels.getOn(vcp.pre!, 0), null);
      assertEquals(reger.twes.getOn(vcp.pre!, 0), [vcp.said]);
      // The real second contribution alone must complete the event; repeat index zero is not quorum.
      const replay = tvy.processEvent({ serder: vcp, ...source, wigers: [sigs[0]] });
      assertEquals(replay.kind === "escrow" && replay.escrow, "partialWitness");
      assertEquals(tvy.processEvent({ serder: vcp, ...source, wigers: [sigs[1]] }).kind, "accept");
      assertEquals(reger.tibs.get(dgKey(vcp.pre!, vcp.said!)).map((sig) => sig.index), [0, 1]);
      tvy.processEscrows();
      assertEquals(reger.twes.getOn(vcp.pre!, 0), []);
      assertEquals(tvy.processEvent({ serder: vcp, wigers: [sigs[2]] }).kind, "duplicate");
      assertEquals(reger.tibs.get(dgKey(vcp.pre!, vcp.said!)).map((sig) => sig.index), [0, 1, 2]);
      yield* reger.reopen();
      assertEquals(reger.tels.getOn(vcp.pre!, 0)?.qb64, vcp.said);
      assertEquals(reger.tibs.get(dgKey(vcp.pre!, vcp.said!)).map((sig) => sig.index), [0, 1, 2]);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("backer endorses anchored evidence before quorum and reuses the durable receipt after reopen", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const first = hby.makeHab("first", undefined, { transferable: false });
      const second = hby.makeHab("second", undefined, { transferable: false });
      const outsider = hby.makeHab("outsider", undefined, { transferable: false });
      const requests = new Deck<BackerRequest>();
      let tvy = new Tevery({ db: hby.db, reger, backerRequests: requests });
      let backer = new Backer(second, reger);
      assertThrows(() => new Backer(issuer, reger), ValidationError);
      const vcp = inceptRegistry(issuer.pre, { baks: [first.pre, second.pre], toad: 2 });
      tvy.processEvent({ serder: vcp });
      assertEquals(requests.length, 0);
      const source = anchorTel(issuer, vcp);
      const pending = tvy.processEvent({ serder: vcp, ...source });
      assertEquals(pending.kind === "escrow" && pending.escrow, "partialWitness");
      const request = requests.pull()!;
      assertEquals(new Backer(outsider, reger).endorse(request).kind, "skip");
      const result = backer.endorse(request);
      assertEquals(result.kind, "contribution");
      if (result.kind !== "contribution") throw new Error("Expected backer contribution");
      assertEquals(result.issuer, issuer.pre);
      assertEquals(result.signature.index, 1);
      assertEquals(reger.bens.getOn([second.pre, vcp.pre!], 0)?.qb64, vcp.said);
      assertEquals(reger.tels.getOn(vcp.pre!, 0), null);
      const parsed = envelopeFromFrame(parseBytes(result.message)[0], false);
      assertEquals(parsed.wigers.map((sig) => sig.qb64), [result.signature.qb64]);
      tvy.processEscrows();
      while (!requests.empty) assertEquals(backer.endorse(requests.pull()!).kind, "skip");
      yield* reger.reopen();
      tvy = new Tevery({ db: hby.db, reger, backerRequests: requests });
      backer = new Backer(second, reger);
      tvy.processEvent({ serder: vcp, ...source });
      const replay = backer.endorse(requests.pull()!);
      assertEquals(replay.kind === "contribution" && replay.signature.qb64, result.signature.qb64);
      const firstSig = first.sign(vcp.raw, true)[0];
      assertEquals(tvy.processEvent({ serder: vcp, ...source, wigers: [firstSig, result.signature] }).kind, "accept");
      assertEquals(backer.endorse(requests.pull()!).kind, "skip");
      assertEquals(reger.tels.getOn(vcp.pre!, 0)?.qb64, vcp.said);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

Deno.test("backer refuses a second anchored digest at its endorsed coordinate after reopen", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const reger = yield* createReger({ name: crypto.randomUUID(), temp: true });
    try {
      const issuer = hby.makeHab("issuer");
      const habs = [0, 1, 2].map((i) => hby.makeHab(`backer-${i}`, undefined, { transferable: false }));
      const baks = habs.map((hab) => hab.pre);
      const vcp = inceptRegistry(issuer.pre, { baks, toad: 2 });
      const proofs = habs.slice(0, 2).map((hab, index) => {
        const sig = hab.sign(vcp.raw, true)[0];
        return new Siger({ code: sig.code, raw: sig.raw, index });
      });
      const requests = new Deck<BackerRequest>();
      let tvy = new Tevery({ db: hby.db, reger, backerRequests: requests });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp), wigers: proofs }).kind, "accept");
      requests.clear();
      const original = rotateRegistry(vcp.pre!, vcp.said!, { baks, toad: 2 });
      tvy.processEvent({ serder: original, ...anchorTel(issuer, original) });
      assertEquals(new Backer(habs[0], reger).endorse(requests.pull()!).kind, "contribution");
      yield* reger.reopen();
      tvy = new Tevery({ db: hby.db, reger, backerRequests: requests });
      const conflicting = rotateRegistry(vcp.pre!, vcp.said!, { baks, toad: 3 });
      const pending = tvy.processEvent({ serder: conflicting, ...anchorTel(issuer, conflicting) });
      assertEquals(pending.kind === "escrow" && pending.escrow, "partialWitness");
      const result = new Backer(habs[0], reger).endorse(requests.pull()!);
      assertEquals(result.kind, "reject");
      assertEquals(reger.bens.getOn([habs[0].pre, vcp.pre!], 1)?.qb64, original.said);
      assertEquals(reger.tibs.get(dgKey(conflicting.pre!, conflicting.said!)), []);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});
