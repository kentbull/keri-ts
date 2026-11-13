/** `KelPublisher`: the KEL posts a wallet's identifiers owe their mailboxes, derived from state. */
import { Diger, NumberPrimitive, Siger } from "cesr-ts";
import { run } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { KelPublisher } from "../../../../src/app/mailbox/kel-publisher.ts";
import { dgKey } from "../../../../src/db/core/keys.ts";
import { FakeRuntimeHttpClient, ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

/** A wallet identifier with mailboxes `allowed` (a role) and `cut` (a revoked role), each with a URL. */
function wallet(hby: Habery, { allowed, cut = [], wits = [] }: { allowed: string[]; cut?: string[]; wits?: Hab[] }) {
  const hab = hby.makeHab("wallet", undefined, {
    transferable: true,
    toad: wits.length ? 1 : 0,
    wits: wits.map((wit) => wit.pre),
  });
  for (const [eid, ok] of [...allowed.map((eid) => [eid, true] as const), ...cut.map((eid) => [eid, false] as const)]) {
    hby.db.ends.pin([hab.pre, "mailbox", eid], { allowed: ok });
    hby.db.locs.pin([eid, "http"], { url: `http://${eid}.test/` });
  }
  return hab;
}

/** Mailbox hosts that record the bodies posted to them; `answers` maps an eid to its status. */
function hosts(eids: string[], answers: Record<string, number> = {}) {
  const http = new FakeRuntimeHttpClient();
  const posts: { eid: string; body: string }[] = [];
  for (const eid of eids) {
    http.registerOrigin(`http://${eid}.test/`, async (request) => {
      posts.push({ eid, body: new TextDecoder().decode(await request.arrayBuffer()) });
      return new Response(null, { status: answers[eid] ?? 204 });
    });
  }
  return { http, posts, answers };
}

const open = () => createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });

