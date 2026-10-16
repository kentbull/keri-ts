import { action, call, type Operation, run, spawn, type Task } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  bindDesignatedAliases,
  createAgentRuntime,
  createHabery,
  DESIGNATED_ALIASES_SCHEMA_SAID,
  generateDidWebsArtifacts,
  resolveDidWebs,
  runAgentRuntime,
} from "keri-ts/runtime";
import { startServer } from "../../src/host/http-server.ts";
import { createProtocolHandler } from "../../src/http/protocol-handler.ts";
import { reserveTcpPort, startTestServer, waitForServer, waitForTaskHalt } from "../test-helpers.ts";

Deno.test("tufa/dkr - HTTP waits for every supplied introduction on the existing host", async () => {
  await run(function*() {
    const issuer = yield* createHabery({ name: `dkr-http-source-${crypto.randomUUID()}`, temp: true });
    const reader = yield* createHabery({ name: `dkr-http-reader-${crypto.randomUUID()}`, temp: true });
    const source = yield* createAgentRuntime(issuer);
    const resolver = yield* createAgentRuntime(reader);
    const habs = Array.from({ length: 6 }, (_, index) => issuer.makeHab(`issuer-${index}`));
    const unhosted = issuer.makeHab("unhosted");
    const worker = yield* spawn(() => runAgentRuntime(resolver, { pollMailbox: false }));
    let sourceTask: Task<void> | undefined;
    let resolverTask: Task<void> | undefined;
    try {
      const sourceServer = yield* startTestServer(source, {
        serviceHab: habs[0],
        hostedPrefixes: habs.map((hab) => hab.pre),
      });
      sourceTask = sourceServer.task;
      const resolverServer = yield* startTestServer(resolver);
      resolverTask = resolverServer.task;
      const sourceOrigin = `http://${sourceServer.address.hostname}:${sourceServer.address.port}`;
      const resolverOrigin = `http://${resolverServer.address.hostname}:${resolverServer.address.port}`;
      const did = `did:keri:${habs[0].pre}`;
      const request = new URL(`/1.0/identifiers/${encodeURIComponent(did)}`, resolverOrigin);
      request.searchParams.set("meta", "true");
      for (const hab of habs) request.searchParams.append("oobi", `${sourceOrigin}/oobi/${hab.pre}/controller`);
      const result = yield* fetchJson(request.href);
      assertEquals((result as { didDocument: { id: string } }).didDocument.id, did);
      for (const hab of habs) {
        assertEquals(reader.db.getKever(hab.pre)?.said, hab.kever!.said);
        assertEquals(reader.db.roobi.get(`${sourceOrigin}/oobi/${hab.pre}/controller`)?.state, "resolved");
      }

      const missing = new URL(`/1.0/identifiers/${encodeURIComponent(`did:keri:${unhosted.pre}`)}`, resolverOrigin);
      missing.searchParams.set("meta", "true");
      const unavailable = `${sourceOrigin}/oobi/${unhosted.pre}/controller`;
      missing.searchParams.set("oobi", unavailable);
      const refusal = yield* fetchJson(missing.href);
      assertEquals((refusal as { didDocument: null }).didDocument, null);
      assertEquals((refusal as { didResolutionMetadata: { error: string } }).didResolutionMetadata.error, "notFound");
      assertEquals(reader.db.getKever(unhosted.pre), null);
      assertEquals(reader.db.eoobi.get(unavailable)?.state, "http-404");
    } finally {
      if (resolverTask) yield* waitForTaskHalt(resolverTask);
      if (sourceTask) yield* waitForTaskHalt(sourceTask);
      yield* worker.halt();
      yield* resolver.close();
      yield* source.close();
      yield* reader.close(true);
      yield* issuer.close(true);
    }
  });
});

