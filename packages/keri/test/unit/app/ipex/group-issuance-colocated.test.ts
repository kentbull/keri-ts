/**
 * One Habery holds a member of the issuer group and a member of the holder group of the same Grant (a host with two
 * tenants). The other members are remote. The Grant must reach the holder group's local member in process and its
 * remote member over the wire, and both sides of the Grant must run in that one Habery.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import { Diger, NumberPrimitive, parseBytes, Prefixer, type SerderACDC, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { acdcmap } from "../../../../src/acdc/messaging.ts";
import type { RegBaser } from "../../../../src/acdc/regbasing.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import {
  approveGroupIpex,
  groupIpexProposals,
  proposeGroupAdmit,
  waitForGroupIpex,
} from "../../../../src/app/ipex/group-ipex.ts";
import {
  approveGroupIssuance,
  approveGroupIssuanceExchange,
  groupIssuanceProposals,
  proposeGroupIssuance,
} from "../../../../src/app/ipex/group-issuance.ts";
import {
  IssuanceOperations,
  type IssuanceStatus,
  issuanceStatus,
  waitForIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { interact, reply } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";
import { approvePending } from "../multisig/approve-pending.ts";

const KRAM = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } as const;
const BUDGET_MS = 60_000;

/** One Habery with its stores, runtime and endpoint, and the members it holds. */
interface Site {
  name: string;
  hby: Habery;
  baser: RegBaser;
  runtime: AgentRuntime;
  members: Hab[];
  /** The groups this Habery holds a member of, by group alias. */
  groups: Map<string, Hab>;
  port: number;
}

function* until(cond: () => boolean, what: string, ms = BUDGET_MS): Operation<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    yield* sleep(20);
  }
}

function* openSite(name: string): Operation<Site> {
  const hby = yield* createHabery({
    name: `${name}-${crypto.randomUUID()}`,
    bran: `${name}ColocatedPasscodeABCDEFG`,
    temp: true,
    skipConfig: true,
    skipSignator: true,
  });
  const baser = yield* openLmdbRegistry({ name: `${name}-registry-${crypto.randomUUID()}`, temp: true });
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
    acdc: new Regery(hby, baser),
    kram: KRAM,
  });
  return { name, hby, baser, runtime, members: [], groups: new Map(), port: 0 };
}

export function issuanceOf(site: Site): IssuanceOperations {
  return site.runtime.operations!.issuance;
}

