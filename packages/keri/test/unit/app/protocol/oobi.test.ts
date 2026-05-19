// @file-test-lane app-fast-parallel

import { assertEquals } from "jsr:@std/assert";
import { defaultOobiAid, selectResponderHab } from "../../../../../tufa/src/http/protocol/endpoints/oobi.ts";
import type { AgentRuntime } from "../../../../src/app/agent-runtime.ts";

Deno.test("app/protocol/oobi - default blind OOBI aid prefers service hab, then hosted singleton, then lone local hab", () => {
  const serviceRuntime = {
    hby: {
      habs: new Map([
        ["EAID", {}],
        ["EOTHER", {}],
      ]),
    },
  } as unknown as AgentRuntime;
  assertEquals(
    defaultOobiAid(serviceRuntime, { pre: "ESVC" } as never),
    "ESVC",
  );

  const hostedSingletonRuntime = {
    hby: {
      habs: new Map([
        ["EAID", {}],
        ["EOTHER", {}],
      ]),
    },
  } as unknown as AgentRuntime;
  assertEquals(
    defaultOobiAid(hostedSingletonRuntime, undefined, ["EAID"]),
    "EAID",
  );

  const loneRuntime = {
    hby: {
      habs: new Map([["EAID", {}]]),
    },
  } as unknown as AgentRuntime;
  assertEquals(defaultOobiAid(loneRuntime), "EAID");
});

Deno.test("app/protocol/oobi - responding Hab selection prefers local aid/eid before falling back to hosted endpoint", () => {
  const runtime = {
    hby: {
      habs: new Map([
        ["EAID", {}],
        ["EEID", {}],
        ["EHOST", {}],
      ]),
    },
  } as unknown as AgentRuntime;

  assertEquals(
    selectResponderHab(
      runtime,
      {
        kind: "one",
        endpoint: {
          eid: "EHOST",
          url: "http://127.0.0.1:7723",
          basePath: "/",
        },
      },
      "EAID",
    ),
    "EAID",
  );

  assertEquals(
    selectResponderHab(
      runtime,
      {
        kind: "one",
        endpoint: {
          eid: "EHOST",
          url: "http://127.0.0.1:7723",
          basePath: "/",
        },
      },
      "EUNKNOWN",
      "EEID",
    ),
    "EEID",
  );

  assertEquals(
    selectResponderHab(
      runtime,
      {
        kind: "one",
        endpoint: {
          eid: "EHOST",
          url: "http://127.0.0.1:7723",
          basePath: "/",
        },
      },
      "EUNKNOWN",
      "EMISSING",
    ),
    "EHOST",
  );
});

Deno.test("app/protocol/oobi - hosted-prefix selection only allows the matched local responding Hab", () => {
  const runtime = {
    hby: {
      habs: new Map([
        ["EHOST", {}],
        ["EAID", {}],
      ]),
      db: {
        locs: {
          getTopItemIter() {
            return [];
          },
        },
      },
    },
  } as unknown as AgentRuntime;

  assertEquals(
    selectResponderHab(
      runtime,
      {
        kind: "one",
        endpoint: {
          eid: "EHOST",
          url: "http://127.0.0.1:7723/relay",
          basePath: "/relay",
        },
      },
      "EAID",
      undefined,
      ["EHOST"],
    ),
    undefined,
  );

  assertEquals(
    selectResponderHab(
      runtime,
      {
        kind: "one",
        endpoint: {
          eid: "EHOST",
          url: "http://127.0.0.1:7723/relay",
          basePath: "/relay",
        },
      },
      "EHOST",
      undefined,
      ["EHOST"],
    ),
    "EHOST",
  );
});
