import { call, run } from "effection";
import { assertEquals, assertExists, assertThrows } from "jsr:@std/assert";
import {
  Diger,
  discardFrame,
  NumberPrimitive,
  NumDex,
  parseBytes,
  Prefixer,
  SerderACDC,
  SerderKERI,
  TraitDex,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { type AgentRuntime, createAgentRuntime, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { createHabery, type Hab } from "../../../src/app/habbing.ts";
import { envelopeFromFrame, queryEnvelopeFromDispatch } from "../../../src/app/parsering.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { query, reply } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import {
  backerIssue,
  backerRevoke,
  incept as inceptRegistry,
  issue,
  revoke,
} from "../../../src/core/protocol-vdr-eventing.ts";
import { Revery } from "../../../src/core/routing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { createReger, type Reger } from "../../../src/db/reger.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import { CredentialStateReceiver } from "../../../src/vdr/credential-tsn.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";
import { RegistryStateReceiver } from "../../../src/vdr/registry-tsn.ts";
import { prepareTsnQuery } from "../../../src/vdr/tsn-query.ts";
import { expectKind } from "../../private-access.ts";

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

      tvy.processEscrows();
      assertEquals(reger.oots.getOn(iss.pre!, 0), []);
      assertEquals(reger.tels.getOn(iss.pre!, 0)?.qb64, iss.said);
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
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
    const runtime = yield* createAgentRuntime(hby);
    const reger = runtime.vdr.reger! as Reger, tvy = runtime.vdr.tvy! as Tevery;
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
        const reply = runtime.reactor.replies.reserve(request.said!);
        try {
          const wire = messagize(request, {
            sigers: issuer.sign(request.raw, true),
            seal: { i: new Prefixer({ qb64: issuer.pre }) },
            gvrsn: pvrsn,
          });
          yield* runtime.reactor.processBytes(wire);
          runtime.reactor.replies.capture(runtime.cues);
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
          responses.push(cue.messages);
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
            try {
              const envelope = envelopeFromFrame(frame);
              assertEquals(envelope.serder.raw, [vcp, iss][index].raw);
              assertEquals(envelope.lastSsc?.s.num, anchors[index].seqner.num);
              assertEquals(envelope.lastSsc?.d.qb64, anchors[index].saider.qb64);
              assertEquals(frame.gvrsn?.major, 2);
            } finally {
              yield* call(() => discardFrame(frame));
            }
          }
        }
      }
      assertRuntimeCue(runtime, "revoked", "Accepted later revocation keeps its independent cue");
      const request = (ri = vcp.pre!, i = "", route = "tels") =>
        query(route, { ri, src: issuer.pre, i }, { pre: issuer.pre, pvrsn: Vrsn_2_0 });
      const source = new Prefixer({ qb64: issuer.pre });
      assertEquals(tvy.processQuery({ serder: request(), source }), undefined);
      assertRuntimeCue(runtime, "replay");
      tvy.processQuery({ serder: request(vcp.pre!, vcp.pre!), source });
      const duplicate = runtime.cues.pull();
      if (duplicate?.kin !== "replay") throw new Error("Expected duplicate TEL replay");
      const first = [...responses[0]][0];
      assertEquals([...duplicate.messages], [first, first], "Repeated ranges preserve management/credential order");
      assertEquals(tvy.processQuery({ serder: request(issuer.pre), source }), undefined);
      assertEquals(runtime.cues.length, 0, "Unknown TEL has no response or query escrow");
      assertEquals(tvy.processQuery({ serder: request(), source: undefined }), {
        kind: "drop",
        reason: "missingAuthentication",
      });
      assertEquals(tvy.processQuery({ serder: request(""), source }), { kind: "drop", reason: "invalidQuery" });
      for (const q of [null, false, "query", [], { ri: vcp.pre!, i: "" }, { ri: vcp.pre!, src: issuer.pre, i: 0 }]) {
        const malformed = new SerderKERI({ sad: { ...request().ked, q }, makify: true });
        assertEquals(tvy.processQuery({ serder: malformed, source }), { kind: "drop", reason: "invalidQuery" });
      }
      assertEquals(runtime.cues.length, 0);
      assertEquals(tvy.processQuery({ serder: request(vcp.pre!, "", "tsn"), source }), undefined);
      assertRuntimeCue(runtime, "reply");
      const unsigned = hby.makeHab("nontransferable", undefined, { transferable: false });
      const serder = request();
      assertEquals(tvy.processQuery({ serder, cigars: unsigned.sign(serder.raw, false) }), undefined);
      assertRuntimeCue(runtime, "replay");
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
      try {
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
      } finally {
        yield* call(() => discardFrame(frame));
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
    const tvy = new Tevery({ db: hby.db, reger });
    const runtime = yield* createAgentRuntime(hby, { vdr: { reger, tvy } });
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
      ) yield* runtime.reactor.processBytes(issuer.endorse(malformed));
      assertEquals(reger.txnsb.escrowdb.cnt(), 0, "Malformed qualified coordinates never reach storage");
      assertEquals(runtime.cues.length, 0);
      const habRecord = hby.db.getHab(issuer.pre)!;
      habRecord.watchers = [outsider.pre];
      hby.db.habs.pin(issuer.pre, habRecord);
      const watcher = notice(state, newStamp, outsider);
      yield* runtime.reactor.processBytes(outsider.endorse(watcher));
      assertEquals(reger.txnsb.current([vcp.pre!, outsider.pre])?.qb64, watcher.said);
      const notification = runtime.cues.pull()!;
      assertEquals([...issuer.processCuesIter([notification])].map((emission) => [emission.kind, emission.cue.kin]), [
        ["notify", "txnStateSaved"],
      ]);
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
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const state = tvy.tevers.get(vcp.pre!)!.state().asDict();
      const est = hby.db.getEvtSerder(issuer.pre, hby.db.kels.getLast(issuer.pre, 0)!)!;
      const stamp = makeNowIso8601().replace(/0\+00:00$/, "1+00:00");
      const cues = new Deck<AgentCue>();
      const rvy = new Revery(hby.db, { cues }), receiver = new RegistryStateReceiver(tvy, rvy);
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
      assertEquals(receiver.processReply(prior).kind, "accept");
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
      assertEquals(receiver.processReply(incoming).kind, "accept");
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, incoming.diger.qb64);
      assertEquals(hby.db.rpys.get([prior.diger.qb64]), null);
      assertEquals(cues.pull()?.kin, "txnStateSaved");

      const target = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const pendingReger = yield* createReger({ name: crypto.randomUUID(), temp: true });
      try {
        const pendingCues = new Deck<AgentCue>();
        const pending = new RegistryStateReceiver(
          new Tevery({ db: target.db, reger: pendingReger }),
          new Revery(target.db, { cues: pendingCues }),
        );
        assertEquals(pending.processReply(incoming), {
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
          pending.processReply(incoming),
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

Deno.test("registry TSN missing issuer and TEL retry through the normal runtime turn", async () => {
  await run(function*() {
    const sender = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const issuer = sender.makeHab("issuer");
    const source = yield* createReger({ name: crypto.randomUUID(), temp: true });
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const local = hby.makeHab("receiver");
    const runtime = yield* createAgentRuntime(hby);
    const reger = runtime.vdr.reger! as Reger;
    try {
      const tvy = new Tevery({ db: sender.db, reger: source });
      const vcp = inceptRegistry(issuer.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(issuer, vcp) }).kind, "accept");
      const state = tvy.tevers.get(vcp.pre!)!.state().asDict();
      const serder = reply(`/tsn/registry/${issuer.pre}`, state, { pre: issuer.pre });
      yield* runtime.reactor.processBytes(issuer.endorse(serder));
      assertEquals(reger.txnsb.escrowdb.get(["registry-mae", vcp.pre!, issuer.pre]).length, 1);
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre]), null);
      const queries: Record<string, unknown>[] = [];
      const turn = () =>
        processRuntimeTurn(runtime, {
          hab: local,
          pollMailbox: false,
          sink: {
            *send(emission) {
              if (emission.cue.kin === "query" && emission.kind === "wire") {
                for (const message of emission.messages) {
                  const [frame] = yield* call(() => parseBytes(message));
                  try {
                    queries.push(envelopeFromFrame(frame).serder.ked!.q as Record<string, unknown>);
                  } finally {
                    yield* call(() => discardFrame(frame));
                  }
                }
              }
            },
          },
        });
      yield* turn();
      assertEquals(queries[0].i, issuer.pre);
      for (const wire of sender.db.clonePreIter(issuer.pre)) yield* runtime.reactor.processBytes(wire);
      yield* turn();
      assertEquals(reger.txnsb.escrowdb.get(["registry-mae", vcp.pre!, issuer.pre]).length, 0);
      assertEquals(reger.txnsb.escrowdb.get(["registry-ooo", vcp.pre!, issuer.pre]).length, 1);
      assertExists(reger.txnsb.serderdb.get([serder.said!]), "Broker retains the pending authenticated body");
      assertEquals(hby.db.rpys.get([serder.said!]), null, "Pending proof has one external owner");
      assertEquals(queries.at(-1), { ri: vcp.pre!, i: "", src: issuer.pre }, "Recovery preserves TEL coordinates");
      yield* runtime.reactor.processBytes(source.cloneTvt(vcp.pre!, vcp.said!));
      yield* turn();
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
      yield* turn();
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, fresh.said);
      assertEquals(reger.txnsb.escrowdb.cnt(), 0);
      yield* reger.close();
      yield* reger.reopen();
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre])?.qb64, fresh.said, "Accepted notice survives reopen");
    } finally {
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
    const runtime = yield* createAgentRuntime(hby);
    const reger = runtime.vdr.reger! as Reger, tvy = runtime.vdr.tvy! as Tevery;
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
      yield* runtime.reactor.processEscrowsOnce();
      assertEquals(reger.txnsb.current([vcp.pre!, issuer.pre]), null);
      assertEquals(reger.txnsb.escrowdb.get(["registry-mae", vcp.pre!, issuer.pre]).length, 1);
      assertEquals(hby.db.rpes.cnt(), 0);
      assertEquals(hby.db.ssgs.cnt(), 0, "Unaccepted signature pool stays with its explicit Broker owner");
      yield* runtime.reactor.processBytes(wire(1));
      yield* runtime.reactor.processEscrowsOnce();
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
    const runtime = yield* createAgentRuntime(hby);
    const reger = runtime.vdr.reger! as Reger, tvy = runtime.vdr.tvy! as Tevery;
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
      const receiver = new CredentialStateReceiver(tvy, new Revery(hby.db, { cues: ownedCues }));
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
      assertEquals(receiver.processReply(args(valid)).kind, "accept");
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
    const runtime = yield* createAgentRuntime(hby), reger = runtime.vdr.reger! as Reger;
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
      const owned = new CredentialStateReceiver(runtime.vdr.tvy! as Tevery, new Revery(hby.db, { cues }));
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
      assertEquals(owned.processReply(incoming), {
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
        "keyStateSaved",
        "receipt",
        "keyStateSaved",
        "receipt",
        "keyStateSaved",
      ]);
      runtime.cues.clear();
      yield* runtime.reactor.processBytes(source.cloneTvt(vcp.pre!, vcp.said!));
      yield* runtime.reactor.processEscrowsOnce();
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
      yield* runtime.reactor.processEscrowsOnce();
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
      yield* runtime.reactor.processEscrowsOnce();
      assertEquals(
        reger.txnsb.current([credential.said!, issuer.pre])?.qb64,
        notice.said,
        "One signature cannot satisfy threshold two",
      );
      assertExists(hby.db.rpys.get([notice.said!]), "Prior accepted proof remains in Baser");
      assertEquals([...hby.db.ssgs.getTopItemIter([fresh.said!], { topive: true })].length, 0);
      yield* runtime.reactor.processBytes(wire(1));
      yield* runtime.reactor.processEscrowsOnce();
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
    const issuer = sender.makeHab("issuer"), runtime = yield* createAgentRuntime(sender);
    const receiver = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const requester = receiver.makeHab("requester"), target = yield* createAgentRuntime(receiver);
    const reger = runtime.vdr.reger! as Reger, tvy = runtime.vdr.tvy! as Tevery, received = target.vdr.reger! as Reger;
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
          replies.map((emission) => [emission.cue.kin, emission.cue.kin === "reply" ? emission.cue.dest : undefined]),
          [["reply", requester.pre], [
            "reply",
            requester.pre,
          ]],
        );
        const bodies = [];
        for (const emission of replies) {
          const [frame] = yield* call(() => parseBytes([...emission.messages][0]));
          try {
            bodies.push(envelopeFromFrame(frame).serder);
          } finally {
            yield* call(() => discardFrame(frame));
          }
        }
        assertEquals(bodies.map((body) => body.route), [
          `/tsn/registry/${issuer.pre}`,
          `/tsn/credential/${issuer.pre}`,
        ]);
        yield* target.reactor.processBytes([...replies[0].messages][0]);
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
        yield* target.reactor.processBytes([...replies[1].messages][0]);
        assertEquals(received.txnsb.current([credential.said!, issuer.pre])?.qb64, bodies[1].said);
        yield* received.close();
        yield* received.reopen();
        yield* target.reactor.processBytes([...replies[1].messages][0]);
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
      assertEquals(runtime.cues.toArray().map((cue) => cue.kin), ["reply", "reply"]);
    } finally {
      yield* target.close();
      yield* receiver.close(true);
      yield* runtime.close();
      yield* sender.close(true);
    }
  });
});
