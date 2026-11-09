/**
 * Suite B: the private admin contract kf-boot relies on, per role and implementation.
 *
 * Driver: `service-admin.ts`, the client the TypeScript boot service uses, so a passing
 * run proves the client and each server together. TypeScript roles always run in-process.
 * Python roles run when their entrypoints are set (see `services.ts`), for example:
 *
 *   WITNESS_HK_BIN=$KERI/core/python/witness-hk/.venv/bin/witopnet \
 *   WATCHER_HK_BIN=$KERI/core/python/watcher-hk/.venv/bin/watopnet \
 *   KF_REGISTRAR_BIN=$KERI/core/python/kf-registrar/.venv/bin/kf-registrar \
 *   KF_OBSERVER_BIN=$KERI/core/python/kf-observer/.venv/bin/kf-observer \
 *   deno task test:contract
 *
 * Where implementations differ, the contract is the status class kf-boot acts on:
 * `GET /health` is any 2xx (witness-hk answers 204; watcher-hk serves none), and an
 * enrollment KEL that does not establish the account is any 4xx (Python 400, TS 409).
 */
import { concatBytes, t, Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assert, assertEquals, assertInstanceOf, assertRejects } from "jsr:@std/assert";
import { createHabery } from "keri-ts/db/lmdb";
import { FetchHttpClient } from "keri-ts/runtime";
import {
  BootApiError,
  RegistryAdmin,
  type ServiceAllocation,
  WatcherAdmin,
  WitnessAdmin,
} from "../../src/operator/kfboot/service-admin.ts";
import { implementations, type RunningService, startRegistries, startWatcher, startWitness } from "./services.ts";

const http = new FetchHttpClient();

/** Two independent public KELs: the enrolled account and an unrelated identifier. */
async function accounts(): Promise<{ aid: string; kel: string; other: string; otherKel: string }> {
  return await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true, skipSignator: true });
    try {
      const account = hby.makeHab("account"), other = hby.makeHab("other");
      const kel = (pre: string) => t(concatBytes(...hby.db.clonePreIter(pre, 0, Vrsn_2_0)));
      return { aid: account.pre, kel: kel(account.pre), other: other.pre, otherKel: kel(other.pre) };
    } finally {
      yield* hby.close();
    }
  });
}

/** Expect a typed refusal with a status in the given range. */
async function refused(operation: () => Promise<unknown>, low: number, high = low): Promise<number> {
  const error = await assertRejects(operation);
  assertInstanceOf(error, BootApiError);
  assert(error.status !== null && error.status >= low && error.status <= high, `status ${error.status}`);
  return error.status!;
}

/** Any 2xx from a listener's health route. */
async function healthStatus(url: string): Promise<number> {
  const response = await fetch(url + "/health");
  await response.body?.cancel();
  return response.status;
}

/** Allocation coordinates follow the Foundation shape and name a controller OOBI on the public URL. */
function assertAllocation(allocation: ServiceAllocation, aid: string, service: RunningService): void {
  assertEquals(allocation.cid, aid);
  assertEquals(allocation.oobis.length, 1);
  assertEquals(new URL(allocation.oobis[0]).origin, new URL(service.url).origin);
  assert(allocation.oobis[0].endsWith(`/oobi/${allocation.eid}/controller`), allocation.oobis[0]);
}

for (const impl of implementations("witness")) {
  Deno.test(`service admin contract: witness (${impl})`, async () => {
    const folder = await Deno.makeTempDir({ prefix: `tufa-witness-admin-${impl}-` });
    const { aid } = await accounts();
    let service: RunningService | undefined;
    try {
      service = await startWitness(impl, folder);
      const admin = new WitnessAdmin(service.boot, http);
      assert((await healthStatus(service.boot)) < 300);

      const allocation = await run(() => admin.allocate(aid, { idempotencyKey: "op:witness:w0:0" }));
      assertAllocation(allocation, aid, service);
      const oobi = await fetch(allocation.oobis[0]);
      await oobi.body?.cancel();
      assertEquals(oobi.status, 200);
      const second = await run(() => admin.allocate(aid));
      assert(second.eid !== allocation.eid, "each allocation is a distinct witness");

      await refused(() => run(() => admin.allocate("not-an-aid")), 400);
      await run(() => admin.remove(allocation.eid));
      await refused(() => run(() => admin.remove(allocation.eid)), 404);
      await run(() => admin.remove(second.eid));
    } finally {
      await service?.stop();
      await Deno.remove(folder, { recursive: true });
    }
  });
}

