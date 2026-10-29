import { SerderKERI } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertStrictEquals } from "jsr:@std/assert";
import {
  endpointRoleAccepted,
  loadAcceptedEndpointRole,
  proposeGroupEndpointRole,
} from "../../../../src/app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/habbing.ts";
import { isLocalGroupHab } from "../../../../src/app/multisig/group-members.ts";
import { MULTISIG_RPY_ROUTE } from "../../../../src/app/multisig/grouping.ts";
import { createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { Roles } from "../../../../src/core/roles.ts";

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
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const member = makeTransferableHab(hby, "member");
      const remote = makeTransferableHab(hby, "remote");
      const other = makeTransferableHab(hby, "other");
      const { hab: group } = hby.makeGroupHab(
        "group",
        member,
        [member.pre, remote.pre, other.pre],
        undefined,
        undefined,
        {
          isith: "1",
          nsith: "1",
          toad: 0,
        },
      );
      hby.habs.delete(remote.pre);
      hby.habs.delete(other.pre);

      const sent: { recipient: string; exnSaid: string; payloadSaid: string }[] = [];
      let sends = 0;
      runtime.postman.send = function(evt) {
        const serder = new SerderKERI({ raw: evt.msg });
        assertEquals(evt.src, member.pre);
        assertEquals(evt.dest, [remote.pre, other.pre][sends]);
        assertEquals(serder.route, MULTISIG_RPY_ROUTE);
        assertEquals(serder.ked?.a, { gid: group.pre, i: evt.dest });
        assertExists(serder.ked?.e);
        assertEquals(runtime.exc.complete(serder.said!), true);
        assertEquals(hby.db.exns.get([serder.said!])?.raw, serder.raw);
        sent.push({ recipient: evt.dest, exnSaid: serder.said!, payloadSaid: (serder.ked!.e as { d: string }).d });
        sends++;
        return { ...evt, kin: "msg" };
      };
      runtime.postman.wait = function*(evt) {
        return { kin: "sent", evt, deliveries: ["https://mailbox.test/"] };
      };

      const result = yield* proposeGroupEndpointRole(hby, runtime.protocol, runtime.postman, group, {
        eid: remote.pre,
        role: Roles.mailbox,
        allow: true,
      });

      assertEquals(isLocalGroupHab(hby, group), true);
      assertEquals(result.route, MULTISIG_RPY_ROUTE);
      assertEquals(result.group, group.pre);
      assertEquals(result.messages, sent);
      assertEquals(new Set(sent.map((message) => message.exnSaid)).size, 2);
      assertEquals(result.deliveries, ["https://mailbox.test/", "https://mailbox.test/"]);
      assertEquals(sends, 2);

      const failure = new Error("mailbox refused the proposal");
      sends = 0;
      runtime.postman.wait = function*(evt) {
        return { kin: "failed", evt, deliveries: [], error: failure };
      };
      const caught = yield* call(() =>
        assertRejects(() =>
          run(() =>
            proposeGroupEndpointRole(hby, runtime.protocol, runtime.postman, group, {
              eid: remote.pre,
              role: Roles.mailbox,
              allow: true,
            })
          )
        )
      );
      assertStrictEquals(caught, failure, "queue admission cannot report successful proposal delivery");
    } finally {
      yield* runtime.close();
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
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const member = makeTransferableHab(hby, "member");
      const mailbox = makeTransferableHab(hby, "mailbox");
      const { hab: group } = hby.makeGroupHab("group", member, [member.pre], undefined, undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
      });

      const result = yield* proposeGroupEndpointRole(hby, runtime.protocol, runtime.postman, group, {
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
