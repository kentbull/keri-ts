// @file-test-lane app-fast-parallel

import { Ilks, ResourceAdmissionError, ResourceLimitError, ResourcePolicy } from "cesr-ts";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import type { AgentRuntime, Hab, HostedRouteResolution, ProtocolHostPolicy } from "keri-ts/runtime";
import { Schemer } from "keri-ts/runtime";
import { createTufaApp } from "../src/http/app.ts";
import {
  classifyCesrIngressRoute,
  classifyProtocolRoute,
  createProtocolHandler,
  parseOobiRouteRequest,
  type ProtocolRequestContext,
} from "../src/http/protocol-handler.ts";
import { ArtifactFiles } from "../src/http/protocol/artifact-files.ts";

Deno.test("static artifact responses read only on demand and retain admission through joined close", async () => {
  const root = Deno.makeTempDirSync(), path = `${root}/keri.cesr`, chunk = 65536;
  const resources = new ResourcePolicy({ streams: 1 }), files = new ArtifactFiles(resources);
  const signal = new AbortController();
  try {
    const data = new Uint8Array(3 * chunk);
    Deno.writeFileSync(path, data);
    const response = await files.response(path, "application/cesr", signal.signal);
    assertEquals([response.status, response.headers.get("content-length"), resources.used.streams], [200, "196608", 1]);
    const busy = await assertRejects(
      () => files.response(`${root}/absent`, "application/cesr", signal.signal),
      ResourceAdmissionError,
    );
    assertEquals(busy.reason, "busy", "capacity refusal precedes opening even a nonexistent path");
    data[0] = 7;
    Deno.writeFileSync(path, data);
    // Deno's old request signal can abort when headers return; it must not own the response.
    signal.abort();
    const reader = response.body!.getReader();
    assertEquals((await reader.read()).value?.[0], 7, "there was no read before first demand");
    data[chunk] = 8;
    Deno.writeFileSync(path, data);
    assertEquals((await reader.read()).value?.[0], 8, "there was no hidden next-chunk prefetch");
    assertEquals(resources.used.streams, 1);
    await reader.cancel();
    reader.releaseLock();
    assertEquals(resources.used.bytes, 0);

    const active = new AbortController().signal;
    await assertRejects(() => files.response(path, "application/did+json", active, 8), ResourceLimitError);
    assertEquals(resources.used.bytes, 0);
    const captured = await files.response(path, "application/cesr", active);
    Deno.truncateSync(path, 4 * chunk);
    assertEquals((await captured.arrayBuffer()).byteLength, 3 * chunk, "file growth cannot extend a captured response");
    assertEquals(resources.used.bytes, 0);
    const truncated = await files.response(path, "application/cesr", active);
    Deno.truncateSync(path, chunk);
    await assertRejects(() => truncated.arrayBuffer(), Error, "truncated");
    assertEquals(resources.used.bytes, 0);

    const cancelling = await files.response(path, "application/cesr", active);
    const pendingReader = cancelling.body!.getReader();
    const read = pendingReader.read();
    await Promise.resolve();
    const cancelled = pendingReader.cancel();
    assertEquals(resources.used.streams, 1, "pending file work retains credit during cancellation");
    await Promise.all([read, cancelled]);
    pendingReader.releaseLock();
    assertEquals(resources.used.bytes, 0);
    const unopened = await files.response(path, "application/cesr", active);
    await files.close();
    await assertRejects(() => unopened.arrayBuffer(), DOMException, "host closed");
    assertEquals(resources.used.bytes, 0);
    await files.close();

    const handler = createProtocolHandler(undefined, { dwsStaticFilesDir: root });
    Deno.mkdirSync(`${root}/EAID`);
    Deno.writeTextFileSync(`${root}/EAID/keri.cesr`, "");
    const empty = await handler(new Request("http://localhost/EAID/keri.cesr"));
    assertEquals([empty.status, empty.body], [200, null]);
    Deno.writeTextFileSync(`${root}/EAID/did.json`, "{}");
    Deno.truncateSync(`${root}/EAID/did.json`, 9 * 1024 ** 2);
    assertEquals((await handler(new Request("http://localhost/EAID/did.json"))).status, 413);
    assertEquals((await handler(new Request("http://localhost/missing/keri.cesr"))).status, 404);
    await handler.close?.();
    Deno.writeTextFileSync(`${root}/EAID/keri.cesr`, "file");
    const app = createTufaApp({ protocolPolicy: { dwsStaticFilesDir: root } });
    const owned = await app.request("/EAID/keri.cesr");
    await app.close();
    await assertRejects(() => owned.arrayBuffer(), DOMException, "host closed");
    let injectedClosed = false;
    const borrowed = createTufaApp({
      protocolHandler: Object.assign(async () => new Response(null), {
        close: async () => {
          injectedClosed = true;
        },
      }),
    });
    await borrowed.close();
    assertEquals(injectedClosed, false, "injected handler ownership remains with its caller");
  } finally {
    await files.close();
    Deno.removeSync(root, { recursive: true });
  }
});

