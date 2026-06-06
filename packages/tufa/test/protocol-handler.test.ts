// @file-test-lane app-fast-parallel

import { Ilks } from "cesr-ts";
import { assertEquals, assertExists } from "jsr:@std/assert";
import type { AgentRuntime, Hab, HostedRouteResolution, ProtocolHostPolicy } from "keri-ts/runtime";
import { Schemer } from "keri-ts/runtime";
import {
  classifyCesrIngressRoute,
  classifyProtocolRoute,
  createProtocolHandler,
  parseOobiRouteRequest,
  type ProtocolRequestContext,
} from "../src/http/protocol-handler.ts";

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
