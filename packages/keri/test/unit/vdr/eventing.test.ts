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
  TraitDex,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery, type Hab } from "../../../src/app/habbing.ts";
import { envelopeFromFrame, queryEnvelopeFromDispatch } from "../../../src/app/parsering.ts";
import { query } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { incept as inceptRegistry, issue, revoke } from "../../../src/core/protocol-vdr-eventing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { createReger, type Reger } from "../../../src/db/reger.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";
import { prepareTsnQuery } from "../../../src/vdr/tsn-query.ts";

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

Deno.test("vdr/eventing - records issue and revoke credential state", async () => {
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
      const tvy = new Tevery({ db: hby.db, reger });
      const vcp = inceptRegistry(hab.pre, { cnfg: [TraitDex.NoBackers] });
      assertEquals(tvy.processEvent({ serder: vcp, ...anchorTel(hab, vcp) }).kind, "accept");

      const creder = makeCredential(hab.pre);
      const iss = issue(creder.said!, vcp.pre!);
      assertEquals(tvy.processEvent({ serder: iss, ...anchorTel(hab, iss) }).kind, "accept");
      let state = tvy.tevers.get(vcp.pre!)?.vcState(creder.said!);
      assertEquals(state?.et, "iss");
      assertEquals(state?.s, "0");

      const rev = revoke(creder.said!, vcp.pre!, iss.said!);
      assertEquals(tvy.processEvent({ serder: rev, ...anchorTel(hab, rev) }).kind, "accept");
      state = tvy.tevers.get(vcp.pre!)?.vcState(creder.said!);
      assertEquals(state?.et, "rev");
      assertEquals(state?.s, "1");
      assertEquals(reger.tels.getOn(creder.said!, 1)?.qb64, rev.said);
      assertEquals(tvy.cues.pull()?.kin, "revoked");
    } finally {
      yield* reger.close(true);
      yield* hby.close(true);
    }
  });
});

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
          const cue = reply.take();
          assertExists(cue);
          if (cue.kin !== "replay") throw new Error("Expected TEL replay");
          assertEquals([cue.querySaid, cue.src, cue.dest], [request.said, issuer.pre, issuer.pre]);
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
      assertEquals(runtime.cues.pull()?.kin, "revoked", "Accepted later revocation keeps its independent cue");
      const request = (ri = vcp.pre!, i = "", route = "tels") =>
        query(route, { ri, src: issuer.pre, i }, { pre: issuer.pre, pvrsn: Vrsn_2_0 });
      const source = new Prefixer({ qb64: issuer.pre });
      assertEquals(tvy.processQuery({ serder: request(), source }), undefined);
      assertEquals(runtime.cues.pull()?.kin, "replay");
      assertEquals(tvy.processQuery({ serder: request(issuer.pre), source }), undefined);
      assertEquals(runtime.cues.length, 0, "Unknown TEL has no response or query escrow");
      assertEquals(tvy.processQuery({ serder: request(), source: undefined }), {
        kind: "drop",
        reason: "missingAuthentication",
      });
      assertEquals(tvy.processQuery({ serder: request(""), source }), { kind: "drop", reason: "invalidQuery" });
      assertEquals(tvy.processQuery({ serder: request(vcp.pre!, "", "tsn"), source }), {
        kind: "drop",
        reason: "unsupportedRoute",
      });
      const unsigned = hby.makeHab("nontransferable", undefined, { transferable: false });
      const serder = request();
      assertEquals(tvy.processQuery({ serder, cigars: unsigned.sign(serder.raw, false) }), undefined);
      assertEquals(runtime.cues.pull()?.kin, "replay");
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

Deno.test("TSN producer prepares ordered independent state replies without enabling runtime intake", async () => {
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
        const { dt, ...registry } = result.replies[0].data!;
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
        assertEquals(result.replies[1]!.data, {
          vn: [1, 0],
          i: credential.said,
          s: "0",
          d: iss.said,
          ri: vcp.pre,
          ra: {},
          a: { s: Number(anchors[1].seqner.num), d: anchors[1].saider.qb64 },
          dt: iss.ked!.dt,
          et: "iss",
        });
        result.replies[0].data!.b = ["foreign"];
        assertEquals(tvy.tevers.get(vcp.pre!)!.baks, [], "Replies are detached record data");
      } finally {
        yield* call(() => discardFrame(frame));
      }
      const partial = prepareTsnQuery({ serder: request(vcp.pre!, issuer.pre), source }, tvy.tevers);
      if (partial.kind !== "reply") throw new Error("Expected registry reply");
      assertEquals([partial.replies.length, partial.missingCredential], [1, issuer.pre]);
      const registryOnly = prepareTsnQuery({ serder: request(vcp.pre!, ""), source }, tvy.tevers);
      if (registryOnly.kind !== "reply") throw new Error("Expected registry reply");
      assertEquals(registryOnly.replies.length, 1);
      assertEquals(prepareTsnQuery({ serder: request(issuer.pre), source }, tvy.tevers), {
        kind: "unavailable",
        registry: issuer.pre,
      });
      assertEquals(prepareTsnQuery({ serder: request() }, tvy.tevers), {
        kind: "drop",
        reason: "missingAuthentication",
      });
      assertEquals(prepareTsnQuery({ serder: request(""), source }, tvy.tevers), {
        kind: "drop",
        reason: "invalidQuery",
      });
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
      assertEquals(tvy.processQuery({ serder: request(), source }), { kind: "drop", reason: "unsupportedRoute" });
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
