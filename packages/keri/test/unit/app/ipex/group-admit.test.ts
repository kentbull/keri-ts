/**
 * A group holder admits a credential through `runtime.operations.groupIpex` alone (run in Docker): no CLI code is
 * in the path.
 *
 * A single-signature issuer issues a v2 DH credential to a 2-of-2 holder group. Both holder members consent to DH
 * (`approveGroupIssuanceExchange`); then one member proposes the Admit, the other lists and approves it, and the
 * runtime publishes, collects, accepts and lets the elected lead deliver the completed Admit to the issuer.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import { Diger, NumberPrimitive, parseBytes, Prefixer, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { RegistryAuthor } from "../../../../src/acdc/authoring.ts";
import type { RegBaser } from "../../../../src/acdc/regbasing.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  approveGroupIpex,
  groupIpexProposals,
  groupIpexStatus,
  proposeGroupAdmit,
  waitForGroupIpex,
} from "../../../../src/app/ipex/group-ipex.ts";
import { approveGroupIssuanceExchange } from "../../../../src/app/ipex/group-issuance.ts";
import { beginIssuance, issuanceStatus, waitForIssuance } from "../../../../src/app/ipex/issuance.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import type { Receiptor } from "../../../../src/app/witness/receipting.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { interact, reply } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";

const KRAM = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } as const;
const BUDGET_MS = 60_000;

interface Side {
  name: string;
  hby: Habery;
  baser: RegBaser;
  member: Hab;
  hab: Hab;
  runtime: AgentRuntime;
  handler: ReturnType<typeof createProtocolHandler>;
}

function* until(cond: () => boolean, what: string, ms = BUDGET_MS): Operation<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    yield* sleep(20);
  }
}

Deno.test("a group holder admits through the library: propose, list, approve, accept, deliver", async () => {
  await run(function*() {
    const sides: Side[] = [];
    for (const name of ["issuer", "holder-1", "holder-2"]) {
      const hby = yield* createHabery({
        name: `${name}-${crypto.randomUUID()}`,
        bran: `${name}GroupAdmitPasscodeABCDE`,
        temp: true,
        skipConfig: true,
        skipSignator: true,
      });
      const baser = yield* openLmdbRegistry({ name: `${name}-${crypto.randomUUID()}`, temp: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
        acdc: new Regery(hby, baser),
        kram: KRAM,
      });
      const member = hby.makeHab(name);
      sides.push({ name, hby, baser, member, hab: member, runtime } as Side);
    }
    yield* ensure(function*() {
      for (const side of sides) {
        yield* side.runtime.close();
        yield* side.hby.close(true);
        yield* side.baser.close(true);
      }
    });
    const [issuer, h1, h2] = sides, holders = [h1, h2];
    for (const source of sides) {
      for (const target of sides) {
        if (source === target) continue;
        for (const wire of source.hby.db.clonePreIter(source.member.pre!, 0)) {
          yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), target.hby.rvy, target.hby.kevery);
        }
      }
    }
    const signing = holders.map((side) => side.member.pre!);
    const creations = holders.map((side) =>
      side.hby.makeGroupHab("group", side.member, signing, signing, undefined, { isith: "2", nsith: "2" })
    );
    const inception = parseBytes(messagize(creations[0].serder, {
      sigers: [...creations[0].sigers, ...creations[1].sigers],
      gvrsn: Vrsn_2_0,
    }))[0];
    for (const side of sides) {
      yield* dispatchEnvelope(envelopeFromFrame(inception, true), side.hby.rvy, side.hby.kevery);
    }
    h1.hab = creations[0].hab;
    h2.hab = creations[1].hab;
    const intakeAll = function*(wire: Uint8Array, local = false) {
      for (const side of sides) yield* side.runtime.reactor.processBytes(wire, { local });
    };
    const groupProof = (body: SerderKERI) =>
      new TransIdxSigGroup(
        new Prefixer({ qb64: h1.hab.pre! }),
        NumberPrimitive.fromNum(0n),
        new Diger({ qb64: h1.hab.kever!.lastEst.d }),
        holders.flatMap((side) => side.hab.sign(body.raw, true)),
      );
    // The holder group's coordinator: an accepted group event that elects its custodian.
    const state = h1.hab.kever!;
    const coordinator = interact(h1.hab.pre!, state.said, state.sn + 1, [], { version: Vrsn_2_0 });
    yield* intakeAll(
      messagize(coordinator, {
        sigers: holders.flatMap((side) => side.hab.sign(coordinator.raw, true)),
        gvrsn: Vrsn_2_0,
      }),
      true,
    );

    for (const side of sides) {
      side.handler = createProtocolHandler(side.runtime, {
        hostedPrefixes: [side.member.pre!, side.hab.pre!],
        serviceHab: side.member,
      });
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => side.handler(request));
      yield* ensure(() =>
        call(async () => {
          await server.shutdown();
          await side.handler.close?.();
        })
      );
      yield* intakeAll(side.member.makeLocScheme(`http://127.0.0.1:${server.addr.port}/`, side.member.pre!, "http"));
      yield* intakeAll(side.member.makeEndRole(side.member.pre!, Roles.controller, true));
      if (side !== issuer) {
        const controller = reply("/end/role/add", {
          cid: side.hab.pre,
          role: Roles.controller,
          eid: side.member.pre,
        }, { pre: side.hab.pre!, pvrsn: Vrsn_2_0 });
        yield* intakeAll(messagize(controller, { tsgs: [groupProof(controller)], gvrsn: Vrsn_2_0 }));
      }
    }
    for (const side of sides) side.runtime.ipex!.dhke(side.hab);

    // The issuer's registry and credential for the holder group.
    const stub = { hby: issuer.hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
    const author = new RegistryAuthor(issuer.runtime.acdc!, stub);
    yield* author.incept("issued", issuer.hab.pre!);
    const registry = author.registry("issued", issuer.hab.pre!);
    const credential = author.create(registry, { issuee: h1.hab.pre!, attribute: { name: "Ada" } });

    const host = (side: Side) => spawn(() => runAgentRuntime(side.runtime, { hab: side.member, pollMailbox: false }));
    const hosts = [yield* host(issuer), yield* host(h1), yield* host(h2)];
    const issuance = issuer.runtime.operations!.issuance;
    const { grant } = yield* beginIssuance(issuance, {
      hab: issuer.hab,
      credential,
      options: { recipient: h1.hab.pre!, message: "Issue" },
    });

    // Both holder members consent to DH once the full Grant has arrived.
    const selection = (side: Side) => ({
      hab: side.hab,
      coordinator: coordinator.said!,
      custodian: h1.member.pre!,
      grant,
    });
    for (const side of holders) {
      yield* until(() => !!side.runtime.exc.retainedInput(grant, { pending: true }), `${side.name} to hold the Grant`);
      approveGroupIssuanceExchange(side.runtime.operations!.issuance, selection(side));
    }
    assertEquals((yield* waitForIssuance(issuance, grant, { timeoutMs: BUDGET_MS })).status.state, "done");
    for (const side of holders) {
      const waiting = yield* waitForIssuance(side.runtime.operations!.issuance, grant, {
        timeoutMs: BUDGET_MS,
        until: (status) => status.state !== "active" || status.needs === "admit",
      });
      assertEquals([waiting.status.state, (waiting.status as { needs?: string }).needs], ["active", "admit"]);
      assert(side.runtime.exc.complete(grant), `${side.name} holds the accepted Grant`);
      assertEquals(issuanceStatus(side.runtime.operations!.issuance, grant).state, "active");
    }

    // --- the Admit: one member proposes (its consent), the other lists and approves (its consent) ---
    const ops1 = h1.runtime.operations!.groupIpex, ops2 = h2.runtime.operations!.groupIpex;
    const proposed = yield* proposeGroupAdmit(ops1, { hab: h1.hab, grant, message: "Group admit" });
    const admit = proposed.said;
    assertEquals(groupIpexStatus(ops1, admit), { state: "active", phase: "publishing" });
    yield* until(
      () => groupIpexProposals(ops2, h2.hab).some((proposal) => proposal.said === admit),
      "the second member to hold the Admit proposal",
    );
    const listed = groupIpexProposals(ops2, h2.hab);
    assertEquals(
      listed.map((p) => [p.said, p.route, p.group, p.proposer, p.approved, p.complete]),
      [[admit, "/ipex/admit", h2.hab.pre, h1.member.pre, false, false]],
    );
    assertEquals(groupIpexStatus(ops2, admit), { state: "active", phase: "awaitingConsent", needs: "approve" });
    assert(!h2.runtime.exc.complete(admit), "the Admit needs the second member's consent");
    yield* approveGroupIpex(ops2, { said: admit });

    // The runtime completes: both members accept, the lead delivers it to the issuer.
    for (const ops of [ops1, ops2]) {
      assertEquals((yield* waitForGroupIpex(ops, admit, { timeoutMs: BUDGET_MS })).status, {
        state: "done",
        phase: "accepted",
      });
    }
    for (const side of holders) assert(side.runtime.exc.complete(admit), `${side.name} accepted the Admit`);
    yield* until(() => issuer.runtime.exc.complete(admit), "the issuer to accept the completed Admit");
    assertExists(issuer.hby.db.erpy.get([grant]));
    assertEquals(
      holders.filter((side) => side.runtime.operations!.groupIpex.outcomes.get(admit)?.deliveries.length).length,
      1,
      "exactly the elected lead delivered the completed Admit",
    );
    for (const task of hosts) yield* task.halt();
  });
});
