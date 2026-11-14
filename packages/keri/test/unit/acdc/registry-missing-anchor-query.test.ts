/**
 * A v2 registry event held because its anchoring issuer KEL event is not accepted yet makes the recipient ask once
 * for that KEL through the ordinary `logs` query cue, as a v1 TEL event does in `Tevery`.
 */
import { b, parseBytes, SealSource } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { blindate, regcept } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import { RegistryStore } from "../../../src/acdc/registering.ts";
import { acceptedEventReplayMessage, type Habery } from "../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../src/app/identity/lmdb-habery.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { missingAnchorQuery } from "../../../src/core/missing-anchor-query.ts";
import { openLmdbRegistry } from "../../../src/db/lmdb-stores.ts";
import fixture from "../../fixtures/keripy-registry-vectors.json" with { type: "json" };

/** Process signed KEL bytes through the recipient's ordinary dispatch. */
async function ingest(hby: Habery, wire: string | Uint8Array): Promise<void> {
  for (const frame of await parseBytes(typeof wire === "string" ? b(wire) : wire)) {
    await run(() => dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery));
  }
}

/** Take every cue published so far. */
function drain(cues: Deck<AgentCue>): AgentCue[] {
  const taken: AgentCue[] = [];
  for (let cue = cues.pull(); cue; cue = cues.pull()) taken.push(cue);
  return taken;
}

/** Sender and recipient Haberys, a recipient registry store and its observer publishing to `cues`. */
function* recipient() {
  const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
  const store = new RegistryStore(baser), cues = new Deck<AgentCue>();
  return {
    source,
    hby,
    baser,
    store,
    cues,
    observer: new RegistryObserver(hby.db, store, cues),
    *close() {
      yield* baser.close(true);
      yield* hby.close(true);
      yield* source.close(true);
    },
  };
}

Deno.test("a v2 inception whose anchor the recipient lacks asks once for the issuer KEL and is accepted when it arrives", async () => {
  await run(function*() {
    const r = yield* recipient();
    try {
      const issuer = r.source.makeHab("issuer"), rip = regcept(issuer.pre), regid = rip.said!;
      issuer.interact({ data: [{ i: regid, s: "0", d: regid }] });
      // The recipient knows the inception only; the interaction that anchors the registry is the missing event.
      yield* call(() => ingest(r.hby, acceptedEventReplayMessage(r.source, issuer.pre, 0).message));
      assertEquals(r.hby.db.getKever(issuer.pre)?.sn, 0);

      assertEquals(r.observer.processEvent(rip).kind, "escrow");
      assertEquals(drain(r.cues), [{ kin: "query", pre: issuer.pre, route: "logs", q: { fn: "1" } }]);

      r.observer.processEscrows(regid);
      r.observer.processEscrows(regid);
      r.observer.processAllEscrows();
      assertEquals(r.observer.processEvent(rip).kind, "escrow");
      assertEquals(drain(r.cues), [], "Retries and a repeat arrival do not ask again");

      yield* call(() => ingest(r.hby, acceptedEventReplayMessage(r.source, issuer.pre, 1).message));
      r.observer.processEscrows(regid);
      assertEquals(r.store.head(regid)?.qb64, regid);
      assertEquals(drain(r.cues), []);
    } finally {
      yield* r.close();
    }
  });
});

Deno.test("a v2 inception from an issuer the recipient does not know asks for the whole KEL, up to a supplied source seal", async () => {
  await run(function*() {
    const r = yield* recipient();
    try {
      const issuer = r.source.makeHab("issuer"), rip = regcept(issuer.pre), regid = rip.said!;
      const anchor = issuer.interact({ data: [{ i: regid, s: "0", d: regid }] });
      const seal = SealSource.fromSad({ s: "1", d: r.source.db.kels.getLast(issuer.pre, 1)! });
      assertEquals(anchor.length > 0, true);

      assertEquals(r.observer.processEvent(rip, { sscs: [seal] }).kind, "escrow");
      assertEquals(drain(r.cues), [{ kin: "query", pre: issuer.pre, route: "logs", q: { fn: "0", s: "1" } }]);
      r.observer.processEscrows(regid);
      assertEquals(drain(r.cues), []);
    } finally {
      yield* r.close();
    }
  });
});

Deno.test("a v2 credential state update whose anchor the recipient lacks asks once and is accepted when the KEL arrives", async () => {
  await run(function*() {
    const r = yield* recipient();
    try {
      const issuer = r.source.makeHab("issuer"), rip = regcept(issuer.pre), regid = rip.said!;
      const update = blindate(regid, regid, fixture.disclosures.issued.d);
      issuer.interact({ data: [{ i: regid, s: "0", d: regid }] });
      issuer.interact({ data: [{ i: regid, s: "1", d: update.said! }] });
      for (const sn of [0, 1]) {
        yield* call(() => ingest(r.hby, acceptedEventReplayMessage(r.source, issuer.pre, sn).message));
      }
      assertEquals(r.observer.processEvent(rip).kind, "accept");
      assertEquals(drain(r.cues), []);

      assertEquals(r.observer.processEvent(update).kind, "escrow");
      assertEquals(drain(r.cues), [{ kin: "query", pre: issuer.pre, route: "logs", q: { fn: "2" } }]);

      r.observer.processEscrows(regid);
      assertEquals(r.observer.processEvent(update).kind, "escrow");
      assertEquals(drain(r.cues), [], "Retries and a repeat arrival do not ask again");

      yield* call(() => ingest(r.hby, acceptedEventReplayMessage(r.source, issuer.pre, 2).message));
      r.observer.processEscrows(regid);
      assertEquals(r.store.head(regid)?.qb64, update.said);
    } finally {
      yield* r.close();
    }
  });
});

Deno.test("an update for a registry whose inception the recipient lacks asks nothing: its issuer is unknown", async () => {
  await run(function*() {
    const r = yield* recipient();
    try {
      const issuer = r.source.makeHab("issuer"), regid = regcept(issuer.pre).said!;
      const update = blindate(regid, regid, fixture.disclosures.issued.d);
      assertEquals(r.observer.processEvent(update).kind, "escrow");
      assertEquals(drain(r.cues), []);
    } finally {
      yield* r.close();
    }
  });
});

Deno.test("the missing-anchor query starts after the accepted KEL and names the anchor only when it is known", () => {
  assertEquals(missingAnchorQuery("Eissuer", null, null), { pre: "Eissuer", fn: "0" });
  assertEquals(missingAnchorQuery("Eissuer", 9n, null), { pre: "Eissuer", fn: "a" });
  assertEquals(missingAnchorQuery("Eissuer", 9n, 12n), { pre: "Eissuer", fn: "a", s: "c" });
  assertEquals(missingAnchorQuery("Eissuer", null, 12n), { pre: "Eissuer", fn: "0", s: "c" });
  assertEquals(missingAnchorQuery("Eissuer", 12n, 12n), null, "More KEL cannot supply an anchor already reached");
  assertEquals(missingAnchorQuery("Eissuer", 13n, 12n), null);
});
