import { action, type Operation, run, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  bindDesignatedAliases,
  createAgentRuntime,
  createHabery,
  generateDidWebsArtifacts,
  resolveDidWebs,
} from "keri-ts/runtime";
import { startServer } from "../../src/host/http-server.ts";
import { reserveTcpPort, waitForServer, waitForTaskHalt } from "../test-helpers.ts";

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
    const issuerRuntime = yield* createAgentRuntime(issuerHby, { mode: "local" });
    const resolverRuntime = yield* createAgentRuntime(resolverHby, { mode: "local" });
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
      bindDesignatedAliases(issuerRuntime, {
        alias: "issuer",
        dids: [did, `did:keri:${hab.pre}`],
      });
      const artifacts = generateDidWebsArtifacts(issuerRuntime, {
        alias: "issuer",
        did,
      });
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

      const resolved = yield* resolveDidWebs(resolverRuntime, {
        did,
        insecureHttp: true,
      });
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
