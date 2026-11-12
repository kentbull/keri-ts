import { startServer } from "@keri-ts/hosting";
import { run, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { beginOobi, oobiStatus, resolveOobi } from "../../../../src/app/bootstrap/oobi-resolving.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  createAgentRuntime,
  runAgentRuntime,
  settleRuntimeIngress,
} from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { EndpointRoles } from "../../../../src/core/roles.ts";
import { waitForServer, waitForTaskHalt } from "../../../effection-http.ts";
import { reserveTcpPort } from "../../../http-test-support.ts";

Deno.test("resolveOobi reports resolved, failed and timed-out states from the Oobiery records", async () => {
  const sourceDir = await Deno.makeTempDir({ prefix: "oobi-resolving-src-" });
  const targetDir = await Deno.makeTempDir({ prefix: "oobi-resolving-dst-" });
  const port = reserveTcpPort();
  const deadPort = reserveTcpPort();
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
            const url = `http://127.0.0.1:${port}/oobi/${pre}/agent/${pre}`;

            // Queued but not run: pending, and unknown URLs are pending too.
            beginOobi(targetRuntime, url, { alias: "src" });
            assertEquals(oobiStatus(targetRuntime, url), { status: "pending" });
            assertEquals(oobiStatus(targetRuntime, "http://127.0.0.1:1/never"), { status: "pending" });

            // Zero budget expires before any worker turn can finish the job.
            const timedOut = yield* resolveOobi(targetRuntime, url, { timeoutMs: 0 });
            assertEquals(timedOut, { status: "timed-out", timeoutMs: 0 });

            const resolved = yield* resolveOobi(targetRuntime, url, { alias: "src" });
            assertEquals(resolved.status, "resolved");
            assertEquals(oobiStatus(targetRuntime, url).status, "resolved");
            assertExists(target.db.getState(pre));

            // Nothing listens on the second port: the Oobiery records the failure and its reason.
            const deadUrl = `http://127.0.0.1:${deadPort}/oobi/${pre}/agent/${pre}`;
            const failed = yield* resolveOobi(targetRuntime, deadUrl);
            assertEquals(failed.status, "failed");
            if (failed.status !== "failed") throw new Error("unreachable");
            assertEquals(failed.reason, failed.record.state ?? "failed");
            assertEquals(oobiStatus(targetRuntime, deadUrl).status, "failed");
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
