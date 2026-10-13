/** Cache policy against real LMDB; frozen semantics from KERIpy 927c0cb8. */
import { b, Dater, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { type KramExemption, KramPolicy, type KramWindows } from "../../../src/core/kram-policy.ts";
import { evaluateKramTime, inspectKramReplay, type KramTimeAuthentication } from "../../../src/core/kram-time.ts";
import { reply } from "../../../src/core/protocol-eventing.ts";
import { MsgCacheRecord, TxnMsgCacheRecord } from "../../../src/core/records.ts";
import { createBaser } from "../../../src/db/basing.ts";
import { encodeDateTimeToDater } from "../../../src/time/mod.ts";
import sourceReference from "../../fixtures/kram-source-auth-927.json" with { type: "json" };
import timeReference from "../../fixtures/kram-time-927.json" with { type: "json" };

const initial: KramWindows = [1000, 5000, 60000, 300000, 5000, 60000, 300000];
const expanded: KramWindows = [2000, 7000, 62000, 302000, 7000, 62000, 302000];
// Shared exact body and four independent exemption observations from donor 04178add.
const body =
  `{"v":"KERICAACAAJSONAAEV.","t":"exn","d":"ECTjxwdMPWpJGUYizEZ1PbwgIXjyXvG7_ryyrWOae_s6","i":"EHreASnB_4r3YSEnKz27Ep6fhzd__UNqgZRDoylvQCi-","ri":"EHreASnB_4r3YSEnKz27Ep6fhzd__UNqgZRDoylvQCi-","x":"","p":"","dt":"2026-10-13T12:05:02.000001+00:00","r":"/ipex/apply","q":{},"a":{}}`;

Deno.test("KRAM selection and compact exemptions match the frozen reference", async () => {
  await run(function*() {
    const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
    try {
      const policy = new KramPolicy(db, {
        enabled: true,
        caches: { "~": initial, exn: expanded, "exn.R./ipex": initial },
      });
      assertEquals(policy.cacheType("exn", "/ipex").sl, 5000);
      assertEquals(policy.cacheType("exn", "/ipex/apply").sl, 7000, "cache routes match exactly, not by prefix");
      assertEquals(policy.cacheType("qry", null).sl, 5000);
      const observations: readonly (readonly [KramExemption, boolean])[] = [
        [[[2, 0], "", ""], true],
        [[[2, 0], "rpy", ""], false],
        [[[2, 0], "", "/ipex"], false],
        [[[2, 0], "exn", "/ipex"], true],
      ];
      const serder = new SerderKERI({ raw: b(body) });
      for (const [denial, expected] of observations) {
        assertEquals(new KramPolicy(db, { enabled: true, denials: [denial] }).exempts(serder), expected);
      }
      assertEquals(new KramPolicy(db).exempts(serder), true);
      for (const route of ["/end/role/add", "/loc/scheme"]) {
        assertEquals(policy.exempts(reply(route, {}, { version: Vrsn_2_0 })), true, "built-in V2 OOBI exemption");
      }
    } finally {
      yield* db.close(true);
    }
  });
});

Deno.test("KRAM expansions survive reopen and superseding changes refresh stale owners", async () => {
  await run(function*() {
    const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
    let now = 100000;
    let policy = new KramPolicy(db, { caches: { "~": initial } }, () => now);
    try {
      policy.change({ "~": expanded });
      assertEquals(Object.values(policy.cacheType("qry", null)), [1000, 5000, 60000, 300000, 7000, 62000, 302000]);
      yield* db.reopen();
      policy = new KramPolicy(db, { caches: { "~": expanded } }, () => now);
      now += 1999;
      policy.reconcile();
      assertEquals(policy.cacheType("qry", null).sl, 5000);
      now++;
      policy.reconcile();
      assertEquals(Object.values(policy.cacheType("qry", null)), [1000, ...expanded.slice(1)]);
      const larger: KramWindows = [1000, 9000, 64000, 304000, 9000, 64000, 304000];
      policy.change({ "~": larger });
      const stale = new KramPolicy(db, { caches: { "~": larger } }, () => now);
      policy.change({ "~": [1000, 8000, 63000, 303000, 8000, 63000, 303000] });
      assertEquals(policy.cacheType("qry", null).sl, 7000, "decrease of pending target cannot expand active window");
      now += 1000;
      stale.reconcile();
      assertEquals(stale.cacheType("qry", null).sl, 8000);
      assertEquals(
        new KramPolicy(db).cacheType("qry", null),
        stale.cacheType("qry", null),
        "omitted caches preserve policy",
      );
      const before = db.hbys.get("kram-policy");
      assertThrows(() => policy.change({ qry: initial }), RangeError, "coverage hole");
      assertThrows(() => policy.change({ "~": [0, 2, 1, 3, 2, 2, 3] }), RangeError);
      assertThrows(() => policy.change({ "~": initial }, 0), RangeError);
      assertEquals(db.hbys.get("kram-policy"), before, "invalid requests cannot publish policy");
    } finally {
      yield* db.close(true);
    }
  });
});

Deno.test("KRAM changes preserve active pruning, fixed drift and new coverage staging", async () => {
  await run(function*() {
    const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
    let now = 100000;
    const policy = new KramPolicy(db, { caches: { exn: initial } }, () => now);
    try {
      assertThrows(() => policy.cacheType("qry", null), Error, "No KRAM cache type");
      policy.change({ exn: [2000, 4000, 61000, 300000, 4000, 61000, 300000] });
      assertEquals(Object.values(policy.cacheType("exn", null)), [1000, 5000, 60000, 300000, 5000, 61000, 300000]);
      now += 1000;
      policy.reconcile();
      assertEquals(policy.cacheType("exn", null).sl, 4000);
      policy.change({ exn: [3000, 3000, 60000, 300000, 4000, 61000, 300000] });
      assertEquals(policy.cacheType("exn", null).sl, 3000, "pure decrease is immediate");
      policy.change({ exn: [4000, 3000, 60000, 300000, 5000, 61000, 300000] });
      assertEquals(policy.cacheType("exn", null).d, 1000, "pruning-only increase retains drift");
      policy.change({ "~": initial });
      assertEquals(policy.cacheType("qry", null).sl, 3000);
      now += 4999;
      policy.reconcile();
      assertEquals(policy.cacheType("qry", null).sl, 3000);
      now++;
      const staged = db.hbys.get("kram-policy");
      assertThrows(() => policy.change({ qry: initial }), RangeError, "coverage hole");
      assertEquals(db.hbys.get("kram-policy"), staged, "rejected change cannot reconcile a due transition");
      policy.reconcile();
      assertEquals(policy.cacheType("qry", null).sl, 5000);
      db.hbys.pin("kram-policy", "invalid");
      assertThrows(() => policy.reconcile(), Error, "Corrupt KRAM policy metadata");
    } finally {
      yield* db.close(true);
    }
  });
});

// Independent intake observations at 927c0cb8; shared body literals keep source/auth owners separate.
Deno.test("KRAM replay and time plans match frozen receipts, openers and inclusive microsecond windows", async () => {
  const bodies: Record<string, string> = { ...timeReference.bodies, "source.wrong": sourceReference.bodies.wrong };
  const caches = timeReference.caches as Record<
    string,
    { body: string; windows: "long" | "short"; xdt?: string; rdt?: string }
  >;
  const makeRecord = (name: string) => {
    const { body, windows, xdt, rdt } = caches[name], { d, xl, pxl } = timeReference.windows;
    const ml = timeReference.windows[windows], values = { mdt: JSON.parse(bodies[body]).dt, d, ml, pml: ml, xl, pxl };
    return xdt === undefined ? new MsgCacheRecord(values) : new TxnMsgCacheRecord({ ...values, xdt, rdt });
  };
  for (const row of timeReference.cases) {
    await run(function*() {
      const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
      try {
        const configured = row.configuration === "decreased"
          ? timeReference.configurations.decreased as unknown as KramWindows
          : initial;
        const policy = new KramPolicy(db, { caches: { "~": configured } });
        const body = new SerderKERI({ raw: b(bodies[row.body]) });
        const seed = (name: string) => {
          const owner = new SerderKERI({ raw: b(bodies[caches[name].body]) }), record = makeRecord(name);
          if (record instanceof TxnMsgCacheRecord) {
            db.tmsc.pin([owner.pre!, owner.ilk === "xip" ? owner.said! : String(owner.ked?.x), owner.said!], record);
          } else db.msgc.pin([owner.pre!, owner.said!], record);
        };
        if (row.before) seed(row.before);
        for (const sibling of row.siblings ?? []) seed(sibling);
        if (row.partial) db.pmkm.pin([body.pre!, body.said!], body);
        if (row.sharedOpener) {
          db.xdt.pin(String(body.ked?.x), new Dater({ qb64: encodeDateTimeToDater(row.sharedOpener) }));
        }
        yield* db.close(false);
        yield* db.reopen({ reuse: true });
        const inspection = inspectKramReplay(db, body);
        const decision = inspection.kind === "drop"
          ? inspection
          : evaluateKramTime(
            db,
            policy,
            inspection,
            timeReference
              .authentications[
                row.authentication as keyof typeof timeReference.authentications
              ] as KramTimeAuthentication,
            row.receiverTime,
          );
        if (row.refusal) {
          assertEquals<string | false>(decision.kind === "drop" && decision.reason, row.refusal, row.name);
        } else {
          assertEquals(decision.kind, "proceed", row.name);
          if (decision.kind === "proceed") {
            assertEquals(decision.record.asDict(), makeRecord(row.cache!).asDict(), row.name);
            assertEquals(decision.receiverTime, caches[row.cache!].rdt || row.receiverTime, row.name);
          }
        }
        const cached = String(body.ked?.x ?? "") || body.ilk === "xip"
          ? db.tmsc.get([body.pre!, body.ilk === "xip" ? body.said! : String(body.ked?.x), body.said!])
          : db.msgc.get([body.pre!, body.said!]);
        assertEquals(
          cached?.asDict() ?? null,
          row.before ? makeRecord(row.before).asDict() : null,
          "planning cannot publish a competing receipt",
        );
        if (row.name === "transaction threshold freezes receiver time") {
          const received = makeRecord("transaction-received") as TxnMsgCacheRecord;
          db.tmsc.pin([body.pre!, String(body.ked?.x), body.said!], received);
          const ready = inspectKramReplay(db, body, { resumingReady: true });
          if (ready.kind === "drop") throw new Error("durable partial must remain resumable");
          const retry = evaluateKramTime(db, policy, ready, { kind: "seal" }, "2026-10-13T12:20:02.000000+00:00");
          assertEquals(
            retry.kind === "proceed" && retry.receiverTime,
            received.rdt,
            "ready retry cannot refresh first receipt",
          );
          assertEquals(
            evaluateKramTime(db, policy, { ...ready, resumingReady: false }, { kind: "single" }, row.receiverTime),
            { kind: "drop", reason: "replay" },
          );
          assertThrows(() => evaluateKramTime(db, policy, ready, { kind: "single" }, "bad"), Error, "receiver clock");
          db.pmkm.rem([body.pre!, body.said!]);
          assertThrows(() => inspectKramReplay(db, body, { resumingReady: true }), Error, "partial state");
          db.tmsc.pin(
            [body.pre!, String(body.ked?.x), body.said!],
            new TxnMsgCacheRecord({ ...received.asDict(), mdt: "bad" }),
          );
          assertThrows(() => inspectKramReplay(db, body), Error, "Corrupt");
        }
      } finally {
        yield* db.close(true);
      }
    });
  }
});
