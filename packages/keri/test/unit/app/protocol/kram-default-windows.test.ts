/** `kram: { enabled: true }` without configured caches uses the built-in default windows. */
import { Diger, Prefixer, Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { DEFAULT_KRAM_CACHES, KramPolicy } from "../../../../src/core/mailbox/kram-policy.ts";
import { serializeMessage } from "../../../../src/core/protocol-serialization.ts";
import { createBaser } from "../../../../src/db/lmdb-stores.ts";
import { makeNowIso8601 } from "../../../../src/time/mod.ts";

Deno.test("enabled KRAM without caches admits a timely v2 exn and rejects a stale one", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    const sender = hby.makeHab("sender");
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, { kram: { enabled: true } });
    const send = function*(stamp: string) {
      const message = exchange("/unqualified", { n: crypto.randomUUID() }, {
        sender: sender.pre,
        recipient: sender.pre,
        pvrsn: Vrsn_2_0,
        stamp,
      })[0];
      const tsg = new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sender.sign(message.raw, true),
      );
      yield* runtime.reactor.processBytes(serializeMessage(message, { tsgs: [tsg], gvrsn: Vrsn_2_0 }));
      return message.said!;
    };
    try {
      const timely = yield* send(makeNowIso8601());
      assertExists(hby.db.exns.get([timely]), "timely exn is admitted");
      assertExists(hby.db.msgc.get([sender.pre, timely]) ?? hby.db.tmsc.get([sender.pre, "", timely]));
      const stale = yield* send(makeNowIso8601(new Date(Date.now() - 3_600_000)));
      assertEquals(hby.db.exns.get([stale]), null, "stale exn is refused by the default window");
      assertEquals(hby.db.ctyp.get("~") !== null, true);
      assertEquals(runtime.reactor.kvy.kramer!.prune().kind, "pruned");
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});

Deno.test("enabled policy without caches installs the defaults, including over a store first opened with KRAM off", async () => {
  await run(function*() {
    const db = yield* createBaser({ name: crypto.randomUUID(), temp: true });
    try {
      assertEquals(Object.keys(DEFAULT_KRAM_CACHES), ["~"]);
      new KramPolicy(db, {});
      assertEquals(db.ctyp.get("~"), null, "disabled policy installs no windows");
      const policy = new KramPolicy(db, { enabled: true });
      const [d, sl, ll, xl, psl, pll, pxl] = DEFAULT_KRAM_CACHES["~"];
      assertEquals(policy.cacheType("exn", "/ipex/grant"), { d, sl, ll, xl, psl, pll, pxl });
      const configured = new KramPolicy(db, {
        enabled: true,
        caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] },
      });
      assertEquals(configured.cacheType("qry", null).sl, 5000);
      assertEquals(new KramPolicy(db, { enabled: true }).cacheType("qry", null).sl, 5000, "stored windows are kept");
    } finally {
      yield* db.close(true);
    }
  });
});
