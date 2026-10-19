import { call, run } from "effection";
import { assertEquals, assertInstanceOf } from "jsr:@std/assert";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { dkrResolveCommand } from "../../../src/app/cli/did.ts";
import { httpMailboxPollTransport } from "../../../src/app/forwarding.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { resolveDidKeri } from "../../../src/did/keri/resolving.ts";
import { controllerOobiResponse, startStaticHttpHost } from "../../http-test-support.ts";
import { testCLICommand } from "../../utils.ts";

Deno.test("did/keri - CLI owns signed HTTP introduction before accepted local projection", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "dkr-reader-" });
  await run(function*() {
    const issuer = yield* createHabery({ name: `dkr-issuer-${crypto.randomUUID()}`, temp: true });
    const name = `dkr-reader-${crypto.randomUUID()}`;
    const reader = yield* createHabery({ name, headDirPath });
    yield* reader.close();
    const hab = issuer.makeHab("issuer");
    const did = `did:keri:${hab.pre}`;
    const wire = hab.replyToOobi(hab.pre, EndpointRoles.controller);
    const host = startStaticHttpHost(() => controllerOobiResponse(hab.pre, wire));
    try {
      let missing: unknown;
      try {
        yield* testCLICommand(dkrResolveCommand({ name, headDirPath, did }));
      } catch (error) {
        missing = error;
      }
      assertInstanceOf(missing, ValidationError);

      const oobi = `${host.origin}/oobi/${hab.pre}/controller`;
      const introduced = yield* testCLICommand(dkrResolveCommand({ name, headDirPath, did, oobi: [oobi] }));
      const document = JSON.parse(introduced.output.at(-1)!);
      assertEquals(document.id, did);

      const accepted = yield* createHabery({ name, headDirPath });
      const runtime = yield* createAgentRuntime(accepted, new FetchHttpClient(), systemClock, httpMailboxPollTransport);
      try {
        assertEquals(accepted.db.getKever(hab.pre)?.said, hab.kever!.said);
        assertEquals(accepted.db.roobi.get(oobi)?.state, "resolved");
        const local = resolveDidKeri(accepted, runtime.vdr!, did);
        assertEquals(local.document, document);
        assertEquals(local.resolution.didDocument, local.document);
      } finally {
        yield* runtime.close();
        yield* accepted.close();
      }
    } finally {
      yield* issuer.close(true);
      yield* call(() => host.close());
      yield* call(() => Deno.remove(headDirPath, { recursive: true }));
    }
  });
});

Deno.test("did/keri - failed CLI introduction cannot manufacture accepted key state", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "dkr-refusal-" });
  await run(function*() {
    const issuer = yield* createHabery({ name: `dkr-missing-${crypto.randomUUID()}`, temp: true });
    const name = `dkr-refusal-${crypto.randomUUID()}`;
    const reader = yield* createHabery({ name, headDirPath });
    yield* reader.close();
    const hab = issuer.makeHab("issuer");
    const host = startStaticHttpHost(() => new Response("Not Found", { status: 404 }));
    const oobi = `${host.origin}/oobi/${hab.pre}/controller`;
    try {
      let refused: unknown;
      try {
        yield* testCLICommand(dkrResolveCommand({ name, headDirPath, did: `did:keri:${hab.pre}`, oobi: [oobi] }));
      } catch (error) {
        refused = error;
      }
      assertInstanceOf(refused, ValidationError);
      const inspected = yield* createHabery({ name, headDirPath });
      try {
        assertEquals(inspected.db.getKever(hab.pre), null);
        assertEquals(inspected.db.eoobi.get(oobi)?.state, "http-404");
      } finally {
        yield* inspected.close();
      }
    } finally {
      yield* issuer.close(true);
      yield* call(() => host.close());
      yield* call(() => Deno.remove(headDirPath, { recursive: true }));
    }
  });
});
