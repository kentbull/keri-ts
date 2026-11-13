/** Fixed-tock doers: a pass, then a wait of one tock on the runtime clock; no sleeping to a variable time, no wake. */
import { call, run, spawn } from "effection";
import { assert, assertEquals } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { kelPublisherDo } from "../../../../src/app/mailbox/kel-publisher.ts";
import { KelPublisher } from "../../../../src/app/mailbox/kel-publisher.ts";
import { doEvery } from "../../../../src/app/runtime/doing.ts";
import { FakeRuntimeHttpClient, ManualRuntimeClock } from "../../../support/runtime-fakes.ts";

/** Let every pending macrotask run, so a doer that is not waiting on the clock shows itself. */
const settle = () => call(() => new Promise<void>((resolve) => setTimeout(resolve, 5)));

Deno.test("doEvery waits the fixed tock after each pass whatever the pass cost", async () => {
  await run(function*() {
    const clock = new ManualRuntimeClock(0), costs = [0, 400, 0, 90], tocks: number[] = [];
    yield* spawn(() =>
      doEvery(clock, 31.25, function*(tock) {
        tocks.push(tock);
        clock.advance(costs[tock] ?? 0); // a costly pass takes long on the clock the doer waits on
        yield* call(() => Promise.resolve());
      })
    );
    yield* settle();
    assertEquals(tocks, [0], "one pass, then the doer waits on the clock");
    for (let tock = 1; tock < costs.length; tock++) {
      clock.advance(31.25);
      yield* settle();
      assertEquals(tocks.length, tock + 1, "the tock after a pass runs the next pass, however costly the last was");
    }
  });
});

/** An identifier with a mailbox role and URL, the mailbox recording what it is posted. */
function* publishing() {
  const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  const http = new FakeRuntimeHttpClient(), posts: string[] = [];
  http.registerOrigin("http://alpha.test/", async (request) => {
    posts.push(new TextDecoder().decode(await request.arrayBuffer()));
    return new Response(null, { status: 204 });
  });
  const hab = hby.makeHab("wallet", undefined, { transferable: true, toad: 0, wits: [] });
  hby.db.locs.pin(["alpha", "http"], { url: "http://alpha.test/" });
  const clock = new ManualRuntimeClock(1_000);
  return { hby, hab, posts, clock, publisher: new KelPublisher({ hby, http, clock }) };
}

Deno.test("a mailbox authorized between tocks is posted on the next tock, and idle tocks read no store", async () => {
  await run(function*() {
    const { hby, hab, posts, clock, publisher } = yield* publishing();
    try {
      let walks = 0;
      const habs = hby.habs;
      const values = habs.values.bind(habs);
      habs.values = () => (walks++, values());
      yield* spawn(() => kelPublisherDo(publisher, clock, { tockMs: 250, sweepTocks: 240 }));
      yield* settle();
      const swept = walks; // the prune and the marking each walk the identifiers once
      assertEquals([swept > 0, posts.length], [true, 0], "the sweep on tock 0 walked every identifier");
      for (let tock = 1; tock <= 3; tock++) {
        clock.advance(250);
        yield* settle();
      }
      assertEquals(walks, swept, "idle tocks do not walk the identifiers");
      hby.db.ends.pin([hab.pre, "mailbox", "alpha"], { allowed: true });
      publisher.prompt(hab.pre);
      clock.advance(250);
      yield* settle();
      assertEquals(posts.length, 1, "the prompt is acted on at the next tock, with no wake");
      assert(hby.db.kpub.get([hab.pre, "alpha"])?.d, "and the marker is pinned");
      for (let tock = 0; tock < 240; tock++) {
        clock.advance(250);
        yield* settle();
      }
      assertEquals(walks, 2 * swept, "the next full sweep is sweepTocks later");
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("a rotated cue is handled on the next tock", async () => {
  await run(function*() {
    const { hby, hab, posts, clock, publisher } = yield* publishing();
    try {
      hby.db.ends.pin([hab.pre, "mailbox", "alpha"], { allowed: true });
      yield* spawn(() => kelPublisherDo(publisher, clock, { tockMs: 250, sweepTocks: 240 }));
      yield* settle();
      assertEquals(posts.length, 1, "the first sweep posts the owed KEL");
      hab.rotate({});
      publisher.rotated.push({ kin: "rotated", pre: hab.pre, sn: 1, said: hab.kever!.serder.said! });
      clock.advance(250);
      yield* settle();
      assertEquals(posts.length, 2, "the cue marks the identifier and the next tock posts the new KEL");
    } finally {
      yield* hby.close(true);
    }
  });
});
