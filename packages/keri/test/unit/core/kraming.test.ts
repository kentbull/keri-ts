/** Independent frozen wire/cache observations exercise KRAM through real durable state. */
import { b, discardFrame, essrPayload, type OwnedPayload, parseBytes, SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertThrows } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { KeriDispatchEnvelope, PathedMaterialGroup } from "../../../src/core/dispatch.ts";
import type { KramExemption, KramWindows } from "../../../src/core/kram-policy.ts";
import { Kramer } from "../../../src/core/kraming.ts";
import fixture from "../../fixtures/keripy-kram-vectors.json" with { type: "json" };

Deno.test("KRAM accumulation, replay, receipt times and rotation cleanup match frozen wire observations", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    let now = Date.parse(fixture.cases[0].now);
    const kramer = new Kramer(hby.db, {
      config: { enabled: true, caches: { "~": fixture.config.kram.caches["~"] as unknown as KramWindows } },
      now: () => now,
    });
    let through = 0;
    try {
      assertEquals(fixture.reference, "927c0cb8794d7c84fc17143c67df64aab9deda6c");
      for (const row of fixture.cases) {
        now = Date.parse(row.now);
        while (through < row.through) {
          const frames = yield* call(() => parseBytes(b(fixture.kel[through++])));
          for (const frame of frames) {
            try {
              yield* dispatchEnvelope(envelopeFromFrame(frame), hby.rvy, hby.kevery);
            } finally {
              yield* call(() => discardFrame(frame));
            }
          }
        }
        const [frame] = yield* call(() => parseBytes(b(row.wire)));
        try {
          const input = envelopeFromFrame(frame);
          let ready = false;
          kramer.cues.clear();
          yield* kramer.intake(input, function*(envelope) {
            ready = true;
            assertEquals(envelope.sigers.map((s) => s.qb64), row.sigers, row.name);
            assertEquals(
              envelope.cigars.map((c) => ({ verfer: c.verfer?.qb64, signature: c.qb64 })),
              row.cigars,
              row.name,
            );
            assertEquals(envelope.sscs.map((s) => [s.s.qb64, s.d.qb64]), row.sources, row.name);
            assertEquals(envelope.unresolvedLast.map((p) => p.qb64), row.unresolved, row.name);
            assertEquals(
              envelope.tsgs.map((g) => ({
                pre: g.pre,
                number: g.seqner.qb64,
                digest: g.said,
                sigers: g.sigers.map((s) => s.qb64),
              })),
              row.groups,
              row.name,
            );
          });
          assertEquals(ready, row.ready, row.name);
          assertEquals(
            kramer.cues.toArray().map((cue) => {
              if (cue.kin !== "query" || !cue.q) throw new Error("unexpected KRAM cue");
              return { sender: cue.pre, sn: cue.q.sn === undefined ? null : Number.parseInt(String(cue.q.sn), 16) };
            }),
            row.requests,
            row.name,
          );
          const body = input.serder, key = [body.pre!, body.said!], xid = String(body.ked?.x ?? "");
          const cached = xid ? hby.db.tmsc.get([body.pre!, xid, body.said!]) : hby.db.msgc.get(key);
          assertEquals(cached?.asDict() ?? null, row.cache, row.name);
          assertEquals(hby.db.pmkm.get(key) !== null, row.partial, row.name);
          assertEquals(hby.db.pmks.get(key).map((s) => s.qb64), row.partialSigs, row.name);
          assertEquals(xid ? hby.db.xdt.get(xid)?.dts ?? null : null, row.opener, row.name);
        } finally {
          yield* call(() => discardFrame(frame));
        }
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM exemptions preserve frozen compact-prefix semantics", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    try {
      for (const row of fixture.exemptions) {
        const kramer = new Kramer(hby.db, {
          config: {
            enabled: true,
            caches: { "~": fixture.config.kram.caches["~"] as unknown as KramWindows },
            denials: [row.denial as unknown as KramExemption],
          },
        });
        assertEquals(kramer.policy.exempts(new SerderKERI({ raw: b(row.body) })), row.exempt, row.name);
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM completed handoff survives infrastructure failure and preserves its first receiver time", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const first = fixture.cases.find((row) => row.name === "transaction first signature has no receiver time")!;
    const second = fixture.cases.find((row) => row.name === "transaction threshold freezes receiver time")!;
    let now = Date.parse(first.now);
    const kramer = new Kramer(hby.db, {
      config: { enabled: true, caches: { "~": fixture.config.kram.caches["~"] as unknown as KramWindows } },
      now: () => now,
    });
    try {
      const [event] = yield* call(() => parseBytes(b(fixture.kel[0])));
      yield* dispatchEnvelope(envelopeFromFrame(event), hby.rvy, hby.kevery);
      const [partial] = yield* call(() => parseBytes(b(first.wire)));
      const [complete] = yield* call(() => parseBytes(b(second.wire)));
      try {
        assertEquals(
          (yield* kramer.intake(envelopeFromFrame(partial), function*() {
            throw new Error("premature handoff");
          })).kind,
          "drop",
        );
        now = Date.parse(second.now);
        yield* call(() =>
          assertRejects(
            () =>
              run(() =>
                kramer.intake(envelopeFromFrame(complete), function*() {
                  throw new Error("storage unavailable");
                })
              ),
            Error,
            "storage unavailable",
          )
        );
        const body = complete.body, key = [body.ked!.i as string, body.said!];
        assertExists(hby.db.pmkm.get(key));
        assertEquals(hby.db.kready.get(key), "1");
        yield* hby.db.reopen();
        now += 1000;
        let delivered = false;
        yield* kramer.intake(envelopeFromFrame(complete), function*() {
          delivered = true;
        });
        assertEquals(delivered, true);
        assertEquals(hby.db.tmsc.get([key[0], body.ked!.x as string, key[1]])?.rdt, second.cache!.rdt);
        assertEquals(hby.db.pmkm.get(key), null);
        assertEquals(hby.db.kready.get(key), null);
      } finally {
        yield* call(() => Promise.all([discardFrame(partial), discardFrame(complete), discardFrame(event)]));
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM policy stages expansions across reopen and preserves coverage and active-window safety", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    let now = Date.parse("2026-10-13T12:00:00.000000+00:00");
    const initial: KramWindows = [1000, 5000, 60000, 300000, 5000, 60000, 300000];
    const expanded: KramWindows = [2000, 7000, 62000, 302000, 7000, 62000, 302000];
    const config = { enabled: true, caches: { "~": initial } };
    let kramer = new Kramer(hby.db, { config, now: () => now });
    try {
      kramer.changeConfig({ "~": expanded });
      assertEquals(kramer.policy.cacheType("qry", "ksn"), {
        d: 1000,
        sl: 5000,
        ll: 60000,
        xl: 300000,
        psl: 7000,
        pll: 62000,
        pxl: 302000,
      });
      yield* hby.db.reopen();
      kramer = new Kramer(hby.db, { config: { enabled: true, caches: { "~": expanded } }, now: () => now });
      now += 1999;
      kramer.policy.reconcile();
      assertEquals(kramer.policy.cacheType("qry", "ksn").sl, 5000);
      now++;
      kramer.policy.reconcile();
      assertEquals(kramer.policy.cacheType("qry", "ksn").sl, 7000);
      assertEquals(kramer.policy.cacheType("qry", "ksn").d, 1000);
      const firstExpansion: KramWindows = [1000, 9000, 64000, 304000, 9000, 64000, 304000];
      kramer.changeConfig({ "~": firstExpansion });
      const otherOwner = new Kramer(hby.db, {
        config: { enabled: true, caches: { "~": firstExpansion } },
        now: () => now,
      });
      kramer.changeConfig({ "~": [1000, 8000, 63000, 303000, 8000, 63000, 303000] });
      assertEquals(
        kramer.policy.cacheType("qry", "ksn").sl,
        7000,
        "an intervening decrease must not prematurely expand the active window",
      );
      now += 2000;
      otherOwner.policy.reconcile();
      assertEquals(
        otherOwner.policy.cacheType("qry", "ksn").sl,
        8000,
        "a stale policy owner must observe the superseding transition",
      );
      const before = hby.db.ctyp.get("~")!.asDict();
      assertThrows(() => kramer.changeConfig({ qry: initial }), RangeError, "coverage hole");
      assertEquals(hby.db.ctyp.get("~")!.asDict(), before);
      assertThrows(() => kramer.changeConfig({ "~": [0, 2, 1, 3, 2, 2, 3] }), RangeError);
      assertEquals(hby.db.ctyp.get("~")!.asDict(), before);
      const disabled = new Kramer(hby.db, { config: { enabled: false }, now: () => now });
      assertEquals(disabled.policy.exempts(new SerderKERI({ raw: b(fixture.exemptions[0].body) })), true);
      assertEquals(hby.db.ctyp.get("~")!.asDict(), before, "omitting caches preserves previously configured policy");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM pruning uses stored windows, clears partials and retains shared opening time until the last participant", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    let now = Date.parse(fixture.cases[0].now);
    const kramer = new Kramer(hby.db, {
      config: { enabled: true, caches: { "~": fixture.config.kram.caches["~"] as unknown as KramWindows } },
      now: () => now,
    });
    try {
      const row = fixture.cases.find((r) => r.name === "transaction threshold freezes receiver time")!;
      const [frame] = yield* call(() => parseBytes(b(row.wire)));
      try {
        const key = [frame.body.ked!.i as string, frame.body.ked!.x as string, frame.body.said!];
        // The opener is the same qualified Dater that normal intake stores.
        const normal = yield* call(() => parseBytes(b(fixture.kel[0])));
        for (const event of normal) yield* dispatchEnvelope(envelopeFromFrame(event), hby.rvy, hby.kevery);
        const first = yield* call(() => parseBytes(b(fixture.cases[4].wire)));
        yield* kramer.intake(envelopeFromFrame(first[0]), function*() {});
        hby.db.tmsc.pin(key, row.cache!);
        hby.db.tmsc.pin(["other-sender", key[1], "other-message"], { ...row.cache!, pxl: row.cache!.pxl + 1000 });
        assertExists(hby.db.xdt.get(key[1]));
        now = Date.parse(row.cache!.xdt!) + row.cache!.pxl + 1;
        assertEquals(kramer.prune(1), 1);
        assertExists(hby.db.xdt.get(key[1]));
        assertEquals(hby.db.pmkm.get([key[0], key[2]]), null);
        now += 1000;
        kramer.prune(1);
        assertEquals(hby.db.xdt.get(key[1]), null);
        yield* call(() => Promise.all([...normal, ...first].map(discardFrame)));
      } finally {
        yield* call(() => discardFrame(frame));
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM cancellation joins snapshot reads, retains busy admission through cleanup and borrows payload owners", async () => {
  const hby = await run(() => createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true }));
  const row = fixture.cases.find((r) => r.name === "transaction first signature has no receiver time")!;
  const kramer = new Kramer(hby.db, {
    config: { enabled: true, caches: { "~": fixture.config.kram.caches["~"] as unknown as KramWindows } },
    now: () => Date.parse(row.now),
  });
  const events = await parseBytes(b(fixture.kel[0]));
  const [frame] = await parseBytes(b(row.wire));
  let entered!: () => void, release!: () => void, aborted!: () => void;
  const ready = new Promise<void>((resolve) => entered = resolve);
  const cleanup = new Promise<void>((resolve) => release = resolve);
  const stopped = new Promise<void>((resolve) => aborted = resolve);
  let blocked = true, cleaned = false, discarded = false, continued = false;
  const payload: OwnedPayload = {
    size: 8,
    async *open(signal) {
      if (blocked) {
        const cancelled = new Promise<void>((resolve) => {
          signal!.addEventListener("abort", () => {
            aborted();
            resolve();
          }, { once: true });
        });
        entered();
        try {
          await cancelled;
          signal!.throwIfAborted();
        } finally {
          await cleanup;
          cleaned = true;
        }
      }
      yield b("4BABYWJj");
    },
    discard() {
      discarded = true;
      return Promise.resolve();
    },
  };
  let task: ReturnType<typeof run> | undefined;
  try {
    await run(function*() {
      for (const event of events) yield* dispatchEnvelope(envelopeFromFrame(event), hby.rvy, hby.kevery);
    });
    const incoming = new KeriDispatchEnvelope({
      ...envelopeFromFrame(frame),
      attachmentGroups: [...frame.attachments],
      essr: essrPayload(payload, 1, 3, Vrsn_2_0),
    });
    task = run(function*() {
      yield* kramer.intake(incoming, function*() {
        continued = true;
      });
    });
    await ready;
    let halted = false;
    const halt = task.halt().then(() => halted = true);
    await stopped;
    assertEquals(halted, false);
    assertEquals(cleaned, false);
    const busy = await run(() =>
      kramer.intake(envelopeFromFrame(frame), function*() {
        throw new Error("busy handoff");
      })
    );
    assertEquals(busy, { kind: "drop", reason: "kramBusy" });
    release();
    await halt;
    assertEquals(cleaned, true);
    assertEquals(continued, false);
    assertEquals(discarded, false, "intake borrows the caller's ESSR owner");
    const key = [incoming.serder.pre!, incoming.serder.said!];
    assertEquals(hby.db.pmkm.get(key), null);
    assertEquals(hby.db.kpnd.get(key), null);
    assertEquals(hby.db.tmsc.get([key[0], String(frame.body.ked!.x), key[1]]), null);
    blocked = false;
    const later = await run(() =>
      kramer.intake(incoming, function*() {
        throw new Error("partial handoff");
      })
    );
    assertEquals(later, { kind: "drop", reason: "kramPending" });
    assertExists(hby.db.kpnd.get(key), "later admission can read and persist the same borrowed owner");
  } finally {
    release();
    await task?.halt();
    await payload.discard();
    await Promise.all([...events, frame].map(discardFrame));
    await run(() => hby.close(true));
  }
});

Deno.test("KRAM intentionally retains the nested child omitted by frozen partial-signature recovery", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const [first, second] = fixture.nestedRetention;
    const kramer = new Kramer(hby.db, {
      config: { enabled: true, caches: { "~": fixture.config.kram.caches["~"] as unknown as KramWindows } },
      now: () => Date.parse(first.now),
    });
    const frames = yield* call(() => parseBytes(b(first.wire)));
    const completion = yield* call(() => parseBytes(b(second.wire)));
    try {
      assertEquals(
        [first.ready, first.nests, second.ready, second.nests],
        [false, 1, true, 0],
        "frozen omission is reproduced separately",
      );
      for (const wire of fixture.kel) {
        const events = yield* call(() => parseBytes(b(wire)));
        try {
          for (const event of events) yield* dispatchEnvelope(envelopeFromFrame(event), hby.rvy, hby.kevery);
        } finally {
          yield* call(() => Promise.all(events.map(discardFrame)));
        }
      }
      assertEquals(frames[0].nests?.length, 1);
      assertEquals(completion[0].nests?.length ?? 0, 0);
      const pending = yield* kramer.intake(envelopeFromFrame(frames[0]), function*() {
        throw new Error("premature handoff");
      });
      assertEquals(pending, { kind: "drop", reason: "kramPending" });
      yield* hby.db.reopen();
      let consumed = false;
      yield* kramer.intake(envelopeFromFrame(completion[0]), function*(ready) {
        consumed = true;
        assertEquals(
          ready.nests.length,
          1,
          "TypeScript deliberately retains the child until the route owner consumes it",
        );
        assertEquals(ready.nests[0].body.raw, frames[0].nests![0].body.raw);
        assertEquals(ready.nests[0].attachments, frames[0].nests![0].attachments);
        assertEquals(hby.db.exns.get(ready.nests[0].body.said!), null, "KRAM does not independently accept a child");
      });
      assertEquals(consumed, true);
    } finally {
      yield* call(() => Promise.all([...frames, ...completion].map(discardFrame)));
      yield* hby.close(true);
    }
  });
});

Deno.test("KRAM pathed evidence preserves distinct binary members across partial admission and reopen", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const first = fixture.cases[4], second = fixture.cases[5];
    const kramer = new Kramer(hby.db, {
      config: { enabled: true, caches: { "~": fixture.config.kram.caches["~"] as unknown as KramWindows } },
      now: () => Date.parse(second.now),
    });
    const a = new Uint8Array([0, 255, 128]), b = new Uint8Array([0, 254, 128]);
    const frames = yield* call(() => parseBytes(new TextEncoder().encode(first.wire)));
    const next = yield* call(() => parseBytes(new TextEncoder().encode(second.wire)));
    try {
      const events = yield* call(() => parseBytes(new TextEncoder().encode(fixture.kel[0])));
      try {
        for (const event of events) yield* dispatchEnvelope(envelopeFromFrame(event), hby.rvy, hby.kevery);
      } finally {
        yield* call(() => Promise.all(events.map(discardFrame)));
      }
      const envelope = new KeriDispatchEnvelope({
        ...envelopeFromFrame(frames[0]),
        attachmentGroups: [...frames[0].attachments],
        ptds: [new PathedMaterialGroup(a), new PathedMaterialGroup(b), new PathedMaterialGroup(a)],
      });
      assertEquals(
        yield* kramer.intake(envelope, function*() {
          throw new Error("premature handoff");
        }),
        { kind: "drop", reason: "kramPending" },
      );
      yield* hby.db.reopen();
      let consumed = false;
      yield* kramer.intake(envelopeFromFrame(next[0]), function*(ready) {
        consumed = true;
        assertEquals(
          ready.ptds.map((item) => item.raw),
          [a, b],
          "UTF-8 replacement must not merge different byte values",
        );
      });
      assertEquals(consumed, true);
    } finally {
      yield* call(() => Promise.all([...frames, ...next].map(discardFrame)));
      yield* hby.close(true);
    }
  });
});