const NONE_HOSTED: HostedRouteResolution = {
  kind: "none",
  endpoint: null,
  relativePath: null,
};

function oneHosted(
  relativePath = "/",
  eid = "EAID",
  basePath = "/",
): HostedRouteResolution {
  return {
    kind: "one",
    endpoint: {
      eid,
      url: `http://127.0.0.1${basePath === "/" ? "" : basePath}`,
      basePath,
      relativePath,
    },
    relativePath,
  };
}

function makeContext(
  {
    pathname = "/",
    method = "GET",
    runtime = {} as AgentRuntime,
    policy = {},
    hosted = NONE_HOSTED,
    mailboxAdmin = NONE_HOSTED,
    genericIngress = NONE_HOSTED,
    oobi = null,
  }: Partial<ProtocolRequestContext> = {},
): ProtocolRequestContext {
  const url = new URL(`http://127.0.0.1${pathname}`);
  return {
    req: new Request(url, { method }),
    url,
    pathname,
    method,
    runtime,
    policy,
    hosted,
    mailboxAdmin,
    genericIngress,
    oobi,
  };
}

Deno.test("tufa/protocol-handler - health short-circuits before runtime routing", () => {
  const route = classifyProtocolRoute(
    makeContext({ pathname: "/health", runtime: undefined }),
  );
  assertEquals(route, { kind: "health" });
});

Deno.test("tufa/protocol-handler - mailbox admin path classification preserves exact-path precedence and ambiguity", () => {
  const mailboxRoute = classifyProtocolRoute(
    makeContext({
      pathname: "/mailboxes",
      method: "POST",
      mailboxAdmin: oneHosted("/mailboxes", "EMBX"),
    }),
  );
  assertEquals(mailboxRoute, {
    kind: "mailboxAdmin",
    mailboxAid: "EMBX",
  });

  const ambiguous = classifyProtocolRoute(
    makeContext({
      pathname: "/mailboxes",
      method: "POST",
      mailboxAdmin: {
        kind: "ambiguous",
        endpoint: null,
        relativePath: null,
      },
    }),
  );
  assertEquals(ambiguous, {
    kind: "ambiguousHostedPath",
    message: "Ambiguous mailbox endpoint path",
  });
});

Deno.test("tufa/protocol-handler - witness receipts and query routes win before generic ingress", () => {
  const witnessHab = { pre: "EWIT" } as Hab;
  const policy: ProtocolHostPolicy = { witnessHab };

  const receiptRoute = classifyProtocolRoute(
    makeContext({
      pathname: "/receipts",
      method: "POST",
      policy,
      hosted: oneHosted("/receipts", witnessHab.pre),
      genericIngress: oneHosted("/", witnessHab.pre),
    }),
  );
  assertEquals(receiptRoute.kind, "witnessReceiptsPost");

  const queryRoute = classifyProtocolRoute(
    makeContext({
      pathname: "/query",
      method: "GET",
      policy,
      hosted: oneHosted("/query", witnessHab.pre),
      genericIngress: oneHosted("/", witnessHab.pre),
    }),
  );
  assertEquals(queryRoute.kind, "witnessQueryGet");
});

