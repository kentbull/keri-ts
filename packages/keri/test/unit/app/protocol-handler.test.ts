// @file-test-lane app-fast-parallel

import { assertEquals } from "jsr:@std/assert";
import { Ilks } from "../../../../cesr/mod.ts";
import {
  classifyCesrIngressRoute,
  classifyProtocolRoute,
  parseOobiRouteRequest,
  type ProtocolRequestContext,
} from "../../../../tufa/src/http/protocol-handler.ts";
import type { ProtocolHostPolicy } from "../../../runtime.ts";
import type { AgentRuntime } from "../../../src/app/agent-runtime.ts";
import type { Hab } from "../../../src/app/habbing.ts";
import type { HostedRouteResolution } from "../../../src/app/mailboxing.ts";

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

Deno.test("app/protocol-handler - health short-circuits before runtime routing", () => {
  const route = classifyProtocolRoute(
    makeContext({ pathname: "/health", runtime: undefined }),
  );
  assertEquals(route, { kind: "health" });
});

Deno.test("app/protocol-handler - mailbox admin path classification preserves exact-path precedence and ambiguity", () => {
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

Deno.test("app/protocol-handler - witness receipts and query routes win before generic ingress", () => {
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

Deno.test("app/protocol-handler - parses well-known and explicit OOBI paths", () => {
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
});

Deno.test("app/protocol-handler - ambiguous hosted paths stay explicit for OOBI and witness hosting", () => {
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

Deno.test("app/protocol-handler - classifies witness-local and runtime ingress modes explicitly", () => {
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
      kind: "runtimeIngressWithKsnReplay",
      mailboxAid: witnessHab.pre,
      pre: "EDEST",
    },
  );
});
