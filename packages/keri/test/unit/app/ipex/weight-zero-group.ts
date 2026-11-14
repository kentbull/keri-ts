/**
 * The weight-0 group fixture (run in Docker): an issuer, and a holder group whose edge member's signature alone
 * satisfies the threshold `["1", "0"]` while the custodian member carries no weight and holds the group's sole
 * next-key commitment. Every party has a real runtime and HTTP endpoint. `grantToGroup` has the issuer grant a v2 DH
 * credential to the group, admitted on the edge member's signature alone, while the custodian's own runtime follows
 * the final proof with no call from the test; `custodianAccepts` checks that the custodian took that Admit, which the
 * edge member's signature completes, without approving it. Shared by `group-weight-zero.test.ts` and the wallet's inventory-rebuild tests, which refill a fresh
 * edge store from the custodian.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import {
  Diger,
  MtrDex,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SerderACDC,
  type SerderKERI,
  type Siger,
  Signer,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation, sleep, spawn, type Task } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { RegistryAuthor } from "../../../../src/acdc/authoring.ts";
import type { RegBaser } from "../../../../src/acdc/regbasing.ts";
import { Regery } from "../../../../src/acdc/registraring.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import { exportDisclosureStream } from "../../../../src/app/ipex/disclosure-replaying.ts";
import {
  groupIpexProposals,
  groupIpexStatus,
  proposeGroupAdmit,
  waitForGroupIpex,
} from "../../../../src/app/ipex/group-ipex.ts";
import { approveGroupIssuanceExchange } from "../../../../src/app/ipex/group-issuance.ts";
import {
  type IssuanceStatus,
  issuanceStatus,
  proposeIssuance,
  waitForIssuance,
} from "../../../../src/app/ipex/issuance.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import type { Receiptor } from "../../../../src/app/witness/receipting.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { incept, interact, reply } from "../../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../../src/core/roles.ts";
import { loadNests } from "../../../../src/db/exchange/exchange-nests.ts";
import { openLmdbRegistry } from "../../../../src/db/lmdb-stores.ts";

export const KRAM = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } as const;
export const BUDGET_MS = 60_000;

export interface Side {
  name: string;
  hby: Habery;
  baser: RegBaser;
  member: Hab;
  hab: Hab;
  runtime: AgentRuntime;
  handler: ReturnType<typeof createProtocolHandler>;
  url: string;
}

/** One top-level message a side's HTTP endpoint received: its SAID, sender and route. */
export interface Arrival {
  said: string | null;
  sender: unknown;
  route: unknown;
}

/** A non-transferable, single-key, inception-only identifier built outside any Habery, as an edge device holds it. */
export interface HeldEdge {
  signer: Signer;
  serder: SerderKERI;
  sigers: Siger[];
}

/** The three parties, the holder group and its coordinator, with every runtime hosted and every endpoint served. */
export interface WeightZeroGroup {
  sides: Side[];
  issuer: Side;
  edge: Side;
  custodian: Side;
  group: string;
  /** The edge member's signed inception and signer when it is a held non-transferable identifier, else null. */
  edgeKeys: HeldEdge | null;
  coordinator: SerderKERI;
  arrivals: Arrival[];
  hosts: Task<void>[];
}

/** What a completed Grant left behind. */
export interface Granted {
  grant: string;
  admit: string;
  credential: SerderACDC;
  regk: string;
}

/** Steps a test inserts into {@link grantToGroup}. */
export interface GrantSteps {
  /** Runs once both members hold the pending Grant, before the edge member consents to DH. */
  beforeConsent?: (grant: string) => Operation<void>;
  /**
   * Brings the weight-0 member to the accepted Grant once it holds the lead's proof, its TEL head and its root copy.
   * Default: nothing, because the weight-0 member's own runtime follows the proof.
   */
  follow?: (grant: string) => Operation<void>;
}

/** The status fields a test compares: state, phase and what the status asks for. */
export function shape(status: IssuanceStatus): [string, string | undefined, string | undefined] {
  return [status.state, (status as { phase?: string }).phase, (status as { needs?: string }).needs];
}

export function* until(cond: () => boolean, what: string, ms = BUDGET_MS): Operation<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    yield* sleep(20);
  }
}