Deno.test("tufa/protocol-handler - parses well-known and explicit OOBI paths", () => {
  assertEquals(
    parseOobiRouteRequest("/.well-known/keri/oobi/EAID"),
    {
      kind: "wellKnown",
      aid: "EAID",
      role: "controller",
    },
  );
  assertEquals(
    parseOobiRouteRequest("/oobi/EAID/witness/EWIT"),
    {
      kind: "oobi",
      aid: "EAID",
      role: "witness",
      eid: "EWIT",
    },
  );
  assertEquals(
    parseOobiRouteRequest("/oobi/Eschema"),
    {
      kind: "oobi",
      aid: "Eschema",
      said: "Eschema",
      role: undefined,
      eid: undefined,
    },
  );
});

Deno.test("tufa/protocol-handler - serves hosted schema data OOBIs before identity fallback", async () => {
  const schemer = new Schemer({
    sed: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
    },
  });
  const runtime = {
    hby: {
      db: {
        schema: {
          get: (said: string) => said === schemer.said ? schemer : null,
        },
      },
      habs: new Map(),
      prefixes: [],
    },
  } as unknown as AgentRuntime;
  const handler = createProtocolHandler(runtime);

  const response = await handler(new Request(`http://127.0.0.1/oobi/${schemer.said}`));

  assertEquals(response.status, 200);
  assertEquals(response.headers.get("Content-Type"), "application/schema+json");
  assertEquals(new Uint8Array(await response.arrayBuffer()), schemer.raw);

  const missing = await handler(new Request("http://127.0.0.1/oobi/EnotSchema"));
  assertEquals(missing.status, 404);
  assertExists(parseOobiRouteRequest("/oobi/EnotSchema")?.aid);
});

Deno.test("tufa/protocol-handler - ambiguous hosted paths stay explicit for OOBI and witness hosting", () => {
  const ambiguousHosted: HostedRouteResolution = {
    kind: "ambiguous",
    endpoint: null,
    relativePath: null,
  };

  const witnessRoute = classifyProtocolRoute(
    makeContext({
      pathname: "/foo",
      policy: { witnessHab: { pre: "EWIT" } as Hab },
      hosted: ambiguousHosted,
    }),
  );
  assertEquals(witnessRoute, {
    kind: "ambiguousHostedPath",
    message: "Ambiguous hosted endpoint path",
  });

  const oobiRoute = classifyProtocolRoute(
    makeContext({
      pathname: "/oobi/EAID/controller",
      policy: { hostedPrefixes: ["EAID", "EOTHER"] },
      hosted: ambiguousHosted,
      oobi: parseOobiRouteRequest("/oobi/EAID/controller"),
    }),
  );
  assertEquals(oobiRoute, {
    kind: "ambiguousHostedPath",
    message: "Ambiguous hosted endpoint path",
  });
});

Deno.test("tufa/protocol-handler - classifies witness-local and runtime ingress modes explicitly", () => {
  const witnessHab = { pre: "EWIT" } as Hab;
  const context = makeContext({
    method: "POST",
    policy: { witnessHab },
  });
  const witnessHosted = oneHosted("/", witnessHab.pre);

  assertEquals(
    classifyCesrIngressRoute(context, witnessHosted, {
      ilk: Ilks.rpy,
      route: "/loc/scheme",
      ked: {},
    }).kind,
    "witnessLocalIngress",
  );

  assertEquals(
    classifyCesrIngressRoute(context, witnessHosted, {
      ilk: Ilks.exn,
      route: "/fwd",
      ked: {},
    }),
    {
      kind: "runtimeIngress",
      mailboxAid: witnessHab.pre,
    },
  );

  assertEquals(
    classifyCesrIngressRoute(context, witnessHosted, {
      ilk: Ilks.qry,
      route: "mbx",
      ked: { q: { i: "EDEST", topics: { "/challenge": 0 } } },
    }),
    {
      kind: "mailboxQueryStream",
      mailboxAid: witnessHab.pre,
      pre: "EDEST",
      topics: { "/challenge": 0 },
    },
  );

  assertEquals(
    classifyCesrIngressRoute(context, witnessHosted, {
      ilk: Ilks.qry,
      route: "ksn",
      ked: { q: { i: "EDEST" } },
    }),
    {
      kind: "runtimeIngress",
      mailboxAid: witnessHab.pre,
    },
  );
});
