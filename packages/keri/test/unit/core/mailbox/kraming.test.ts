/** Kramer.intake signals a remote refusal to the runtime only for reasons decided after authentication. */
import { Dater, type SerderKERI } from "cesr-ts";
import { type Operation, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import type { KramRefusedCue } from "../../../../src/core/cues.ts";
import { KeriDispatchEnvelope } from "../../../../src/core/dispatch.ts";
import { Kramer } from "../../../../src/core/mailbox/kraming.ts";
import { exchange } from "../../../../src/core/protocol-eventing.ts";
import { encodeDateTimeToDater, makeNowIso8601 } from "../../../../src/time/mod.ts";

/** Single-signature windows: 1s drift, 5s lag, 5min exchange lifetime. */
const caches = { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } as const;
const clock = Date.parse("2026-10-13T12:00:00.000Z");
const at = (offsetMs: number) => makeNowIso8601(new Date(clock + offsetMs));
const HOUR = 3_600_000;
const XID = "EBfdlu8R27Fbx-ehrqwImnK-8Cm79sqbAQ4MmvEAYqao";
const PRIOR = "EGjrMvCJ2rTCbfHbVB7i5Xq5_0kBU2h7cLm0GZ1JpQ3k";

/** One receiver over a real store, with a single-key sender whose exchange messages it can verify. */
function* receiver(
  then: (h: {
    kramer: Kramer;
    db: Kramer["db"];
    exn: (stamp: string, options?: { signed?: boolean; local?: boolean; xid?: string; prior?: string }) => {
      body: SerderKERI;
      envelope: KeriDispatchEnvelope;
    };
  }) => Operation<void>,
): Operation<void> {
  const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  try {
    const sender = hby.makeHab("sender");
    const kramer = new Kramer(hby.db, { config: { enabled: true, caches }, now: () => clock });
    const exn = (
      stamp: string,
      { signed = true, local = false, xid = "", prior = "" }: {
        signed?: boolean;
        local?: boolean;
        xid?: string;
        prior?: string;
      } = {},
    ) => {
      // A unique route keeps each message SAID distinct; stamp, xid and prior decide the refusal.
      const body = exchange(`/kram/${crypto.randomUUID()}`, { sender: sender.pre, stamp, xid, prior });
      const sigers = signed ? sender.sign(body.raw, true) : [];
      return { body, envelope: new KeriDispatchEnvelope({ serder: body, sigers, attachmentGroups: [], local }) };
    };
    yield* then({ kramer, db: hby.db, exn });
  } finally {
    yield* hby.close(true);
  }
}

/** The cue Kramer is expected to publish for one refused message. */
function expected(body: SerderKERI, fields: Pick<KramRefusedCue, "reason"> & Partial<KramRefusedCue>): KramRefusedCue {
  return {
    kin: "kramRefused",
    said: body.said!,
    sender: body.pre!,
    ilk: "exn",
    route: body.route,
    stamp: body.stamp!,
    ...fields,
  };
}

Deno.test("intake cues kramRefused with deadline for a late authenticated message", async () => {
  await run(function*() {
    yield* receiver(function*({ kramer, exn }) {
      const { body, envelope } = exn(at(-HOUR));
      assertEquals(kramer.intake(envelope).kind, "drop");
      // Stamp plus one second drift plus five seconds single-signature lag.
      assertEquals(kramer.cues.pull(), expected(body, { reason: "timeliness", deadline: at(-HOUR + 6000) }));
      assertEquals(kramer.cues.length, 0);
    });
  });
});

Deno.test("intake cues kramRefused with xid for lifetime and unknownThread", async () => {
  await run(function*() {
    yield* receiver(function*({ kramer, db, exn }) {
      const stray = exn(at(0), { xid: XID, prior: PRIOR });
      assertEquals(kramer.intake(stray.envelope), { kind: "drop", reason: "unknownThread" });
      assertEquals(kramer.cues.pull(), expected(stray.body, { reason: "unknownThread", xid: XID }));

      const opener = at(-HOUR);
      db.xdt.pin(XID, new Dater({ qb64: encodeDateTimeToDater(opener) }));
      const late = exn(at(0), { xid: XID, prior: PRIOR });
      assertEquals(kramer.intake(late.envelope).kind, "drop");
      assertEquals(
        kramer.cues.pull(),
        expected(late.body, { reason: "lifetime", xid: XID, deadline: at(-HOUR + 300000) }),
      );
      assertEquals(kramer.cues.length, 0);
    });
  });
});

Deno.test("intake cues nothing for timestamp, replay or authentication refusals", async () => {
  await run(function*() {
    yield* receiver(function*({ kramer, exn }) {
      assertEquals(kramer.intake(exn(at(-HOUR), { signed: false }).envelope), {
        kind: "drop",
        reason: "authentication",
      });
      assertEquals(kramer.intake(exn("not a timestamp").envelope), { kind: "drop", reason: "timestamp" });

      const fresh = exn(at(0));
      assertEquals(kramer.intake(fresh.envelope).kind, "ready");
      assertEquals(kramer.intake(fresh.envelope), { kind: "drop", reason: "replay" });
      assertEquals(kramer.cues.length, 0, "the unauthenticated reasons keep only the log line");
    });
  });
});

Deno.test("intake cues nothing for a local envelope", async () => {
  await run(function*() {
    yield* receiver(function*({ kramer, exn }) {
      const { envelope } = exn(at(-HOUR), { local: true });
      assertEquals(kramer.intake(envelope).kind, "drop", "the local caller still sees the refusal");
      assertEquals(kramer.cues.length, 0);
    });
  });
});

Deno.test("an exchange message with a stamp Dater cannot encode or a malformed exchange id is dropped before any write", async () => {
  await run(function*() {
    yield* receiver(function*({ kramer, db, exn }) {
      // A valid RFC3339 stamp without the fixed-width fraction would become this thread's stored opener Dater.
      const short = exn("2026-10-13T12:00:00Z", { xid: XID });
      assertEquals(kramer.intake(short.envelope), { kind: "drop", reason: "timestamp" });
      // An exchange id that is not one qualified digest is a cache key part the pruner could not split.
      const dotted = exn(at(0), { xid: `${XID}.extra` });
      assertEquals(kramer.intake(dotted.envelope), { kind: "drop", reason: "exchangeId" });
      assertEquals([...db.tmsc.getTopItemIter()].length, 0, "a refused message leaves no cache row");
      kramer.prune();
      assertEquals(kramer.cues.length, 0, "both are reachable without authentication and keep only the log line");
    });
  });
});