/** The routes of the multisig wrappers `side` holds from `sender`. */
export function wrappersFrom(side: Side, sender: string): string[] {
  return [...side.hby.db.exns.getTopItemIter()].map(([, body]) => body)
    .filter((body) => body.pre === sender && body.route?.startsWith("/multisig/"))
    .map((body) => body.route!);
}

export function heldEdge(): HeldEdge {
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const serder = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  return { signer, serder, sigers: [signer.sign(serder.raw, { index: 0 }) as Siger] };
}

/** Accept every accepted event of `pre` from `from` at each of `to`, from `sn` on. */
export function* shareKel(from: Habery, pre: string, to: Side[], sn = 0): Operation<void> {
  for (const wire of from.db.clonePreIter(pre, sn)) {
    for (const target of to) {
      if (target.hby === from) continue;
      yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), target.hby.rvy, target.hby.kevery);
    }
  }
}

/**
 * Build the parties and a holder group with signing threshold `["1", "0"]` in which the custodian is the only
 * rotation member. With `nonTransferableEdge`, the edge member is a held non-transferable identifier. Every group
 * signature here is the edge member's alone.
 */
export function* weightZeroGroup(nonTransferableEdge: boolean): Operation<WeightZeroGroup> {
  const sides: Side[] = [];
  let edgeKeys: HeldEdge | null = null;
  for (const name of ["issuer", "edge", "custodian"]) {
    const hby = yield* createHabery({
      name: `${name}-${crypto.randomUUID()}`,
      bran: `${name}WeightZeroPasscodeABCDE`,
      temp: true,
      skipConfig: true,
      skipSignator: true,
    });
    const baser = yield* openLmdbRegistry({ name: `${name}-${crypto.randomUUID()}`, temp: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
      acdc: new Regery(hby, baser),
      kram: KRAM,
    });
    let member: Hab;
    if (name === "edge" && nonTransferableEdge) {
      const held = edgeKeys = heldEdge();
      member = hby.makeSignedHab(name, undefined, { serder: held.serder, sigers: held.sigers });
      hby.mgr.hold([held.signer]);
    } else member = hby.makeHab(name);
    sides.push({ name, hby, baser, member, hab: member, runtime } as Side);
  }
  yield* ensure(function*() {
    for (const side of sides) {
      yield* side.runtime.close();
      yield* side.hby.close(true);
      yield* side.baser.close(true);
    }
  });
  const [issuer, edge, custodian] = sides;
  if (nonTransferableEdge) {
    assert(edge.member.pre!.startsWith("B"), "the edge member is a non-transferable basic prefix");
    assertEquals(edge.member.kever!.transferable, false);
    assertEquals(edge.member.kever!.ndigers.length, 0, "the edge member commits no next key");
  }
  for (const source of sides) yield* shareKel(source.hby, source.member.pre!, sides);

  // Both members sign; only the edge member's signature carries weight; only the custodian commits a next key.
  const signing = [edge.member.pre!, custodian.member.pre!];
  const creations = [edge, custodian].map((side) =>
    side.hby.makeGroupHab("group", side.member, signing, [custodian.member.pre!], undefined, {
      isith: ["1", "0"],
      nsith: "1",
    })
  );
  assertEquals(creations[0].serder.ked!.kt, ["1", "0"]);
  assertEquals(creations[0].serder.ked!.n, creations[1].serder.ked!.n, "one next-key commitment, the custodian's");
  assertEquals((creations[0].serder.ked!.n as string[]).length, 1);
  // The edge member's signature alone incepts the group, everywhere.
  const inception = parseBytes(messagize(creations[0].serder, { sigers: creations[0].sigers, gvrsn: Vrsn_2_0 }))[0];
  for (const side of sides) {
    yield* dispatchEnvelope(envelopeFromFrame(inception, true), side.hby.rvy, side.hby.kevery);
  }
  edge.hab = creations[0].hab;
  custodian.hab = creations[1].hab;
  const group = edge.hab.pre!;
  for (const side of sides) assertExists(side.hby.db.getKever(group), `${side.name} accepts the group`);
  assertEquals(
    custodian.hby.ks.getSmids(group).map((tuple) => tuple[0].qb64),
    signing,
    "the weight-0 member is a signing member",
  );

  const intakeAll = function*(wire: Uint8Array, local = false) {
    for (const side of sides) yield* side.runtime.reactor.processBytes(wire, { local });
  };
  const groupProof = (body: SerderKERI) =>
    new TransIdxSigGroup(
      new Prefixer({ qb64: group }),
      NumberPrimitive.fromNum(0n),
      new Diger({ qb64: edge.hab.kever!.lastEst.d }),
      edge.hab.sign(body.raw, true),
    );
  // The coordinator: an accepted group event that elects the lowest signing index, the edge member, as lead.
  const state = edge.hab.kever!;
  const coordinator = interact(group, state.said, state.sn + 1, [], { version: Vrsn_2_0 });
  yield* intakeAll(messagize(coordinator, { sigers: edge.hab.sign(coordinator.raw, true), gvrsn: Vrsn_2_0 }), true);
  for (const side of sides) assertEquals(side.hby.db.getKever(group)?.sn, 1, `${side.name} accepts the coordinator`);

  // Real endpoints. A group's endpoints are its members'; the custodian's endpoint records what reaches it.
  const arrivals: Arrival[] = [];
  for (const side of sides) {
    side.handler = createProtocolHandler(side.runtime, {
      hostedPrefixes: [side.member.pre!, side.hab.pre!],
      serviceHab: side.member,
    });
    const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
      if (side === custodian) {
        try {
          for (const frame of parseBytes(new Uint8Array(await request.clone().arrayBuffer()))) {
            arrivals.push({ said: frame.body.said, sender: frame.body.ked?.i, route: frame.body.ked?.r });
          }
        } catch {
          // Not every request body is a parseable message stream; only messages are recorded.
        }
      }
      return side.handler(request);
    });
    yield* ensure(() =>
      call(async () => {
        await server.shutdown();
        await side.handler.close?.();
      })
    );
    side.url = `http://127.0.0.1:${server.addr.port}/`;
    yield* intakeAll(side.member.makeLocScheme(side.url, side.member.pre!, "http"));
    yield* intakeAll(side.member.makeEndRole(side.member.pre!, Roles.controller, true));
    if (side !== issuer) {
      const controller = reply("/end/role/add", {
        cid: group,
        role: Roles.controller,
        eid: side.member.pre,
      }, { pre: group, pvrsn: Vrsn_2_0 });
      yield* intakeAll(messagize(controller, { tsgs: [groupProof(controller)], gvrsn: Vrsn_2_0 }));
    }
  }
  const host = (side: Side) => spawn(() => runAgentRuntime(side.runtime, { hab: side.member, pollMailbox: false }));
  const hosts = [yield* host(issuer), yield* host(edge), yield* host(custodian)];
  return { sides, issuer, edge, custodian, group, edgeKeys, coordinator, arrivals, hosts };
}