Deno.test("tufa/dws - static artifacts resolve through the Tufa HTTP artifact route", async () => {
  await run(function*(): Operation<void> {
    const port = reserveTcpPort();
    const webRoot = yield* tempDirOp();
    const issuerHby = yield* createHabery({
      name: `dws-static-issuer-${crypto.randomUUID()}`,
      temp: true,
    });
    const resolverHby = yield* createHabery({
      name: `dws-static-resolver-${crypto.randomUUID()}`,
      temp: true,
    });
    const issuerRuntime = yield* createAgentRuntime(issuerHby);
    const resolverRuntime = yield* createAgentRuntime(resolverHby);
    let serverTask;
    try {
      const hab = issuerHby.makeHab("issuer", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const did = `did:webs:127.0.0.1%3A${port}:dws:${hab.pre}`;
      bindDesignatedAliases(issuerRuntime.vdr!, {
        alias: "issuer",
        dids: [did, `did:keri:${hab.pre}`],
      });
      const artifacts = generateDidWebsArtifacts(issuerRuntime.vdr!, {
        alias: "issuer",
        did,
      });
      const dynamic = createProtocolHandler(issuerRuntime, {
        dwsDynamic: true,
        hostedPrefixes: [hab.pre],
        dwsDidPath: "dws",
      });
      const replay = issuerHby.db.clonePreIter;
      issuerHby.db.clonePreIter = function*() {
        throw new Error("JSON artifact must not open CESR replay");
      };
      try {
        const response = yield* call(() => dynamic(new Request(`http://127.0.0.1:${port}/dws/${hab.pre}/did.json`)));
        assertEquals(response.status, 200);
        assertEquals(response.headers.get("content-type"), "application/did+json");
        assertEquals(yield* call(async () => new Uint8Array(await response.arrayBuffer())), artifacts.didJson);
      } finally {
        issuerHby.db.clonePreIter = replay;
        yield* call(() => dynamic.close!());
      }
      const artifactDir = `${webRoot}/dws/${hab.pre}`;
      Deno.mkdirSync(artifactDir, { recursive: true });
      Deno.writeFileSync(`${artifactDir}/did.json`, artifacts.didJson);
      Deno.writeFileSync(`${artifactDir}/keri.cesr`, artifacts.keriCesr);

      serverTask = yield* spawn(function*() {
        yield* startServer(port, undefined, resolverRuntime, {
          dwsStaticFilesDir: webRoot,
          dwsDidPath: "dws",
          dwsInsecureHttp: true,
        });
      });
      yield* waitForServer(port);

      const resolved = yield* resolveDidWebs(
        resolverRuntime.vdr!,
        resolverRuntime.reactor,
        resolverRuntime.services.http,
        {
          did,
          // Native HTTPS header failure falls back to this actual local HTTP artifact host.
        },
      );
      assertEquals(resolved.document.id, did);
      assertEquals(
        [...(resolved.document.alsoKnownAs as string[])].sort(),
        [did, `did:keri:${hab.pre}`].sort(),
      );

      const rawUniversalResolution = yield* fetchJson(
        `http://127.0.0.1:${port}/1.0/identifiers/${did}?meta=true`,
      );
      assertEquals(
        (rawUniversalResolution as { didDocument: { id: string } }).didDocument.id,
        did,
      );

      const encodedUniversalResolution = yield* fetchJson(
        `http://127.0.0.1:${port}/1.0/identifiers/${encodeURIComponent(did)}?meta=true`,
      );
      assertEquals(
        (encodedUniversalResolution as { didDocument: { id: string } }).didDocument.id,
        did,
      );
    } finally {
      if (serverTask) {
        yield* waitForTaskHalt(serverTask, 100);
      }
      yield* issuerRuntime.close();
      yield* resolverRuntime.close();
      yield* issuerHby.close(true);
      yield* resolverHby.close(true);
      yield* removeDirOp(webRoot);
    }
  });
});

function* tempDirOp(): Operation<string> {
  return yield* promiseOp(Deno.makeTempDir({ prefix: "tufa-dws-" }));
}

function* removeDirOp(path: string): Operation<void> {
  yield* promiseOp(Deno.remove(path, { recursive: true }));
}

function* promiseOp<T>(promise: Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve, reject);
    return () => {};
  });
}

function* fetchJson(url: string): Operation<unknown> {
  const response = yield* promiseOp(fetch(url));
  assertEquals(response.status, 200);
  return yield* promiseOp(response.json());
}

Deno.test("DID adapters reject absent registry before schema writes or introductions", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true });
    let fetched = false;
    const runtime = yield* createAgentRuntime(hby, {
      services: {
        http: {
          fetch: () => {
            fetched = true;
            throw new Error("Registry absence must precede fetch");
          },
        },
      },
    });
    try {
      const hab = hby.makeHab("issuer");
      const handler = createProtocolHandler({ ...runtime, vdr: null }, { dwsDynamic: true, hostedPrefixes: [hab.pre] });
      for (const did of [`did:keri:${hab.pre}`, `did:webs:example.com:${hab.pre}`]) {
        const response = yield* call(() =>
          handler(new Request(`http://example.com/1.0/identifiers/${did}?oobi=https://example.com/oobi/test`))
        );
        assertEquals(response.status, 404);
        assertEquals(hby.db.oobis.cnt(), 0);
        assertEquals(hby.db.schema.get(DESIGNATED_ALIASES_SCHEMA_SAID), null);
        assertEquals(fetched, false);
      }
      const artifact = yield* call(() => handler(new Request(`http://example.com/${hab.pre}/did.json`)));
      assertEquals(artifact.status, 400);
      assertEquals(hby.db.schema.get(DESIGNATED_ALIASES_SCHEMA_SAID), null);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
