// @file-test-lane db-fast

import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Diger, NumberPrimitive, NumDex, SerderACDC, TraitDex } from "../../../../cesr/mod.ts";
import { createHabery, type Hab } from "../../../src/app/habbing.ts";
import { incept as inceptRegistry, issue, revoke } from "../../../src/core/protocol-vdr-eventing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { createReger } from "../../../src/db/reger.ts";
import { Tevery } from "../../../src/vdr/eventing.ts";

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
  await run(function* () {
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
  await run(function* () {
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
  await run(function* () {
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
  await run(function* () {
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
