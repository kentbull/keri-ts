import { assertEquals } from "jsr:@std/assert";
import type { AgentRuntime } from "../../../../src/app/agent-runtime.ts";
import { defaultOobiAid, selectOobiSpeaker } from "../../../../src/app/protocol/endpoints/oobi.ts";

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

Deno.test("app/protocol/oobi - speaker selection prefers local aid/eid before falling back to hosted endpoint", () => {
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
    selectOobiSpeaker(
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
    selectOobiSpeaker(
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
    selectOobiSpeaker(
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

Deno.test("app/protocol/oobi - hosted-prefix selection only allows the matched local hosted endpoint", () => {
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
    selectOobiSpeaker(
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
    selectOobiSpeaker(
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
