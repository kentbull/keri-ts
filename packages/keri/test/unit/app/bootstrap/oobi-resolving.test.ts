import { startServer } from "@keri-ts/hosting";
import { run, sleep, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { beginOobi, oobiStatus, resolveOobi, waitForOobi } from "../../../../src/app/bootstrap/oobi-resolving.ts";
import type { Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  createAgentRuntime,
  runAgentRuntime,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { MemoryChangeSink } from "../../../../src/app/runtime/workflow-contract.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { withRuntimeWorkers } from "../../../../src/cli/common/runtime-workers.ts";
import { EndpointRoles } from "../../../../src/core/roles.ts";
import { waitForServer, waitForTaskHalt } from "../../../effection-http.ts";
import { reserveTcpPort } from "../../../http-test-support.ts";

Deno.test("resolveOobi reports resolved, failed and timed-out states from the Oobiery records", async () => {
  const sourceDir = await Deno.makeTempDir({ prefix: "oobi-resolving-src-" });
  const targetDir = await Deno.makeTempDir({ prefix: "oobi-resolving-dst-" });
  const port = reserveTcpPort();
  let pre = "";
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: "source", headDirPath: sourceDir, skipConfig: true });
      try {
        const hab = hby.makeHab("source", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        pre = hab.pre;
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
          enableMailboxStore: true,
        });
        yield* settleRuntimeIngress(runtime, [
          hab.makeLocScheme(`http://127.0.0.1:${port}`, hab.pre, "http"),
          hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
          hab.makeEndRole(hab.pre, EndpointRoles.agent, true),
        ]);
        const serverTask = yield* spawn(() => startServer(port, undefined, runtime));
        yield* waitForServer(port);
        const runtimeTask = yield* spawn(() => runAgentRuntime(runtime, { hab }));
        try {
          const target = yield* createHabery({ name: "target", headDirPath: targetDir, skipConfig: true });
          const targetRuntime = yield* createAgentRuntime(target, new FetchHttpClient(), systemClock);
          try {
            const deps = { oobiery: targetRuntime.oobiery, db: target.db };
            const url = `http://127.0.0.1:${port}/oobi/${pre}/agent/${pre}`;

            // Queued but not run: pending, and unknown URLs are pending too.
            beginOobi(deps, url, { alias: "src" });
            assertEquals(oobiStatus(target, url), { status: "pending" });
            assertEquals(oobiStatus(target, "http://127.0.0.1:1/never"), { status: "pending" });

            // Zero budget expires before any worker turn can finish the job.
            const timedOut = yield* resolveOobi(deps, url, { timeoutMs: 0 });
            assertEquals(timedOut, { status: "timed-out", timeoutMs: 0 });

            const resolved = yield* withRuntimeWorkers(
              targetRuntime,
              { pollMailbox: false },
              () => resolveOobi(deps, url, { alias: "src" }),
            );
            assertEquals(resolved.status, "resolved");
            assertEquals(oobiStatus(target, url).status, "resolved");
            assertExists(target.db.getState(pre));

            // The provider hosts no such AID, so it answers 404 and the Oobiery records the
            // failure with that reason.
            const unknown = target.makeHab("unknown").pre;
            const deadUrl = `http://127.0.0.1:${port}/oobi/${unknown}/controller`;
            const failed = yield* withRuntimeWorkers(
              targetRuntime,
              { pollMailbox: false },
              () => resolveOobi(deps, deadUrl),
            );
            assertEquals(failed.status, "failed");
            if (failed.status !== "failed") throw new Error("unreachable");
            assertEquals(failed.reason, "http-404");
            assertEquals(failed.record.state, "http-404");
            assertEquals(oobiStatus(target, deadUrl).status, "failed");
          } finally {
            yield* targetRuntime.close();
            yield* target.close();
          }
        } finally {
          yield* waitForTaskHalt(runtimeTask);
          yield* waitForTaskHalt(serverTask);
          yield* runtime.close();
        }
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(sourceDir, { recursive: true });
    await Deno.remove(targetDir, { recursive: true });
  }
});

Deno.test("waitForOobi only observes: it ends on the host-recorded terminal row and reports a timeout as a value", async () => {
  const rows = new Map<string, unknown>();
  const empty = { get: () => undefined };
  // Reading any store beyond the OOBI records, or any runtime part, fails the test.
  const db = new Proxy({
    oobis: empty,
    coobi: empty,
    moobi: empty,
    eoobi: empty,
    woobi: empty,
    mfa: empty,
    rmfa: empty,
    roobi: { get: (url: string) => rows.get(url) },
  }, {
    get(target, prop, receiver) {
      if (!(prop in target)) throw new Error(`unexpected store access: ${String(prop)}`);
      return Reflect.get(target, prop, receiver);
    },
  }) as unknown as Habery["db"];
  const sink = new MemoryChangeSink();
  const deps = { db, changes: sink };
  const url = "http://127.0.0.1:1/oobi/Eabc/controller";

  assertEquals(await run(() => waitForOobi(deps, url, { timeoutMs: 20 })), { status: "timed-out", timeoutMs: 20 });
  assertEquals(sink.changes, []);

  const result = await run(function*() {
    yield* spawn(function*() {
      yield* sleep(5);
      rows.set(url, { state: "resolved" });
    });
    return yield* waitForOobi(deps, url, { timeoutMs: 1000 });
  });
  assertEquals(result.status, "resolved");
  assertEquals(sink.changes, [{ kind: "oobi", id: url }]);
});
