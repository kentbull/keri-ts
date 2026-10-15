import { type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { createAgentRuntime, processRuntimeTurn } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Oobiery, parseOobiUrl } from "../../../src/app/oobiery.ts";
import { Reactor } from "../../../src/app/reactor.ts";
import { parseSchemaReference, resolveCachedSchema } from "../../../src/app/schema-resolving.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck } from "../../../src/core/deck.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { FakeRuntimeHttpClient, fakeRuntimeServices } from "../../support/runtime-service-fakes.ts";

function schemaSed(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    properties: {
      name: { type: "string" },
    },
  };
}

Deno.test("parseOobiUrl recognizes schema data OOBIs", () => {
  const parsed = parseOobiUrl("http://schema.test/oobi/Eschema");
  assertEquals(parsed.said, "Eschema");
  assertEquals(parsed.cid, undefined);
  assertEquals(parsed.role, undefined);
});

Deno.test("schema reference parsing supports bare, sad, oobi, and did forms", () => {
  assertEquals(parseSchemaReference("Eschema"), { kind: "bare", said: "Eschema" });
  assertEquals(parseSchemaReference("sad:Eschema"), { kind: "sad", said: "Eschema" });
  assertEquals(parseSchemaReference("http://schema.test/oobi/Eschema"), {
    kind: "oobi",
    url: "http://schema.test/oobi/Eschema",
    said: "Eschema",
  });
  assertEquals(parseSchemaReference("did:web:example#schema"), {
    kind: "did",
    url: "did:web:example#schema",
  });
});

Deno.test("Oobiery resolves application/schema+json data OOBIs", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `schema-oobi-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const schemer = new Schemer({ sed: schemaSed() });
    const http = new FakeRuntimeHttpClient();
    const origin = "http://schema.test";
    const url = `${origin}/oobi/${schemer.said}`;
    http.registerOrigin(origin, () =>
      new Response(new Blob([schemer.raw.slice().buffer as ArrayBuffer]), {
        headers: { "Content-Type": "application/schema+json; charset=utf-8" },
      }));

    try {
      const runtime = yield* createAgentRuntime(hby, {
        services: fakeRuntimeServices({ http, resources: hby.db.resources }),
      });
      try {
        runtime.oobiery.resolve(url);
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        assertEquals(hby.db.schema.get(schemer.said)?.said, schemer.said);
        assertEquals(hby.db.roobi.get(url)?.state, "resolved");
        assertEquals(resolveCachedSchema(hby, schemer.said)?.said, schemer.said);
        assertEquals(resolveCachedSchema(hby, `sad:${schemer.said}`)?.said, schemer.said);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("Oobiery rejects schema data OOBIs with mismatched SAIDs", async () => {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: `schema-oobi-mismatch-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const schemer = new Schemer({ sed: schemaSed() });
    const http = new FakeRuntimeHttpClient();
    const origin = "http://schema-mismatch.test";
    const url = `${origin}/oobi/EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`;
    http.registerOrigin(origin, () =>
      new Response(new Blob([schemer.raw.slice().buffer as ArrayBuffer]), {
        headers: { "Content-Type": "application/schema+json" },
      }));

    try {
      const runtime = yield* createAgentRuntime(hby, {
        services: fakeRuntimeServices({ http, resources: hby.db.resources }),
      });
      try {
        runtime.oobiery.resolve(url);
        yield* processRuntimeTurn(runtime, { pollMailbox: false });

        assertEquals(hby.db.schema.get(schemer.said), null);
        assertEquals(hby.db.eoobi.get(url)?.state, "invalid-schema-oobi");
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("OOBI response publishes schema or failure state with its result cue", async () => {
  for (const mode of ["schema", "invalid-json", "http-failure"] as const) {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const cues = new Deck<AgentCue>();
      const reactor = new Reactor(hby), http = new FakeRuntimeHttpClient();
      const oobi = new Oobiery(hby, reactor, { cues, services: fakeRuntimeServices({ http }) });
      const schemer = new Schemer({ sed: schemaSed() }), url = `http://schema.test/oobi/${schemer.said}`;
      http.registerOrigin("http://schema.test", () =>
        new Response(
          new ReadableStream<Uint8Array>({
            pull(controller) {
              controller.enqueue(mode === "schema" ? schemer.raw : new TextEncoder().encode("invalid JSON"));
              controller.close();
            },
          }, { highWaterMark: 0 }),
          {
            status: mode === "http-failure" ? 404 : 200,
            headers: { "Content-Type": mode === "schema" ? "application/schema+json" : "application/json" },
          },
        ));
      try {
        oobi.resolve(url);
        cues.clear();
        yield* oobi.processOnce();
        assertEquals(hby.db.oobis.get(url), null);
        if (mode === "schema") {
          assertEquals(hby.db.schema.get(schemer.said)?.said, schemer.said);
          assertEquals(hby.db.roobi.get(url)?.state, "resolved");
        } else {
          assertEquals(hby.db.eoobi.get(url)?.state, mode === "http-failure" ? "http-404" : "invalid-json-oobi");
          assertEquals(hby.db.schema.get(schemer.said), null);
        }
        assertEquals(cues.pull()?.kin, mode === "schema" ? "oobiResolved" : "oobiFailed");
        assertEquals(cues.length, 0);
      } finally {
        cues.clear();
        yield* hby.close(true);
      }
    });
  }
});
