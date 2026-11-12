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
import type { AgentCue } from "../../../../src/core/cues.ts";
import { Deck } from "../../../../src/core/deck.ts";

function strict<T extends object>(deps: T): T {
  return new Proxy(deps, {
    get(target, prop, receiver) {
      if (prop !== "changes" && !(prop in target)) throw new Error(`unexpected collaborator access: ${String(prop)}`);
      return Reflect.get(target, prop, receiver);
    },
  });
}

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

        // Collaborators are the declared parts only; reaching for any runtime part fails the test.
        const deps = strict({ hby, querying: runtime.querying, cues: new Deck<AgentCue>() });
        assertEquals(yield* queryKeyState(deps, { hab, prefix }, { timeoutMs: 50 }), {
          status: "timed-out",
          timeoutMs: 50,
        });

        assertEquals(anchorQueryStatus(deps, prefix, anchor), {
          state: "active",
          phase: "awaitingEvidence",
          scope: "durable",
        });
        assertEquals(yield* queryAnchor(deps, { hab, prefix, anchor }, { timeoutMs: 50 }), {
          status: "timed-out",
          timeoutMs: 50,
        });

        // A begun run is observable without waiting, and a timed-out wait leaves it running.
        const started = yield* beginKeyStateQuery(deps, { hab, prefix });
        try {
          assertEquals(started.status(), { state: "active", phase: "awaitingEvidence", scope: "process" });
          assertEquals((yield* started.wait({ timeoutMs: 20 })).status, "timed-out");
          assertEquals(started.status(), { state: "active", phase: "awaitingEvidence", scope: "process" });
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
