import type { SerderKERI } from "cesr-ts";
import { run, sleep, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  type IpexArrivalDeps,
  ipexArrivalStatus,
  ipexBaseline,
  MailboxIntakeTally,
  settleStoredGrants,
  type StoredGrantSettleDeps,
  waitForIpexArrival,
} from "../../../../src/app/mailbox/ipex-arrival.ts";
import type { MailboxPollBatch } from "../../../../src/app/mailbox/mailbox-poller.ts";

/** Durable-state fake: only the two stores the status read touches. */
function fakeStores() {
  const exns: SerderKERI[] = [];
  const saved: string[] = [];
  const deps = {
    hby: { db: { exns: { getTopItemIter: () => exns.map((exn) => [[exn.said], exn]) } } },
    reger: {
      saved: {
        getTopItemIter: () => saved.map((said) => [[said], true]),
        get: ([said]: string[]) => saved.includes(said!) ? true : undefined,
      },
    },
  } as unknown as IpexArrivalDeps;
  const exn = (said: string, route: string, extra: object = {}) =>
    ({ said, route, ked: {}, ...extra }) as unknown as SerderKERI;
  return { exns, saved, deps, exn };
}

Deno.test("ipexArrivalStatus reports only new /ipex/ messages and saved credentials, and gates on mid-settle batches", () => {
  const { exns, saved, deps, exn } = fakeStores();
  exns.push(exn("Eold", "/ipex/grant"));
  saved.push("Cold");
  const baseline = ipexBaseline(deps);
  assertEquals(ipexArrivalStatus(deps, baseline), { state: "waiting", ipex: [], saved: [], receiving: false });

  exns.push(exn("Echallenge", "/challenge/response"));
  assertEquals(ipexArrivalStatus(deps, baseline).state, "waiting", "non-IPEX traffic is not an arrival");

  exns.push(exn("Enew", "/ipex/admit"));
  const tally = new MailboxIntakeTally();
  tally.receiving = 1;
  assertEquals(
    ipexArrivalStatus(deps, baseline, tally).state,
    "waiting",
    "a batch still settling holds the arrival back",
  );
  tally.receiving = 0;
  const arrived = ipexArrivalStatus(deps, baseline, tally);
  assertEquals(arrived.state, "arrived");
  assertEquals(arrived.ipex.map((message) => message.said), ["Enew"]);

  saved.push("Cnew", "Cnew");
  assertEquals(ipexArrivalStatus(deps, baseline).saved, ["Cnew"]);
});

Deno.test("MailboxIntakeTally counts settled batches and releases on failure", async () => {
  const tally = new MailboxIntakeTally();
  const batch = { pre: "E1", eid: "E2", messages: [new Uint8Array(1), new Uint8Array(2)] } as MailboxPollBatch;
  await run(function*() {
    yield* tally.track(batch, function*() {
      assertEquals(tally.receiving, 1);
    });
  });
  assertEquals([tally.receiving, tally.batches, tally.messages], [0, 1, 2]);
  try {
    await run(() =>
      tally.track(batch, function*() {
        throw new Error("settle failed");
      })
    );
  } catch { /* expected */ }
  assertEquals([tally.receiving, tally.batches], [0, 1], "a failed batch is not counted and is no longer receiving");
});

Deno.test("waitForIpexArrival only observes: the host's own work makes state arrive, and a timeout is a value", async () => {
  const { exns, deps, exn } = fakeStores();
  const baseline = ipexBaseline(deps);
  let settles = 0;
  const waitDeps = {
    ...deps,
    settle: function*() {
      settles++;
    },
  };

  const timedOut = await run(() => waitForIpexArrival(waitDeps, baseline, { timeoutMs: 30, pollMs: 5 }));
  assertEquals(timedOut.outcome, "timed-out");
  assertEquals(timedOut.status.state, "waiting");
  assertEquals(settles > 0, true, "the host settle hook runs before each read");

  const settled = await run(function*() {
    yield* spawn(function*() {
      yield* sleep(10);
      exns.push(exn("Egrant", "/ipex/grant"));
    });
    return yield* waitForIpexArrival(deps, baseline, { timeoutMs: 1000, pollMs: 5 });
  });
  assertEquals(settled.outcome, "settled");
  assertEquals(settled.status.ipex.map((message) => message.said), ["Egrant"]);
});

Deno.test("settleStoredGrants replays only grants whose credential is unsaved", async () => {
  const { exns, saved, deps, exn } = fakeStores();
  const grant = (said: string, credential: string) =>
    exn(said, "/ipex/grant", { ked: { e: { acdc: { d: credential } } } });
  exns.push(grant("Eg1", "Csaved"), grant("Eg2", "Cmissing"), exn("Eadmit", "/ipex/admit"));
  saved.push("Csaved");
  const replayed: string[] = [];
  const settleDeps = {
    ...deps,
    hby: {
      db: {
        ...(deps.hby as unknown as { db: object }).db,
        epath: { get: ([said]: string[]) => (replayed.push(said!), []) },
      },
    },
    protocol: {},
  } as unknown as StoredGrantSettleDeps;
  try {
    await run(() => settleStoredGrants(settleDeps));
  } catch { /* the empty fake evidence cannot be replayed; only the selection is under test */ }
  assertEquals(replayed, ["Eg2"]);
});
