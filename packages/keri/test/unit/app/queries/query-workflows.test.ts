import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  anchorQueryStatus,
  beginKeyStateQuery,
  queryAnchor,
  queryKeyState,
} from "../../../../src/app/queries/query-workflows.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";

const anchor = { i: "Eanchored", s: "1", d: "Eanchoreddigest" };

Deno.test("library queries time out when accepted evidence never arrives", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "query-workflows-" });
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: "wf", headDirPath, temp: false, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const hab = hby.makeHab("requester");
        const prefix = hby.makeHab("subject").pre;

        assertEquals(yield* queryKeyState(runtime, { hab, prefix }, { timeoutMs: 50 }), {
          status: "timed-out",
          timeoutMs: 50,
        });

        assertEquals(anchorQueryStatus(hby, prefix, anchor), "pending");
        assertEquals(yield* queryAnchor(runtime, { hab, prefix, anchor }, { timeoutMs: 50 }), {
          status: "timed-out",
          timeoutMs: 50,
        });

        // A begun run is observable without waiting, and a timed-out wait leaves it running.
        const started = yield* beginKeyStateQuery(runtime, { hab, prefix });
        try {
          assertEquals(started.status(), "pending");
          assertEquals((yield* started.wait({ timeoutMs: 20 })).status, "timed-out");
          assertEquals(started.status(), "pending");
        } finally {
          yield* started.halt();
        }
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});
