// @file-test-lane app-fast-isolated

import { type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import {
  endpointRoleAccepted,
  isLocalGroupHab,
  loadAcceptedEndpointRole,
  proposeGroupEndpointRole,
} from "../../../src/app/endpoint-roleing.ts";
import { MULTISIG_RPY_ROUTE } from "../../../src/app/grouping.ts";
import type { Hab, Habery } from "../../../src/app/habbing.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Roles } from "../../../src/core/roles.ts";

function makeTransferableHab(hby: Habery, name: string): Hab {
  return hby.makeHab(name, undefined, {
    transferable: true,
    icount: 1,
    isith: "1",
    ncount: 1,
    nsith: "1",
    toad: 0,
  });
}

Deno.test("endpoint-roleing proposes group endpoint roles through /multisig/rpy", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `endpoint-role-propose-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const member = makeTransferableHab(hby, "member");
      const remote = makeTransferableHab(hby, "remote");
      const { hab: group } = hby.makeGroupHab("group", member, [member.pre, remote.pre], undefined, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
      });
      hby.habs.delete(remote.pre);

      const sent: Record<string, unknown>[] = [];
      const runtime = {
        hby,
        reactor: {
          processChunk() {},
          processEscrowsOnce() {},
        },
        poster: {
          *sendExchange(
            _member: Hab,
            args: Record<string, unknown>,
          ): Operation<{ deliveries: string[]; queued: string[] }> {
            sent.push(args);
            return { deliveries: ["stub-delivery"], queued: [] };
          },
        },
      } as unknown as AgentRuntime;

      const result = yield* proposeGroupEndpointRole(runtime, group, {
        eid: remote.pre,
        role: Roles.mailbox,
        allow: true,
      });

      assertEquals(isLocalGroupHab(hby, group), true);
      assertEquals(result.route, MULTISIG_RPY_ROUTE);
      assertEquals(result.group, group.pre);
      assertEquals(result.deliveries, ["stub-delivery"]);
      assertEquals(sent.length, 1);
      assertEquals(sent[0]?.route, MULTISIG_RPY_ROUTE);
      assertEquals(sent[0]?.payload, { gid: group.pre });
      assertExists((sent[0]?.embeds as Record<string, unknown>).rpy);
    } finally {
      yield* hby.close(true);
    }
  });
});

Deno.test("endpoint-roleing loads accepted group endpoint role replies", async () => {
  await run(function*() {
    const hby = yield* createHabery({
      name: `endpoint-role-complete-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    try {
      const member = makeTransferableHab(hby, "member");
      const mailbox = makeTransferableHab(hby, "mailbox");
      const { hab: group } = hby.makeGroupHab("group", member, [member.pre], undefined, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
      });

      const result = yield* proposeGroupEndpointRole(runtime, group, {
        eid: mailbox.pre,
        role: Roles.mailbox,
        allow: true,
      });

      assertEquals(result.accepted, true);
      assertEquals(endpointRoleAccepted(hby, group.pre, Roles.mailbox, mailbox.pre), true);
      assertEquals(loadAcceptedEndpointRole(group, mailbox.pre, Roles.mailbox).length > 0, true);
    } finally {
      yield* runtime.close();
      yield* hby.close(true);
    }
  });
});