/**
 * The issuer grants a credential to the group; the edge member alone consents to DH and admits it, and the weight-0
 * custodian's runtime follows the final proof without being asked. Asserts (a) the edge member sends the custodian the
 * group's exchange messages, (b) the issuer delivers the Grant to the custodian's own endpoint, (c) the custodian
 * holds the accepted Grant, the credential, the issuer's TEL head and the registry root, and (d) DH and the Admit
 * complete on the edge member's signature alone.
 */
export function* grantToGroup(g: WeightZeroGroup, steps: GrantSteps = {}): Operation<Granted> {
  const { issuer, edge, custodian, group, coordinator, arrivals } = g;
  const stub = { hby: issuer.hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
  const author = new RegistryAuthor(issuer.runtime.acdc!, stub);
  yield* author.incept("issued", issuer.hab.pre!);
  const registry = author.registry("issued", issuer.hab.pre!);
  const credential = author.create(registry, { issuee: group, attribute: { name: "Ada" } });
  const issuance = issuer.runtime.operations!.issuance;
  const { grant } = yield* proposeIssuance(issuance, { credential, options: { recipient: group, message: "Issue" } });

  // (b) The issuer delivers the Grant to the weight-0 member's own endpoint, not only to the edge member's.
  yield* until(
    () => arrivals.some((arrival) => arrival.said === grant && arrival.sender === issuer.hab.pre),
    "the issuer to deliver the Grant to the weight-0 member",
  );
  yield* until(
    () => !!custodian.runtime.exc.retainedInput(grant, { pending: true }),
    "the custodian to hold the Grant",
  );

  // Only the edge member consents to DH; the custodian never consents to anything.
  yield* until(() => !!edge.runtime.exc.retainedInput(grant, { pending: true }), "the edge member to hold the Grant");
  if (steps.beforeConsent) yield* steps.beforeConsent(grant);
  approveGroupIssuanceExchange(edge.runtime.operations!.issuance, grant, coordinator.said!);
  const edgeWaiting = yield* waitForIssuance(edge.runtime.operations!.issuance, grant, {
    timeoutMs: BUDGET_MS,
    until: (status) => status.state !== "active" || status.needs === "admit",
  });
  assertEquals(
    [edgeWaiting.status.state, (edgeWaiting.status as { needs?: string }).needs],
    ["active", "admit"],
    JSON.stringify(edgeWaiting.status),
  );
  assertEquals((yield* waitForIssuance(issuance, grant, { timeoutMs: BUDGET_MS })).status.state, "done");

  // --- (d) the Admit completes on the edge member's signature alone ---
  const proposed = yield* proposeGroupAdmit(edge.runtime.operations!.groupIpex, {
    hab: edge.hab,
    grant,
    message: "Group admit",
  });
  const admit = proposed.said;
  assertEquals(
    (yield* waitForGroupIpex(edge.runtime.operations!.groupIpex, admit, { timeoutMs: BUDGET_MS })).status,
    { state: "done", phase: "accepted" },
    "the Admit completes without the weight-0 member's signature",
  );
  yield* until(() => issuer.runtime.exc.complete(admit), "the issuer to accept the group's Admit");

  // (a) The edge member sent the weight-0 member each group exchange message it publishes, to its own endpoint.
  assertEquals(
    edge.runtime.operations!.groupIpex.outcomes.get(admit)!.members.map((sent) => [sent.recipient, sent.outcome]),
    [[custodian.member.pre, "delivered"]],
    "the Admit proposal went to the weight-0 member",
  );
  yield* until(
    () =>
      ["/multisig/rpy", "/multisig/ipex-proof", "/multisig/exn"].every((route) =>
        wrappersFrom(custodian, edge.member.pre!).includes(route)
      ),
    "the custodian to hold the edge member's DH reply, DH proof and Admit wrappers",
  );
  assert(
    arrivals.some((arrival) => arrival.sender === edge.member.pre && arrival.route === "/multisig/exn"),
    "the wrappers reached the custodian's own endpoint",
  );
  assertEquals(
    groupIpexProposals(custodian.runtime.operations!.groupIpex, custodian.hab).map((p) => [p.said, p.proposer]),
    [[admit, edge.member.pre]],
    "the custodian processed the Admit proposal",
  );

  // (c) The weight-0 member holds the issuer's TEL head and the registry root without consenting to anything.
  const regk = registry.regk!;
  const tel = (side: Side) => side.runtime.acdc!.store.headEvent(regk)?.said;
  const root = edge.hab.mgr.getRegistryRoot(group, regk);
  assertExists(root, "the lead holds the registry root");
  yield* until(() => tel(custodian) === tel(issuer), "the custodian to hold the issuer's TEL head");
  assertEquals(issuer.runtime.acdc!.store.headEvent(regk)?.ilk, "bup", "the TEL head is the issuance update");
  yield* until(() => !!custodian.hab.mgr.getRegistryRoot(group, regk), "the custodian to retain its root copy");
  assertEquals(custodian.hab.mgr.getRegistryRoot(group, regk)?.qb64, root.qb64);
  // The group completed the key exchange without the weight-0 member, so it is too late for it to consent. Its
  // runtime follows the lead's final proof on its own, signing nothing; meanwhile it reads active, never interrupted.
  if (steps.follow) yield* steps.follow(grant);
  else {
    const during = issuanceStatus(custodian.runtime.operations!.issuance, grant);
    assertEquals(during.state, "active", JSON.stringify(during));
    const followed = yield* waitForIssuance(custodian.runtime.operations!.issuance, grant, {
      timeoutMs: BUDGET_MS,
      until: (status) => status.state !== "active" || status.needs === "admit",
    });
    // Once the Grant is accepted the custodian also takes the group's Admit, which the edge member's signature
    // completes, so its issuance may already read admitted.
    const after = shape(followed.status);
    assert(
      ["active,awaitingAdmitConsent,admit", "done,admitted,"].includes(after.map((part) => part ?? "").join()),
      JSON.stringify(after),
    );
  }
  yield* until(() => custodian.runtime.exc.complete(grant), "the custodian to accept the Grant");
  assertCustodianHolds(g, { grant, admit, credential, regk });
  // The weight-0 member contributed nothing to any of it.
  assertEquals(wrappersFrom(edge, custodian.member.pre!), [], "the custodian sent no group contribution");
  return { grant, admit, credential, regk };
}

/** The custodian holds the accepted Grant, its credential, the issuer's TEL head and the group's registry root. */
export function assertCustodianHolds(g: WeightZeroGroup, granted: Granted): void {
  const { issuer, edge, custodian, group } = g, { grant, credential, regk } = granted;
  assert(custodian.runtime.exc.complete(grant), "the custodian holds the accepted Grant");
  assert(
    loadNests(custodian.hby.db, grant).some((frame) => frame.body.said === credential.said),
    "the custodian holds the credential the Grant carries",
  );
  assertEquals(
    custodian.runtime.acdc!.store.headEvent(regk)?.said,
    issuer.runtime.acdc!.store.headEvent(regk)?.said,
    "the custodian holds the issuer's TEL head",
  );
  assertEquals(
    custodian.hab.mgr.getRegistryRoot(group, regk)?.qb64,
    edge.hab.mgr.getRegistryRoot(group, regk)?.qb64,
    "the custodian holds the registry root",
  );
}

/**
 * The weight-0 member takes the group's Admit, which the edge member's signature already completes, from the edge
 * member's wrapper without approving it: it signs nothing, begins no operation, and its status reads accepted. (KERIpy's
 * Multiplexor replays a child only after local approval; keri-ts also takes a child the received signatures complete,
 * so every member holds what the group completed.)
 */
export function* custodianAccepts(g: WeightZeroGroup, admit: string): Operation<void> {
  const { custodian } = g, ops = custodian.runtime.operations!.groupIpex;
  yield* until(() => custodian.runtime.exc.complete(admit), "the custodian to accept the group's completed Admit");
  assertEquals(groupIpexStatus(ops, admit), { state: "done", phase: "accepted" });
  assertEquals(ops.live.size, 0, "the custodian began no operation");
  assertEquals(
    groupIpexProposals(ops, custodian.hab).filter((p) => p.said === admit).map((p) => [p.approved, p.complete]),
    [[false, true]],
    "the custodian contributed nothing to the Admit it holds",
  );
}

/** A receiver with an empty store and no KRAM processes `stream` front to back in one pass and holds the disclosure. */
export function* receives(g: WeightZeroGroup, granted: Granted, stream: Uint8Array): Operation<void> {
  const { edge, group } = g, { grant, admit, regk } = granted;
  const hby = yield* createHabery({
    name: `receiver-${crypto.randomUUID()}`,
    bran: "receiverWeightZeroPasscodeAB",
    temp: true,
    skipConfig: true,
    skipSignator: true,
  });
  const baser = yield* openLmdbRegistry({ name: `receiver-${crypto.randomUUID()}`, temp: true });
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, { acdc: new Regery(hby, baser) });
  yield* ensure(function*() {
    yield* runtime.close();
    yield* hby.close(true);
    yield* baser.close(true);
  });
  yield* runtime.reactor.processBytes(stream);
  assertEquals(hby.db.getKever(group)?.said, edge.hby.db.getKever(group)?.said, "the receiver accepts the group KEL");
  assertEquals(runtime.acdc!.store.headEvent(regk)?.said, edge.runtime.acdc!.store.headEvent(regk)?.said);
  assert(runtime.exc.complete(grant), "the receiver accepts the Grant");
  assert(runtime.exc.complete(admit), "the receiver accepts the Admit");
}

/** The exported replay of `grant` from `side`'s store, as `hab`. */
export function* exported(side: Side, hab: Hab, grant: string): Operation<Uint8Array> {
  return yield* exportDisclosureStream(side.runtime.operations!.issuance.discloser, hab, grant);
}