for (const impl of implementations("watcher")) {
  Deno.test(`service admin contract: watcher (${impl})`, async () => {
    const folder = await Deno.makeTempDir({ prefix: `tufa-watcher-admin-${impl}-` });
    const { aid } = await accounts();
    let witness: RunningService | undefined, service: RunningService | undefined;
    try {
      witness = await startWitness("typescript", folder);
      service = await startWatcher(impl, folder);
      const admin = new WatcherAdmin(service.boot, http);
      const witnessOobi = (await run(() => new WitnessAdmin(witness!.boot, http).allocate(aid))).oobis[0];

      // kf-boot allocates the watcher with the first witness OOBI; the bare form is also valid.
      const watcher = await run(() => admin.allocate(aid, { oobi: witnessOobi, idempotencyKey: "op:watcher" }));
      assertAllocation(watcher, aid, service);
      const bare = await run(() => admin.allocate(aid));
      assertAllocation(bare, aid, service);
      await refused(() => run(() => admin.allocate(aid, { oobi: "ftp://example.com/oobi" })), 400);
      await refused(() => run(() => admin.allocate("not-an-aid")), 400);

      const status = await run(() => admin.status(watcher.eid));
      assertEquals(Object.keys(status).sort(), ["aids", "controller_id", "summary", "watcher_id"]);
      assertEquals(status.watcher_id, watcher.eid);
      assertEquals(status.controller_id, aid);
      assertEquals(
        Object.keys(status.summary as Record<string, unknown>).sort(),
        ["last_query_time", "responsive_witnesses", "total_aids", "total_witnesses"],
      );

      await run(() => admin.remove(watcher.eid));
      await refused(() => run(() => admin.status(watcher.eid)), 404);
      await run(() => admin.remove(bare.eid));
    } finally {
      await service?.stop();
      await witness?.stop();
      await Deno.remove(folder, { recursive: true });
    }
  });
}

/** Registrar and observer share one admin contract with distinct role vocabularies. */
const registries = [
  ...new Set([...implementations("registrar"), ...implementations("observer")]),
].filter(impl => impl === "typescript" || (Deno.env.get("KF_REGISTRAR_BIN") && Deno.env.get("KF_OBSERVER_BIN")));

for (const impl of registries) {
  Deno.test(`service admin contract: registrar and observer (${impl})`, async () => {
    const folder = await Deno.makeTempDir({ prefix: `tufa-registry-admin-${impl}-` });
    const { aid, kel, other, otherKel } = await accounts();
    let services: Awaited<ReturnType<typeof startRegistries>> | undefined;
    try {
      services = await startRegistries(impl, folder);
      const cases = [
        { service: services.registrar, roles: ["publisher"], foreign: ["reader"] },
        { service: services.observer, roles: ["reader"], foreign: ["publisher"] },
      ];
      for (const { service, roles, foreign } of cases) {
        const admin = new RegistryAdmin(service.boot, http);
        assertEquals(await healthStatus(service.boot), 200);

        await refused(() => run(() => admin.account(aid)), 404);
        const enrolled = await run(() => admin.enroll(aid, roles, kel, { idempotencyKey: "op:services" }));
        assertEquals(enrolled, { aid, roles, service: service.aid! });
        // Re-activation re-PUTs the same roles and receives the same acknowledgement.
        assertEquals(await run(() => admin.enroll(aid, roles, kel)), enrolled);
        assertEquals(await run(() => admin.account(aid)), enrolled);

        await refused(() => run(() => admin.enroll(aid, foreign, kel)), 400);
        await refused(() => run(() => admin.enroll(aid, [], kel)), 400);
        await refused(() => run(() => admin.enroll(aid, [...roles, ...roles], kel)), 400);
        // A KEL that does not establish the path's account: Python 400, TypeScript 409.
        await refused(() => run(() => admin.enroll(other, roles, kel)), 400, 499);
        await refused(() => run(() => admin.enroll(aid, roles, "not a KEL")), 400);
        assertEquals(await run(() => admin.account(aid)), enrolled);

        await run(() => admin.remove(aid));
        await run(() => admin.remove(aid));
        await refused(() => run(() => admin.account(aid)), 404);
        // The unrelated identifier enrolls with its own KEL.
        assertEquals((await run(() => admin.enroll(other, roles, otherKel))).aid, other);
        await run(() => admin.remove(other));
      }
    } finally {
      await services?.observer.stop();
      await services?.registrar.stop();
      await Deno.remove(folder, { recursive: true });
    }
  });
}
