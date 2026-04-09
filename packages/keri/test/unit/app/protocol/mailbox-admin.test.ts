// @file-test-lane app-fast-parallel

import { assertEquals, assertExists } from "jsr:@std/assert";
import { SerderKERI } from "../../../../../cesr/mod.ts";
import {
  confirmMailboxAuthorization,
  validateMailboxAuthorizationReply,
} from "../../../../../tufa/src/http/protocol/endpoints/mailbox-admin.ts";
import type { AgentRuntime } from "../../../../src/app/agent-runtime.ts";
import type { CesrStreamInspection } from "../../../../src/app/cesr-http.ts";

function inspectionFor(
  route: string,
  data: Record<string, unknown>,
): CesrStreamInspection {
  const serder = new SerderKERI({
    sad: {
      t: "rpy",
      dt: "2026-04-08T12:00:00.000000+00:00",
      r: route,
      a: data,
    },
    makify: true,
  });
  return { terminal: serder } as CesrStreamInspection;
}

Deno.test("app/protocol/mailbox-admin - validation rejects unsupported routes before route-specific field checks", async () => {
  const response = validateMailboxAuthorizationReply(
    inspectionFor("/loc/scheme", {}),
    "EMBX",
  );
  assertExists(response);
  assertEquals(response instanceof Response, true);
  if (!(response instanceof Response)) {
    throw new Error("Expected HTTP response.");
  }
  assertEquals(response.status, 400);
  assertEquals(await response.text(), "Unsupported mailbox authorization route");
});

Deno.test("app/protocol/mailbox-admin - validation accepts well-formed mailbox authorization replies", () => {
  const accepted = validateMailboxAuthorizationReply(
    inspectionFor("/end/role/add", {
      cid: "ECID",
      role: "mailbox",
      eid: "EMBX",
    }),
    "EMBX",
  );
  assertEquals(accepted, {
    cid: "ECID",
    role: "mailbox",
    expected: true,
  });
});

Deno.test("app/protocol/mailbox-admin - confirmation is driven by accepted ends state", async () => {
  const acceptedRuntime = {
    hby: {
      db: {
        ends: {
          get: () => ({ allowed: true }),
        },
      },
    },
  } as unknown as AgentRuntime;

  assertEquals(
    confirmMailboxAuthorization(acceptedRuntime, "ECID", "EMBX", true),
    null,
  );

  const rejectedRuntime = {
    hby: {
      db: {
        ends: {
          get: () => null,
        },
      },
    },
  } as unknown as AgentRuntime;

  const rejection = confirmMailboxAuthorization(
    rejectedRuntime,
    "ECID",
    "EMBX",
    true,
  );
  assertExists(rejection);
  assertEquals(rejection instanceof Response, true);
  if (!(rejection instanceof Response)) {
    throw new Error("Expected rejection response.");
  }
  assertEquals(rejection.status, 403);
  assertEquals(
    await rejection.text(),
    "Mailbox authorization reply was not accepted",
  );
});
