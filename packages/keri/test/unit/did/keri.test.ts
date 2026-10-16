import { call, run } from "effection";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { resolveDidKeri } from "../../../src/did/keri/resolving.ts";
import { controllerOobiResponse, startStaticHttpHost } from "../../http-test-support.ts";

Deno.test("did/keri - resolve signed HTTP introduction, then project accepted local state", async () => {
  await run(function*() {
    const issuer = yield* createHabery({ name: `dkr-issuer-${crypto.randomUUID()}`, temp: true });
    const reader = yield* createHabery({ name: `dkr-reader-${crypto.randomUUID()}`, temp: true });
    const runtime = yield* createAgentRuntime(reader);
    const hab = issuer.makeHab("issuer");
    const did = `did:keri:${hab.pre}`;
    const wire = hab.replyToOobi(hab.pre, EndpointRoles.controller);
    const host = startStaticHttpHost(() => controllerOobiResponse(hab.pre, wire));
    try {
      assertEquals(reader.db.getKever(hab.pre), null);
      let missing: unknown;
      try {
        yield* resolveDidKeri(runtime, { did });
      } catch (error) {
        missing = error;
      }
      assertInstanceOf(missing, ValidationError);

      const oobi = `${host.origin}/oobi/${hab.pre}/controller`;
      const introduced = yield* resolveDidKeri(runtime, { did, oobis: [oobi] });
      assertEquals(introduced.document.id, did);
      assertEquals(introduced.resolution.didDocument, introduced.document);
      assertEquals(reader.db.getKever(hab.pre)?.said, hab.kever!.said);
      assertEquals(reader.db.roobi.get(oobi)?.state, "resolved");

      const local = yield* resolveDidKeri(runtime, { did });
      assertEquals(local.document, introduced.document);
    } finally {
      yield* runtime.close();
      yield* reader.close(true);
      yield* issuer.close(true);
      yield* call(() => host.close());
    }
  });
});

Deno.test("did/keri - failed HTTP introduction cannot manufacture accepted key state", async () => {
  await run(function*() {
    const issuer = yield* createHabery({ name: `dkr-missing-${crypto.randomUUID()}`, temp: true });
    const reader = yield* createHabery({ name: `dkr-refusal-${crypto.randomUUID()}`, temp: true });
    const runtime = yield* createAgentRuntime(reader);
    const hab = issuer.makeHab("issuer");
    const host = startStaticHttpHost(() => new Response("Not Found", { status: 404 }));
    const oobi = `${host.origin}/oobi/${hab.pre}/controller`;
    try {
      let refused: unknown;
      try {
        yield* resolveDidKeri(runtime, { did: `did:keri:${hab.pre}`, oobis: [oobi] });
      } catch (error) {
        refused = error;
      }
      assertInstanceOf(refused, ValidationError);
      assertEquals(reader.db.getKever(hab.pre), null);
      assertEquals(reader.db.eoobi.get(oobi)?.state, "http-404");
    } finally {
      yield* runtime.close();
      yield* reader.close(true);
      yield* issuer.close(true);
      yield* call(() => host.close());
    }
  });
});
