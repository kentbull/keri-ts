import { call, run } from "effection";
import { assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert";
import { createProtocolHandler } from "../../../../../tufa/src/http/protocol-handler.ts";
import { runTufa } from "../../../../../tufa/test/test-helpers.ts";
import { publishPendingTel } from "../../../../src/app/credentials/tel-publishing.ts";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { createAgentRuntime, runAgentRuntimeUntil } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { Receiptor } from "../../../../src/app/witness/witnessing.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { Schemes } from "../../../../src/core/schemes.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import { credential, Regery } from "../../../../src/vdr/credentialing.ts";

Deno.test("TEL publication resumes receipt and dissemination escrows across reopen before completion", async () => {
  await run(function*() {
    const issuerHby = yield* createHabery({ name: `tel-issuer-${crypto.randomUUID()}`, temp: true, skipConfig: true });
    const witnessHby = yield* createHabery({
      name: `tel-witness-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const witness = witnessHby.makeHab("witness", undefined, { transferable: false });
    const issuer = issuerHby.makeHab("issuer", undefined, { wits: [witness.pre], toad: 1 });
    const http = new FetchHttpClient();
    const source = yield* createAgentRuntime(issuerHby, http, systemClock);
    const observer = yield* createAgentRuntime(witnessHby, http, systemClock);
    const handler = createProtocolHandler(observer, {
      hostedPrefixes: [witness.pre],
      serviceHab: witness,
      witnessHab: witness,
    });
    let refuseReceipts = false;
    let refuseTel = false;
    let telAttempts = 0;
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
      if (new URL(request.url).pathname === "/receipts") {
        if (refuseReceipts) return new Response("withheld receipt", { status: 403 });
      } else if (request.method === "POST") {
        telAttempts++;
        if (refuseTel) return new Response("publication unavailable", { status: 503 });
      }
      return await handler(request);
    });
    try {
      const url = `http://127.0.0.1:${server.addr.port}/`;
      for (const message of witnessHby.db.clonePreIter(witness.pre)) yield* source.reactor.processBytes(message);
      yield* source.reactor.processBytes(witness.makeLocScheme(url, witness.pre, Schemes.http));
      yield* source.reactor.processBytes(witness.makeEndRole(witness.pre, Roles.controller, true));
      const receiptor = new Receiptor(issuerHby, source.protocol, http, systemClock);
      yield* receiptor.receipt(issuer.pre, { sn: 0 });
      const rgy = source.vdr!;
      const registry = rgy.makeRegistry("registry", issuer);
      const regk = registry.regk!;
      const anchorSaid = issuer.kever!.said;
      const { reger, publication } = rgy;
      assertEquals(registry.complete(regk), false);
      assertEquals(publication.pendingReceipts().length, 1);
      assertEquals(observer.vdr!.tvy.tevers.has(regk), false);

      refuseReceipts = true;
      yield* call(() =>
        assertRejects(() => run(() => publishPendingTel(issuerHby, publication, receiptor, http, systemClock)))
      );
      assertEquals(publication.complete(regk), false);
      assertEquals(publication.pendingReceipts().length, 1);
      assertEquals(telAttempts, 0);
      yield* reger.close();
      yield* reger.reopen();
      const resumed = new Regery(issuerHby, { reger });
      assertEquals(resumed.publication.pendingReceipts().length, 1);

      refuseReceipts = false;
      refuseTel = true;
      yield* call(() =>
        assertRejects(() => run(() => publishPendingTel(issuerHby, resumed.publication, receiptor, http, systemClock)))
      );
      assertEquals(resumed.publication.complete(regk), false);
      assertEquals(resumed.publication.pendingReceipts().length, 0);
      assertEquals(resumed.publication.pendingPublications().length, 1);
      assertEquals(observer.vdr!.tvy.tevers.has(regk), false);
      yield* reger.close();
      yield* reger.reopen();

      refuseTel = false;
      const recovered = new Regery(issuerHby, { reger });
      yield* publishPendingTel(issuerHby, recovered.publication, receiptor, http, systemClock);
      assertEquals(recovered.publication.complete(regk), true);
      assertEquals(recovered.publication.pendingPublications().length, 0);
      assertEquals(observer.vdr!.tvy.tevers.get(regk)?.serder.said, regk);
      assertEquals([...reger.ctel.getTopItemIter()][0][1].qb64, anchorSaid);
      yield* reger.close();
      yield* reger.reopen();
      const reopened = new Regery(issuerHby, { reger });
      const loaded = reopened.registryByName("registry")!;
      assertEquals(loaded.complete(regk), true);
      const creder = credential({ issuer: issuer.pre, registry: regk, schema: regk });
      loaded.issue(creder);
      assertEquals(loaded.complete(creder.said!), false);
      yield* runAgentRuntimeUntil(source, () => loaded.complete(creder.said!), {
        hab: issuer,
        timeoutMs: 3000,
        pollMailbox: false,
      });
      assertEquals(loaded.complete(creder.said!), true);
      assertEquals(observer.vdr!.tvy.tevers.get(regk)?.vcState(creder.said!)?.et, "iss");
      loaded.revoke(creder.said!);
      assertEquals(loaded.complete(creder.said!, 1), false);
      yield* publishPendingTel(issuerHby, reopened.publication, receiptor, http, systemClock);
      assertEquals(loaded.complete(creder.said!, 1), true);
      assertEquals(observer.vdr!.tvy.tevers.get(regk)?.vcState(creder.said!)?.et, "rev");
    } finally {
      yield* call(() => server.shutdown());
      handler.close?.();
      yield* source.close();
      yield* observer.close();
      yield* issuerHby.close(true);
      yield* witnessHby.close(true);
    }
  });
});

Deno.test("credential CLI waits for witnessed establishment-only registry and issuance after reopen", async () => {
  const root = await Deno.makeTempDir({ prefix: "credential-cli-publication-" });
  try {
    await run(function*() {
      const store = { name: "issuer", headDirPath: root, skipConfig: true };
      const hby = yield* createHabery(store);
      const witnessHby = yield* createHabery({
        name: `cli-witness-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });
      const witness = witnessHby.makeHab("witness", undefined, { transferable: false });
      const issuer = hby.makeHab("issuer", undefined, { wits: [witness.pre], toad: 1 });
      hby.makeHab("other");
      const http = new FetchHttpClient();
      const source = yield* createAgentRuntime(hby, http, systemClock);
      const observer = yield* createAgentRuntime(witnessHby, http, systemClock);
      const handler = createProtocolHandler(observer, {
        hostedPrefixes: [witness.pre],
        serviceHab: witness,
        witnessHab: witness,
      });
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
      try {
        const url = `http://127.0.0.1:${server.addr.port}/`;
        for (const message of witnessHby.db.clonePreIter(witness.pre)) yield* source.reactor.processBytes(message);
        yield* source.reactor.processBytes(witness.makeLocScheme(url, witness.pre, Schemes.http));
        yield* source.reactor.processBytes(witness.makeEndRole(witness.pre, Roles.controller, true));
        yield* new Receiptor(hby, source.protocol, http, systemClock).receipt(issuer.pre, { sn: 0 });
        const schema = new Schemer({ sed: { $id: "", type: "object" } });
        hby.db.schema.pin(schema.said, schema);
        yield* source.close();
        yield* hby.close();

        const location = ["--name", store.name, "--head-dir", store.headDirPath, "--alias", "issuer"];
        const inception = yield* call(() =>
          runTufa([
            "vc",
            "registry",
            "incept",
            ...location,
            "--registry-name",
            "registry",
            "--est-only",
            "--timeout",
            "8",
          ])
        );
        assertEquals(inception.code, 0, inception.stdout + inception.stderr);
        const registry = JSON.parse(inception.stdout.trim().split(/\r?\n/).at(-1)!);
        assertEquals(registry.publicationComplete, true);
        assertEquals(observer.vdr!.tvy.tevers.get(registry.registry)?.estOnly, true);
        assertEquals(witnessHby.db.getKever(issuer.pre)?.ilk, "rot");
        const repeated = yield* call(() =>
          runTufa([
            "vc",
            "registry",
            "incept",
            ...location,
            "--registry-name",
            "registry",
            "--timeout",
            "0",
          ])
        );
        assertEquals(repeated.code === 0, false);
        assertStringIncludes(repeated.stderr, "already");
        const wrongIssuer = yield* call(() =>
          runTufa([
            "vc",
            "create",
            "--name",
            store.name,
            "--head-dir",
            root,
            "--alias",
            "other",
            "--registry-name",
            "registry",
            "--schema",
            schema.said,
            "--timeout",
            "0",
          ])
        );
        assertEquals(wrongIssuer.code === 0, false);
        assertStringIncludes(wrongIssuer.stderr, "does not control this registry");
        assertEquals(witnessHby.db.getKever(issuer.pre)?.sn, 1);
        const issuance = yield* call(() =>
          runTufa([
            "vc",
            "create",
            ...location,
            "--registry-name",
            "registry",
            "--schema",
            schema.said,
            "--recipient",
            witness.pre,
            "--data",
            "{\"role\":\"holder\"}",
            "--timeout",
            "8",
          ])
        );
        assertEquals(issuance.code, 0, issuance.stderr);
        const issued = JSON.parse(issuance.stdout.trim().split(/\r?\n/).at(-1)!);
        assertEquals(issued.status, "accept");
        assertEquals(issued.publicationComplete, true);
        assertEquals(observer.vdr!.tvy.tevers.get(registry.registry)?.vcState(issued.said)?.et, "iss");
        assertEquals(witnessHby.db.getKever(issuer.pre)?.sn, 2);
        assertEquals(witnessHby.db.getKever(issuer.pre)?.ilk, "rot");
      } finally {
        yield* call(() => server.shutdown());
        handler.close?.();
        yield* source.close();
        yield* observer.close();
        yield* hby.close();
        yield* witnessHby.close(true);
      }
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
