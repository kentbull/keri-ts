/** Cache policy against real LMDB; frozen semantics from KERIpy 927c0cb8. */
import { b, Dater, Diger, NumberPrimitive, SerderKERI, Siger, Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { KeriDispatchEnvelope } from "../../../src/core/dispatch.ts";
import { KramHandoff } from "../../../src/core/kram-handoff.ts";
import { type KramExemption, KramPolicy, type KramWindows } from "../../../src/core/kram-policy.ts";
import { KramPruner } from "../../../src/core/kram-pruning.ts";
import { evaluateKramTime, inspectKramReplay, type KramTimeAuthentication } from "../../../src/core/kram-time.ts";
import { reply } from "../../../src/core/protocol-eventing.ts";
import { MsgCacheRecord, TxnMsgCacheRecord } from "../../../src/core/records.ts";
import { createBaser } from "../../../src/db/basing.ts";
import { encodeDateTimeToDater, makeNowIso8601, timestampMicros } from "../../../src/time/mod.ts";
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
          db.pmkm.rem([body.pre!, body.said!]);
          assertEquals(inspectKramReplay(db, body), { kind: "drop", reason: "replay" });
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

Deno.test("KRAM finite pruning matches frozen TTL cleanup and retains exact microseconds", async () => {
  // Ten actual helper observations at clean 927c0cb8; all 64 imported module files byte-verified.
  const observed: readonly (readonly ["message" | "transaction", number, boolean])[] = [
    ["message", -1001000, false],
    ["message", -1000000, true],
    ["message", 61000000, true],
    ["message", 61001000, false],
    ["transaction", -1000, false],
    ["transaction", 0, true],
    ["transaction", 300000000, true],
    ["transaction", 300001000, false],
    // Precision strengthening of the reference's integer-ms truncation, matching K2/K7.
    ["message", -1000001, false],
    ["message", 61000001, false],
    ["transaction", -1, false],
    ["transaction", 300000001, false],
  ];
  await run(function*() {
    const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
    try {
      const policy = new KramPolicy(db, { caches: { "~": initial } });
      const body = new SerderKERI({ raw: b(timeReference.bodies.transaction) });
      const key = [body.pre!, body.said!], xid = String(body.ked?.x), txkey = [key[0], xid, key[1]];
      const values = { mdt: body.stamp!, d: 1000, ml: 60000, pml: 60000, xl: 300000, pxl: 300000 };
      const clock = (offset: number) => {
        const micros = timestampMicros(body.stamp)! + BigInt(offset);
        return makeNowIso8601(new Date(Number(micros / 1000n))).replace(
          /\.\d{6}/,
          `.${(micros % 1000000n).toString().padStart(6, "0")}`,
        );
      };
      const pass = (pruner: KramPruner, receipt: string) => {
        let result;
        for (let i = 0; i < 100; i++) {
          result = pruner.prune(receipt, 1);
          assertEquals(result.visited <= 1, true);
          if (result.passComplete) return result;
        }
        throw new Error("finite prune pass did not complete");
      };
      for (const [family, offset, keep] of observed) {
        const record = family === "message"
          ? new MsgCacheRecord(values)
          : new TxnMsgCacheRecord({ ...values, xdt: body.stamp!, rdt: body.stamp! });
        if (family === "message") db.msgc.pin(key, record);
        else db.tmsc.pin(txkey, record as TxnMsgCacheRecord);
        db.xdt.pin(xid, new Dater({ qb64: encodeDateTimeToDater(body.stamp!) }));
        db.pmkm.pin(key, body);
        db.pmks.add(key, new Siger({ code: "A", raw: new Uint8Array(64), index: 0 }));
        db.pmsk.pin(key, [NumberPrimitive.fromNum(0n), new Diger({ qb64: body.said! })]);
        db.ptds.add(key, new Uint8Array([0xff, 0x00]));
        db.kpnd.pin(key, b("private snapshot"));
        pass(new KramPruner(db, policy), clock(offset));
        assertEquals((family === "message" ? db.msgc.get(key) : db.tmsc.get(txkey)) !== null, keep);
        assertEquals([
          db.pmkm.get(key) !== null,
          !!db.pmks.get(key).length,
          db.pmsk.get(key) !== null,
          !!db.ptds.get(key).length,
          db.kpnd.get(key) !== null,
        ], Array(5).fill(keep));
        assertEquals(db.xdt.get(xid) !== null, family === "transaction" && keep);
        db.msgc.rem(key);
        db.tmsc.rem(txkey);
      }
      const first = new TxnMsgCacheRecord({ ...values, xdt: body.stamp!, rdt: "" });
      db.tmsc.pin(txkey, first);
      db.tmsc.pin(["other-sender", xid, "other-message"], new TxnMsgCacheRecord({ ...first.asDict(), pxl: 301000 }));
      db.xdt.pin(xid, new Dater({ qb64: encodeDateTimeToDater(body.stamp!) }));
      const pruner = new KramPruner(db, policy);
      pass(pruner, clock(300001000));
      assertEquals([db.tmsc.get(txkey), db.xdt.get(xid) !== null], [null, true]);
      yield* db.close(false);
      yield* db.reopen({ reuse: true });
      pass(pruner, clock(301001000));
      assertEquals([db.tmsc.get(["other-sender", xid, "other-message"]), db.xdt.get(xid)], [null, null]);
      assertThrows(() => pruner.prune("bad"), Error, "receiver clock");
      assertThrows(() => pruner.prune(clock(0), 0), RangeError);
      db.msgc.pin(key, new MsgCacheRecord({ ...values, mdt: "bad" }));
      assertThrows(() => pass(pruner, clock(0)), Error, "Corrupt");
    } finally {
      yield* db.close(true);
    }
  });
});

Deno.test("KRAM orphan scan restarts for insertion behind its checkpoint and excludes live handoff", async () => {
  await run(function*() {
    const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
    try {
      const policy = new KramPolicy(db, { enabled: false, caches: { "~": initial } });
      const body = new SerderKERI({ raw: b(timeReference.bodies.transaction) }), xid = String(body.ked?.x);
      const record = new TxnMsgCacheRecord({
        mdt: body.stamp!,
        xdt: body.stamp!,
        rdt: "",
        d: 1000,
        ml: 60000,
        pml: 60000,
        xl: 300000,
        pxl: 300000,
      });
      db.tmsc.pin(["mmm", "other-xid", "middle"], record);
      db.tmsc.pin(["zzz", "other-xid", "last"], record);
      db.xdt.pin(xid, new Dater({ qb64: encodeDateTimeToDater(body.stamp!) }));
      const pruner = new KramPruner(db, policy), receipt = "2026-10-13T12:00:02.000000+00:00";
      for (let i = 0; i < 4; i++) assertEquals(pruner.prune(receipt, 1).passComplete, false);
      // Candidate existence scan passed mmm; newly published aaa lies behind that checkpoint.
      db.tmsc.pin(["aaa", xid, "inserted"], record);
      let completed = false;
      for (let i = 0; i < 20 && !completed; i++) completed = pruner.prune(receipt, 1).passComplete;
      assertEquals(completed, true);
      assertEquals(db.xdt.get(xid) !== null, true, "intervening commit invalidates an orphan proof");
      const handoff = new KramHandoff(db, policy);
      yield* handoff.intake(
        new KeriDispatchEnvelope({ serder: body, attachmentGroups: [], local: false }),
        function*() {
          assertEquals(pruner.prune("2026-10-13T12:20:00.000000+00:00", 1).kind, "busy");
          assertEquals(db.tmsc.get(["aaa", xid, "inserted"]) !== null, true);
        },
      );
      db.tmsc.rem(["aaa", xid, "inserted"]);
      let complete = false;
      for (let i = 0; i < 30 && !complete; i++) complete = pruner.prune(receipt, 1).passComplete;
      assertEquals(complete, true);
      assertEquals(db.xdt.get(xid), null, "last shared opener is actually removed");
    } finally {
      yield* db.close(true);
    }
  });
});

Deno.test("KRAM pruning releases cursors and retries rolled-back cleanup without skipping rows", async () => {
  await run(function*() {
    const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
    const getKeys = db.msgc.sdb.getKeys, transaction = db.env!.transactionSync, remove = db.pmkm.rem;
    let cursors = 0;
    try {
      const policy = new KramPolicy(db, { caches: { "~": initial } });
      const body = new SerderKERI({ raw: b(timeReference.bodies.transaction) }), key = [body.pre!, body.said!];
      db.msgc.pin(
        key,
        new MsgCacheRecord({ mdt: body.stamp!, d: 1000, ml: 60000, pml: 60000, xl: 300000, pxl: 300000 }),
      );
      db.pmkm.pin(key, body);
      db.kpnd.pin(key, b("owned wire"));
      db.msgc.sdb.getKeys = function(options) {
        const iterable = getKeys.call(this, options);
        return new Proxy(iterable, {
          get(target, property, receiver) {
            if (property !== Symbol.iterator) return Reflect.get(target, property, receiver);
            return function*() {
              cursors++;
              try {
                yield* target;
              } finally {
                cursors--;
              }
            };
          },
        });
      };
      db.env!.transactionSync = function<T>(action: () => T, flags?: Parameters<typeof transaction>[1]): T {
        assertEquals(cursors, 0, "no suspended cursor may cross a write");
        return transaction.call(this, action, flags) as T;
      };
      const failure = new Error("cleanup I/O failed");
      db.pmkm.rem = () => {
        throw failure;
      };
      const pruner = new KramPruner(db, policy), receipt = "2026-10-13T12:20:00.000000+00:00";
      assertEquals(assertThrows(() => pruner.prune(receipt, 1)), failure);
      assertEquals([
        db.msgc.get(key) !== null,
        db.pmkm.get(key) !== null,
        db.kpnd.get(key) !== null,
      ], [true, true, true]);
      db.pmkm.rem = remove;
      assertEquals(pruner.prune(receipt, 1).removed, 1, "failed cleanup cannot advance the checkpoint");
      assertEquals([db.msgc.get(key), db.pmkm.get(key), db.kpnd.get(key)], [
        null,
        null,
        null,
      ]);
      assertEquals(cursors, 0);
    } finally {
      db.msgc.sdb.getKeys = getKeys;
      db.env!.transactionSync = transaction;
      db.pmkm.rem = remove;
      yield* db.close(true);
    }
  });
});