Deno.test("a rotated cue posts the KEL to each authorized mailbox once and pins the marker", async () => {
  await run(function*() {
    const hby = yield* open();
    try {
      const { http, posts } = hosts(["alpha", "beta", "gamma"]);
      const hab = wallet(hby, { allowed: ["alpha", "beta"], cut: ["gamma"] });
      hby.db.kpub.pin([hab.pre, "gamma"], { d: "EOld", dt: "2026-01-01T00:00:00.000000+00:00" });
      const publisher = new KelPublisher({ hby, http, clock: new ManualRuntimeClock(1_000) });
      hab.rotate({});
      publisher.rotated.push({ kin: "rotated", pre: hab.pre, sn: 1, said: hab.kever!.serder.said! });
      const results = yield* publisher.processOnce();
      assertEquals(results, [{ mailbox: "alpha", outcome: "told" }, { mailbox: "beta", outcome: "told" }]);
      assertEquals(posts.map((post) => post.eid), ["alpha", "beta"], "the cut role is not told");
      assert(posts[0].body.includes("\"rot\"") && posts[0].body.includes("\"icp\""), "the post carries the whole KEL");
      for (const eid of ["alpha", "beta"]) {
        assertEquals(hby.db.kpub.get([hab.pre, eid])?.d, hab.kever!.lastEst.d);
      }
      assertEquals(hby.db.kpub.get([hab.pre, "gamma"]), null, "the marker of a cut role is dropped");
      assertEquals(yield* publisher.processOnce(), [], "nothing is owed once the markers show the event");
      assertEquals(posts.length, 2);
      assertEquals(publisher.status().entries.map((entry) => [entry.mailbox, entry.state]), [
        ["alpha", "published"],
        ["beta", "published"],
      ]);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("an unwitnessed or unanchored rotation is held until complete", async () => {
  await run(function*() {
    const hby = yield* open();
    try {
      const witness = hby.makeHab("witness", undefined, { transferable: false, ncount: 0 });
      const { http, posts } = hosts(["alpha"]);
      const hab = wallet(hby, { allowed: ["alpha"], wits: [witness] });
      const publisher = new KelPublisher({ hby, http, clock: new ManualRuntimeClock(1_000) });
      const status = (lastFailure: string) => ({
        entries: [
          {
            pre: hab.pre,
            mailbox: "alpha",
            state: "waiting" as const,
            said: hab.kever!.lastEst.d,
            attempts: 0,
            lastFailure,
          },
        ],
      });
      assertEquals(yield* publisher.processOnce(), []);
      assertEquals(publisher.status(), status("unwitnessed"));
      const said = hab.kever!.lastEst.d, serder = hby.db.getEvtSerder(hab.pre, said)!;
      const signature = witness.sign(serder.raw, true)[0];
      hby.db.wigs.put(dgKey(hab.pre, said), [new Siger({ code: signature.code, raw: signature.raw, index: 0 })]);
      // A delegated identifier is also held until its authorizing source seal is stored.
      hab.kever!.delegated = true;
      assertEquals(yield* publisher.processOnce(), []);
      assertEquals(publisher.status(), status("unanchored"));
      hby.db.aess.pin(dgKey(hab.pre, said), [NumberPrimitive.fromNum(1n), new Diger({ qb64: said })]);
      assertEquals((yield* publisher.processOnce()).map((result) => result.outcome), ["told"]);
      assertEquals(posts.length, 1);
      assertEquals(publisher.status().entries[0].state, "published");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("a publisher opened after a crash sends what the record shows is owed", async () => {
  await run(function*() {
    const hby = yield* open();
    try {
      const { http, posts } = hosts(["alpha", "beta"]);
      const hab = wallet(hby, { allowed: ["alpha", "beta"] });
      // beta already holds the inception's KEL; the rotation then happened with no cue ever delivered.
      hby.db.kpub.pin([hab.pre, "beta"], { d: hab.kever!.lastEst.d, dt: "2026-01-01T00:00:00.000000+00:00" });
      hby.db.kpub.pin([hab.pre, "alpha"], { d: hab.kever!.lastEst.d, dt: "2026-01-01T00:00:00.000000+00:00" });
      hab.rotate({});
      const publisher = new KelPublisher({ hby, http, clock: new ManualRuntimeClock(1_000) });
      assertEquals(publisher.rotated.empty, true);
      assertEquals((yield* publisher.processOnce()).map((result) => result.mailbox), ["alpha", "beta"]);
      assertEquals(posts.length, 2);
      assertEquals(hby.db.kpub.get([hab.pre, "alpha"])?.d, hab.kever!.lastEst.d);
      assertEquals(yield* publisher.processOnce(), []);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("an unreachable mailbox is retried with doubling delays and given up after five minutes", async () => {
  await run(function*() {
    const hby = yield* open();
    try {
      const { http, posts, answers } = hosts(["alpha"], { alpha: 500 });
      const hab = wallet(hby, { allowed: ["alpha"] });
      hab.rotate({});
      const clock = new ManualRuntimeClock(0);
      const publisher = new KelPublisher({ hby, http, clock });
      const attempts: number[] = [];
      // Walk the clock one second at a time so each attempt lands on its scheduled second.
      for (let second = 0; second <= 400; second++) {
        const before = posts.length;
        yield* publisher.processOnce();
        if (posts.length > before) attempts.push(second);
        clock.advance(1_000);
      }
      assertEquals(attempts, [0, 1, 3, 7, 15, 31, 63, 123, 183, 243], "no attempt follows past the 300 s budget");
      const entry = publisher.status().entries[0];
      assertEquals([entry.state, entry.attempts, entry.lastFailure], ["timed-out", 10, "HTTP 500"]);
      assertEquals(hby.db.kpub.get([hab.pre, "alpha"])?.failed?.attempts, 10);
      assertEquals(hby.db.kpub.get([hab.pre, "alpha"])?.d, null);
      // The mailbox comes back and answers a poll: that re-arms the entry, and the next attempt succeeds.
      answers.alpha = 204;
      publisher.prompt(hab.pre, "alpha");
      assertEquals((yield* publisher.processOnce()).map((result) => result.outcome), ["told"]);
      assertEquals(publisher.status().entries[0].state, "published");
      assertEquals(hby.db.kpub.get([hab.pre, "alpha"])?.failed, undefined);
      assertEquals(hby.db.kpub.get([hab.pre, "alpha"])?.d, hab.kever!.lastEst.d);
    } finally {
      yield* hby.close(true);
    }
  });
});