Deno.test("one Habery holding a member of the issuer group and a member of the holder group runs both sides of a Grant", async () => {
  await run(function*() {
    const [x, y, z] = [yield* openSite("x"), yield* openSite("y"), yield* openSite("z")];
    const sites = [x, y, z];
    yield* ensure(function*() {
      for (const site of sites) {
        yield* site.runtime.close();
        yield* site.hby.close(true);
        yield* site.baser.close(true);
      }
    });
    // x holds an issuer member and a holder member; y the other issuer member; z the other holder member.
    const i1 = x.hby.makeHab("i1"), h1 = x.hby.makeHab("h1"), i2 = y.hby.makeHab("i2"), h2 = z.hby.makeHab("h2");
    x.members.push(i1, h1);
    y.members.push(i2);
    z.members.push(h2);
    for (const source of sites) {
      for (const member of source.members) {
        for (const target of sites) {
          if (target === source) continue;
          for (const wire of source.hby.db.clonePreIter(member.pre!, 0)) {
            yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), target.hby.rvy, target.hby.kevery);
          }
        }
      }
    }
    const issuerMids = [i1.pre!, i2.pre!], holderMids = [h1.pre!, h2.pre!];
    const issuerCreated = [[x, i1], [y, i2]].map(([site, member]) =>
      (site as Site).hby.makeGroupHab("issuers", member as Hab, issuerMids, issuerMids, undefined, {
        isith: "2",
        nsith: "2",
      })
    );
    const holderCreated = [[x, h1], [z, h2]].map(([site, member]) =>
      (site as Site).hby.makeGroupHab("holders", member as Hab, holderMids, holderMids, undefined, {
        isith: "2",
        nsith: "2",
      })
    );
    const inceptions = [issuerCreated, holderCreated].map((created) =>
      parseBytes(messagize(created[0].serder, {
        sigers: created.flatMap((one) => one.sigers),
        gvrsn: Vrsn_2_0,
      }))[0]
    );
    for (const site of sites) {
      for (const inception of inceptions) {
        yield* dispatchEnvelope(envelopeFromFrame(inception, true), site.hby.rvy, site.hby.kevery);
      }
    }
    x.groups.set("issuers", issuerCreated[0].hab).set("holders", holderCreated[0].hab);
    y.groups.set("issuers", issuerCreated[1].hab);
    z.groups.set("holders", holderCreated[1].hab);
    const issuers = issuerCreated[0].hab, holders = holderCreated[0].hab;
    const intakeAll = function*(wire: Uint8Array, local = false) {
      for (const site of sites) yield* site.runtime.reactor.processBytes(wire, { local });
    };
    /** Every holder of a member of `alias` signs `body` as that group's member. */
    const groupProof = (alias: string, body: ReturnType<typeof interact>) => {
      const habs = sites.flatMap((site) => site.groups.get(alias) ?? []);
      return new TransIdxSigGroup(
        new Prefixer({ qb64: habs[0].pre! }),
        NumberPrimitive.fromNum(0n),
        new Diger({ qb64: habs[0].kever!.lastEst.d }),
        habs.flatMap((hab) => hab.sign(body.raw, true)),
      );
    };
    // eslint
    const registry = x.runtime.acdc!.makeRegistry("group-derived", issuers.pre!);
    const rip = registry.store.event(registry.regk!)!;
    const anchor = interact(issuers.pre!, issuers.kever!.said, issuers.kever!.sn + 1, [{
      i: rip.said!,
      s: rip.sad!.n,
      d: rip.said!,
    }], { version: Vrsn_2_0 });
    yield* intakeAll(
      messagize(anchor, {
        sigers: sites.flatMap((site) => site.groups.get("issuers")?.sign(anchor.raw, true) ?? []),
        gvrsn: Vrsn_2_0,
      }),
      true,
    );
    yield* intakeAll(rip.raw);
    const credential: SerderACDC = acdcmap(issuers.pre!, {
      regid: rip.said!,
      attribute: { d: "", i: holders.pre, name: "Ada" },
    });

    // Real endpoints: one URL per Habery, whatever it holds; the CESR destination says which identifier is meant.
    for (const site of sites) {
      const prefixes = [
        ...site.members.map((member) => member.pre!),
        ...[...site.groups.values()].map((hab) => hab.pre!),
      ];
      const handler = createProtocolHandler(site.runtime, { hostedPrefixes: prefixes, serviceHab: site.members[0] });
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, (request) => handler(request));
      site.port = server.addr.port;
      yield* ensure(() =>
        call(async () => {
          await server.shutdown();
          await handler.close?.();
        })
      );
    }
    for (const site of sites) {
      for (const member of site.members) {
        yield* intakeAll(member.makeLocScheme(`http://127.0.0.1:${site.port}/`, member.pre!, "http"));
        yield* intakeAll(member.makeEndRole(member.pre!, Roles.controller, true));
      }
    }
    for (const [alias, group, members] of [["issuers", issuers, [i1, i2]], ["holders", holders, [h1, h2]]] as const) {
      for (const member of members) {
        const controller = reply("/end/role/add", { cid: group.pre, role: Roles.controller, eid: member.pre }, {
          pre: group.pre!,
          pvrsn: Vrsn_2_0,
        });
        yield* intakeAll(messagize(controller, { tsgs: [groupProof(alias, controller)], gvrsn: Vrsn_2_0 }));
      }
    }
    for (const site of sites) for (const hab of site.groups.values()) site.runtime.ipex!.dhke(hab);

    const draft = { credential, options: { recipient: holders.pre!, message: "Colocated issuance" } };
    const { grant } = yield* proposeGroupIssuance(issuanceOf(x), draft);
    for (const site of sites) {
      yield* spawn(() => runAgentRuntime(site.runtime, { hab: site.members[0], pollMailbox: false }));
    }
    yield* until(
      () => groupIssuanceProposals(issuanceOf(y), y.groups.get("issuers")).some((proposal) => proposal.grant === grant),
      "the issuer member to hold the proposal",
    );
    yield* approveGroupIssuance(issuanceOf(y), grant);
    // The Grant reaches the holder group's remote member and, in process, its local member's side of this Habery.
    yield* until(
      () => !!z.runtime.exc.retainedInput(grant, { pending: true }),
      "the remote holder member to hold the Grant",
    );
    // Both holder members consent: the remote one, and the one this Habery holds beside the issuer member.
    approveGroupIssuanceExchange(issuanceOf(z), grant);
    assertEquals(issuanceStatus(issuanceOf(x), grant, { role: "holder" }).state, "active");
    approveGroupIssuanceExchange(issuanceOf(x), grant);
    assertEquals(issuanceStatus(issuanceOf(x), grant, { role: "issuer" }).role, "issuer");
    // The issuer member approves the registry update the custodian proposes.
    let bup: SerderKERI | undefined;
    yield* until(() => {
      bup = [...y.hby.db.exns.getTopItemIter()].map(([, body]) => body).find((body) => body.route === "/multisig/bup");
      return !!bup;
    }, "the registry update proposal to reach the issuer member");
    assertExists(yield* approvePending(y.hby, y.runtime, { said: bup!.said!, registryName: "group-derived" }));
    const done = (role: "issuer" | "holder") => (status: IssuanceStatus) =>
      status.state !== "active" || (role === "holder" && status.needs === "admit");
    for (const [site, role] of [[x, "issuer"], [y, "issuer"], [x, "holder"], [z, "holder"]] as const) {
      const waited = yield* waitForIssuance(issuanceOf(site), grant, { timeoutMs: BUDGET_MS, role, until: done(role) });
      assertEquals(
        [site.name, waited.outcome, waited.status.state, (waited.status as { needs?: string }).needs],
        [site.name, "settled", role === "issuer" ? "done" : "active", role === "issuer" ? undefined : "admit"],
      );
    }

    // The holder group admits: one member proposes, the other approves, the elected lead delivers it to the issuer
    // group, whose member this Habery holds.
    const groupIpex = (site: Site) => site.runtime.operations!.groupIpex;
    const proposed = yield* proposeGroupAdmit(groupIpex(x), { hab: holders, grant, message: "Colocated admit" });
    const admit = proposed.said;
    yield* until(
      () => groupIpexProposals(groupIpex(z), z.groups.get("holders")).some((proposal) => proposal.said === admit),
      "the second holder member to hold the Admit proposal",
    );
    yield* approveGroupIpex(groupIpex(z), admit);
    for (const site of [x, z]) {
      assertEquals((yield* waitForGroupIpex(groupIpex(site), admit, { timeoutMs: BUDGET_MS })).status, {
        state: "done",
        phase: "accepted",
      });
    }
    yield* until(() => y.runtime.exc.complete(admit), "the remote issuer member to accept the completed Admit");
    assertExists(y.hby.db.erpy.get([grant]));
    assertEquals(issuanceStatus(issuanceOf(x), grant, { role: "holder" }), {
      state: "done",
      role: "holder",
      phase: "admitted",
    });
    // A member with no operation record reads the finished issuance from the stores, not as interrupted.
    for (const site of [y, z]) {
      const fresh = new IssuanceOperations(issuanceOf(site).deps);
      assertEquals(issuanceStatus(fresh, grant).state, "done", site.name);
    }
  });
});
