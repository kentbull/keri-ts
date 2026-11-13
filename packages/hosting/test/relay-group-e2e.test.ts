// @file-test-lane app-fast-parallel
/**
 * An edge acting as its group through its agent, end to end (run in Docker).
 *
 * The downstream product's shape: the edge is a runtime with `relay` set whose member is a non-transferable,
 * single-key identifier with an externally held signer (weight 1). The agent is a real `runHostKernel` host with
 * `enableRelay`, KRAM on and full workers; its Habery holds the agent identifier (the relay) and the custodian member
 * (weight 0, the group's sole rotation member). The group is `[edge member, custodian]`, rotation `[custodian]`,
 * `isith ["1","0"]`, `nsith "1"`, toad 0, no witnesses. The edge member and the group each authorize the agent as
 * `mailbox`. The issuer and the verifier each run their own runtime and endpoint and deliver directly.
 *
 * Setup that is not under test is done in-process: the group's inception and its coordinator event (an accepted
 * group event electing the edge member as lead) are dispatched into the edge's and the agent's stores directly.
 * Everything after that travels over HTTP. The edge's HTTP client records every request that reaches it; the relay
 * guard sits outside that client, so a request to another origin would fail before it is recorded (and fail the step
 * that needed it).
 */
import {
  collectPayload,
  concatBytes,
  MtrDex,
  nestedPayload,
  parseBytes,
  type SerderACDC,
  type SerderKERI,
  type Siger,
  Signer,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn, suspend } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { createHabery } from "keri-ts/db/lmdb";
import {
  AcdcV2Regery as Regery,
  addMailbox,
  type AgentRuntime,
  approveGroupIpex,
  approveGroupIssuanceExchange,
  completeGroupMailbox,
  createAgentRuntime,
  FetchHttpClient,
  groupIpexProposals,
  type Hab,
  type Habery,
  type HttpClient,
  incept,
  interact,
  type MailboxAdminDeps,
  messagize,
  proposeGroupAdmit,
  proposeGroupMailbox,
  proposeGroupPresentation,
  proposeIssuance,
  type Receiptor,
  RegistryAuthor,
  type Relay,
  Roles,
  runAgentRuntime,
  settleRuntimeIngress,
  systemClock,
  waitForGroupIpex,
  waitForIssuance,
} from "keri-ts/runtime";
import type { RegBaser } from "../../keri/src/acdc/regbasing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../keri/src/app/protocol/parsering.ts";
import { loadNests } from "../../keri/src/db/exchange/exchange-nests.ts";
import { openLmdbRegistry } from "../../keri/src/db/lmdb-stores.ts";
import { runHostKernel } from "../src/host/kernel.ts";
import { createProtocolHandler } from "../src/http/protocol-handler.ts";

const KRAM = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } as const;
/** Bound on every single wait; the whole scenario is bounded by the sum of its waits. */
const BUDGET_MS = 60_000;

/** Wait for `cond`, bounded; the error names what was awaited. */
function* until(cond: () => boolean, what: string, ms = BUDGET_MS): Operation<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    yield* sleep(25);
  }
}

/** Reserve a free loopback port for a host that binds it next. */
function reservePort(): number {
  const reservation = Deno.listen({ hostname: "127.0.0.1", port: 0 });
  const port = (reservation.addr as Deno.NetAddr).port;
  reservation.close();
  return port;
}

/** A client for a short-lived runtime that must not reach the network. */
const noEgress: HttpClient = {
  *request() {
    throw new Error("no egress");
  },
  *open() {
    throw new Error("no egress");
  },
};

/** Accept wire into a Habery's state before its host starts, through a short-lived runtime with no egress. */
function* preload(hby: Habery, messages: Uint8Array[]): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, noEgress, systemClock);
  try {
    yield* settleRuntimeIngress(runtime, messages);
  } finally {
    yield* runtime.close();
  }
}

/** One top-level message an HTTP endpoint received: its SAID, ilk, signer (`i`) and route. */
interface Arrival {
  said: string | null;
  ilk: string | null;
  sender: unknown;
  route: unknown;
}

/** Record every top-level message a request body carries. */
async function record(arrivals: Arrival[], request: Request): Promise<void> {
  try {
    for (const frame of parseBytes(new Uint8Array(await request.clone().arrayBuffer()))) {
      const body = frame.body as SerderKERI;
      arrivals.push({ said: body.said, ilk: body.ilk ?? null, sender: body.ked?.i, route: body.ked?.r });
    }
  } catch {
    // Not every request body is a parseable message stream; only messages are recorded.
  }
}

/** A Habery and a v2 registry store whose lifetime is the current scope. */
interface Stores {
  hby: Habery;
  baser: RegBaser;
}

function* stores(name: string): Operation<Stores> {
  const hby = yield* createHabery({
    name: `${name}-${crypto.randomUUID()}`,
    bran: `${name}RelayGroupPasscodeABCDE`,
    temp: true,
    skipConfig: true,
    skipSignator: true,
  });
  const baser = yield* openLmdbRegistry({ name: `${name}-${crypto.randomUUID()}`, temp: true });
  yield* ensure(function*() {
    yield* hby.close(true);
    yield* baser.close(true);
  });
  return { hby, baser };
}

/** A third party: its own runtime, its own HTTP endpoint, direct delivery (no relay). */
interface Party {
  name: string;
  hby: Habery;
  hab: Hab;
  runtime: AgentRuntime;
  url: string;
  /** Every top-level message its endpoint received. */
  arrivals: Arrival[];
}

function* party(name: string): Operation<Party> {
  const { hby, baser } = yield* stores(name);
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
    acdc: new Regery(hby, baser),
    kram: KRAM,
  });
  yield* ensure(() => runtime.close());
  const hab = hby.makeHab(name);
  const handler = createProtocolHandler(runtime, { hostedPrefixes: [hab.pre!], serviceHab: hab });
  const arrivals: Arrival[] = [];
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
    await record(arrivals, request);
    return handler(request);
  });
  yield* ensure(() =>
    call(async () => {
      await server.shutdown();
      await handler.close?.();
    })
  );
  const url = `http://127.0.0.1:${server.addr.port}/`;
  yield* runtime.reactor.processBytes(hab.makeLocScheme(url, hab.pre!, "http"));
  yield* runtime.reactor.processBytes(hab.makeEndRole(hab.pre!, Roles.controller, true));
  const host = yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: false }));
  yield* ensure(() => host.halt());
  return { name, hby, hab, runtime, url, arrivals };
}

/** An HTTP client that records the URL of every request it is asked to make, then makes it. */
function recording(inner: HttpClient, urls: string[]): HttpClient {
  return {
    *request(url, init) {
      urls.push(url);
      return yield* inner.request(url, init);
    },
    *open(url, init) {
      urls.push(url);
      return yield* inner.open(url, init);
    },
  };
}

/** The mailbox-admin collaborators of a composed runtime. */
function adminDeps(runtime: AgentRuntime): MailboxAdminDeps {
  return {
    hby: runtime.hby,
    http: runtime.http,
    reactor: runtime.reactor,
    protocol: runtime.protocol,
    publisher: runtime.kelPublisher,
  };
}

/** Every message stored in the agent's mailbox topics for `pre`, as `[topic, body]` pairs. */
function stored(agent: AgentRuntime, pre: string): [string, SerderKERI][] {
  const found: [string, SerderKERI][] = [];
  for (const [keys, , dig] of agent.mailboxer!.tpcs.getTopItemIter()) {
    const topic = keys.join(".");
    const msg = agent.mailboxer!.msgs.get(dig.qb64);
    if (!topic.startsWith(`${pre}/`) || !msg) continue;
    for (const frame of parseBytes(msg)) found.push([topic, frame.body as SerderKERI]);
  }
  return found;
}

/** The routes of the multisig wrappers a store holds from `sender`. */
function wrappersFrom(hby: Habery, sender: string): string[] {
  return [...hby.db.exns.getTopItemIter()].map(([, body]) => body)
    .filter((body) => body.pre === sender && body.route?.startsWith("/multisig/"))
    .map((body) => body.route!);
}

/** What the scenario observed that the tests judge after it ends. */
interface Observed {
  /** Wall time of the scenario. */
  wallMs: number;
  /**
   * The agent's own mailbox cursor for the group at itself: non-null means the agent's poller consumed the group's
   * mailbox through its own loopback endpoint, so every stored third-party message was taken into the agent's intake
   * a second time after the `/fwd` ingest had already processed it.
   */
  agentGroupCursor: unknown;
}

/**
 * The whole path: onboarding through the agent, the issuer's Grant to the group and the group's Admit, the custodian's
 * copy, the group's presentation to the verifier, authorship and egress. Each numbered block asserts
 * the matching check of the test name's brief.
 */
function* edgeThroughAgent(): Operation<Observed> {
  const started = performance.now();
  const agentPort = reservePort();
  const agentUrl = `http://127.0.0.1:${agentPort}/`;

  // --- the agent: a real host with relaying, KRAM and full workers; it holds the relay and the custodian ---
  const { hby: agentHby } = yield* stores("agent");
  const agent = agentHby.makeHab("agent");
  const custodian = agentHby.makeHab("custodian");
  yield* preload(agentHby, [
    agent.makeLocScheme(agentUrl, agent.pre!, "http"),
    agent.makeEndRole(agent.pre!, Roles.controller, true),
  ]);
  const listening = Promise.withResolvers<void>();
  let hosted: AgentRuntime | undefined;
  const agentHost = yield* spawn(() =>
    runHostKernel(agentHby, {
      enableMailboxStore: true,
      enableRelay: true,
      kram: KRAM,
      serviceHab: agent,
      http: { port: agentPort, hostname: "127.0.0.1", onListen: () => listening.resolve() },
      protocolPolicy: {},
      companionHosts: [function*(runtime) {
        hosted = runtime;
        yield* suspend();
      }],
    })
  );
  yield* ensure(() => agentHost.halt());
  yield* call(() => listening.promise);
  yield* until(() => !!hosted, "the agent runtime");
  const agentRt = hosted!;
  assertExists(agentRt.reactor.kvy.kramer, "the agent judges everything it receives under KRAM");

  // --- the third parties: direct delivery, their own endpoints ---
  const issuer = yield* party("issuer");
  const verifier = yield* party("verifier");

  // --- the edge: a relay runtime over a recording client; its member is a held non-transferable key ---
  const edgeStores = yield* stores("edge");
  const edgeHby = edgeStores.hby;
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const icp = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  const member = edgeHby.makeSignedHab("edge", undefined, {
    serder: icp,
    sigers: [signer.sign(icp.raw, { index: 0 }) as Siger],
  });
  edgeHby.mgr.hold([signer]);
  assert(member.pre!.startsWith("B"), "the edge member is a non-transferable basic prefix");
  const requested: string[] = [];
  const relay: Relay = { aid: agent.pre!, oobi: `${agentUrl}oobi/${agent.pre}/controller` };
  const edge = yield* createAgentRuntime(edgeHby, recording(new FetchHttpClient(), requested), systemClock, {
    relay,
    acdc: new Regery(edgeHby, edgeStores.baser),
    kram: KRAM,
  });
  yield* ensure(() => edge.close());
  const edgeHost = yield* spawn(() => runAgentRuntime(edge, { hab: member }));
  yield* ensure(() => edgeHost.halt());

  // === 1. Onboarding through the agent only ===
  yield* until(() => edgeHby.db.roobi.get(relay.oobi)?.state === "resolved", "the edge to resolve the agent's OOBI");
  // The custodian is served at the agent's origin, so its OOBI is fetched from the agent directly.
  edge.oobiery.resolve(`${agentUrl}oobi/${custodian.pre}/controller`);
  yield* until(() => !!edgeHby.db.getKever(custodian.pre!), "the edge to learn the custodian's KEL from the agent");
  assertEquals((yield* addMailbox(adminDeps(edge), member, agent.pre!)).state, "authorized");
  yield* until(
    () => agentHby.db.ends.get([member.pre!, Roles.mailbox, agent.pre!])?.allowed === true,
    "the agent to accept the edge member's mailbox authorization",
  );

  // Setup, in-process: the group's inception (the edge member's signature alone satisfies ["1","0"]) and the
  // coordinator event that elects the edge member as lead.
  const signing = [member.pre!, custodian.pre!];
  const groupArgs = { isith: ["1", "0"], nsith: "1", toad: 0 };
  const edgeGroup = edgeHby.makeGroupHab("group", member, signing, [custodian.pre!], undefined, groupArgs);
  const custodianGroup = agentHby.makeGroupHab("group", custodian, signing, [custodian.pre!], undefined, groupArgs);
  assertEquals(edgeGroup.serder.ked!.n, custodianGroup.serder.ked!.n, "one next-key commitment, the custodian's");
  const inception = parseBytes(messagize(edgeGroup.serder, { sigers: edgeGroup.sigers, gvrsn: Vrsn_2_0 }))[0];
  for (const hby of [edgeHby, agentHby]) {
    yield* dispatchEnvelope(envelopeFromFrame(inception, true), hby.rvy, hby.kevery);
  }
  const groupHab = edgeGroup.hab, group = groupHab.pre!;
  const state = groupHab.kever!;
  const coordinator = interact(group, state.said, state.sn + 1, [], { version: Vrsn_2_0 });
  const coordinatorWire = messagize(coordinator, { sigers: groupHab.sign(coordinator.raw, true), gvrsn: Vrsn_2_0 });
  yield* edge.reactor.processBytes(coordinatorWire, { local: true });
  yield* agentRt.reactor.processBytes(coordinatorWire, { local: true });
  for (const hby of [edgeHby, agentHby]) assertEquals(hby.db.getKever(group)?.sn, 1, "the coordinator is accepted");

  // The group authorizes the agent as mailbox: proposed to the custodian through the relay, then posted to the agent.
  yield* proposeGroupMailbox(edgeHby, edge.protocol, edge.postman, groupHab, agent.pre!);
  yield* until(
    () => edgeHby.db.ends.get([group, Roles.mailbox, agent.pre!])?.allowed === true,
    "the edge to accept the group's mailbox role",
  );
  assertEquals((yield* completeGroupMailbox(adminDeps(edge), groupHab, agent.pre!)).state, "authorized");
  yield* until(
    () => agentHby.db.ends.get([group, Roles.mailbox, agent.pre!])?.allowed === true,
    "the agent to accept the group's mailbox authorization",
  );
  yield* until(
    () => wrappersFrom(agentHby, member.pre!).includes("/multisig/rpy"),
    "the custodian to receive the group's mailbox proposal through the relay",
  );

  // The edge resolves the issuer's and the verifier's OOBIs by asking the agent.
  const thirdOobis = [issuer, verifier].map((third) => `${third.url}oobi/${third.hab.pre}/controller`);
  for (const url of thirdOobis) edge.oobiery.resolve(url);
  yield* until(
    () => thirdOobis.every((url) => edgeHby.db.roobi.get(url)?.state === "resolved"),
    "the edge to resolve the issuer's and the verifier's OOBIs through the agent",
  );
  for (const [index, third] of [issuer, verifier].entries()) {
    assertEquals(agentHby.db.roobi.get(thirdOobis[index])?.state, "resolved", `the agent fetched ${third.name}`);
    assertEquals(edgeHby.db.getKever(third.hab.pre!)?.said, third.hab.kever!.said);
    assert(
      requested.includes(`${agentUrl}oobi/${third.hab.pre}/controller`),
      `the edge read ${third.name}'s OOBI from the agent's endpoint`,
    );
  }
  // The third parties learn the group, its mailbox and the agent's location from the agent's OOBI endpoint.
  for (const third of [issuer, verifier]) {
    third.runtime.oobiery.resolve(`${agentUrl}oobi/${group}/mailbox/${agent.pre}`);
  }
  for (const third of [issuer, verifier]) {
    yield* until(
      () =>
        third.hby.db.getKever(group)?.sn === 1
        && third.hby.db.ends.get([group, Roles.mailbox, agent.pre!])?.allowed === true,
      `${third.name} to resolve the group's mailbox OOBI at the agent`,
    );
  }

  // === 2. Receive: the issuer grants to the group; the edge admits as the group through the agent ===
  const stub = { hby: issuer.hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
  const author = new RegistryAuthor(issuer.runtime.acdc!, stub);
  yield* author.incept("issued", issuer.hab.pre!);
  const registry = author.registry("issued", issuer.hab.pre!);
  const credential: SerderACDC = author.create(registry, { issuee: group, attribute: { name: "Ada" } });
  const issuance = issuer.runtime.operations!.issuance;
  const { grant } = yield* proposeIssuance(issuance, { credential, options: { recipient: group, message: "Issue" } });
  yield* until(
    () => !!agentRt.exc.retainedInput(grant, { pending: true }) || agentRt.exc.complete(grant),
    "the custodian on the agent to hold the Grant",
  );
  yield* until(
    () => !!edge.exc.retainedInput(grant, { pending: true }) || edge.exc.complete(grant),
    "the edge to poll the Grant from the group's mailbox at the agent",
  );
  // The mailbox-role risk: the agent keeps exactly one copy of a third party's message to the group for the edge.
  assertEquals(
    stored(agentRt, group).filter(([, body]) => body.said === grant).map(([topic]) => topic),
    [`${group}/credential`],
    "exactly one stored copy of the Grant waits for the edge",
  );
  assertEquals(
    stored(agentRt, member.pre).filter(([, body]) => body.said === grant),
    [],
    "the edge member's own mailbox holds no second copy of the Grant",
  );
  assertExists(edgeHby.db.tops.get([group, agent.pre!]), "the edge polled the group's mailbox at the agent");
  approveGroupIssuanceExchange(edge.operations!.issuance, grant, coordinator.said!);
  const edgeWaiting = yield* waitForIssuance(edge.operations!.issuance, grant, {
    timeoutMs: BUDGET_MS,
    until: (status) => status.state !== "active" || status.needs === "admit",
  });
  assertEquals(
    [edgeWaiting.status.state, (edgeWaiting.status as { needs?: string }).needs],
    ["active", "admit"],
    JSON.stringify(edgeWaiting.status),
  );
  assertEquals((yield* waitForIssuance(issuance, grant, { timeoutMs: BUDGET_MS })).status.state, "done");
  const { said: admit } = yield* proposeGroupAdmit(edge.operations!.groupIpex, {
    hab: groupHab,
    grant,
    message: "Group admit",
  });
  assertEquals(
    (yield* waitForGroupIpex(edge.operations!.groupIpex, admit, { timeoutMs: BUDGET_MS })).status,
    { state: "done", phase: "accepted" },
  );
  yield* until(() => issuer.runtime.exc.complete(admit), "the issuer to accept the group's Admit");
  assertEquals((issuer.hby.db.exns.get([admit]) as SerderKERI).pre, group, "the issuer holds the Admit as the group's");
  assert(issuer.runtime.exc.verifyAccepted(admit, "/ipex/admit"), "the Admit verifies against the group's KEL");
  assert(
    issuer.arrivals.some((arrival) => arrival.said === admit && arrival.sender === group),
    "the agent re-sent the group's own signed Admit to the issuer",
  );

  // === 3. The co-member is delivered to ===
  yield* until(
    () =>
      ["/multisig/rpy", "/multisig/ipex-proof", "/multisig/exn"].every((route) =>
        wrappersFrom(agentHby, member.pre!).includes(route)
      ),
    "the custodian to hold the edge member's DH reply, DH proof and Admit wrappers",
  );
  // The weight-0 member's runtime follows the group's issuance proof on its own; its Admit approval is explicit.
  yield* until(() => agentRt.exc.complete(grant), "the custodian to accept the Grant");
  assertEquals(
    groupIpexProposals(agentRt.operations!.groupIpex, custodianGroup.hab).map((p) => [p.said, p.proposer]),
    [[admit, member.pre]],
    "the custodian lists the edge member's Admit proposal",
  );
  assert(!agentRt.exc.complete(admit), "holding the proposal is not accepting it");
  yield* approveGroupIpex(agentRt.operations!.groupIpex, admit);
  assertEquals(
    (yield* waitForGroupIpex(agentRt.operations!.groupIpex, admit, { timeoutMs: BUDGET_MS })).status,
    { state: "done", phase: "accepted" },
  );
  assert(
    loadNests(agentHby.db, grant).some((frame) => frame.body.said === credential.said),
    "the custodian holds the credential",
  );
  const regk = registry.regk!;
  assertEquals(
    agentRt.acdc!.store.headEvent(regk)?.said,
    issuer.runtime.acdc!.store.headEvent(regk)?.said,
    "the custodian holds the issuer's TEL head",
  );
  yield* until(() => !!custodianGroup.hab.mgr.getRegistryRoot(group, regk), "the custodian to hold the registry root");
  assertEquals(
    custodianGroup.hab.mgr.getRegistryRoot(group, regk)?.qb64,
    groupHab.mgr.getRegistryRoot(group, regk)?.qb64,
  );

  // === 4. Present: the edge presents the credential as the group to the verifier ===
  // The credential's transferred view: the admitted Grant's own nodes, with presenter authorization.
  const transferred = concatBytes(
    ...(yield* call(() =>
      Promise.all(loadNests(edgeHby.db, grant).map((node) => collectPayload(nestedPayload(node, Vrsn_2_0))))
    )),
  );
  const { said: presented } = yield* proposeGroupPresentation(
    edge.operations!.presentation.deps,
    edge.operations!.groupIpex,
    {
      hab: groupHab,
      selection: { transferred, presenterAuthorized: true },
      options: { recipient: verifier.hab.pre!, message: "Group presentation" },
    },
  );
  assertEquals(
    (yield* waitForGroupIpex(edge.operations!.groupIpex, presented, { timeoutMs: BUDGET_MS })).status,
    { state: "done", phase: "accepted" },
  );
  // The transferred view carries the issuer's original registry proof, so the verifier needs no DH or Unblind
  // query here: it accepts the Grant on arrival and reads the credential's registry state from it.
  yield* until(() => verifier.runtime.exc.complete(presented), "the verifier to accept the group's Grant");
  assert(
    verifier.arrivals.some((arrival) => arrival.said === presented && arrival.sender === group),
    "the agent re-sent the group's own signed Grant to the verifier",
  );
  assertEquals(
    stored(agentRt, group).filter(([, body]) => body.pre === verifier.hab.pre),
    [],
    "the verifier sent the group nothing to answer",
  );
  assertEquals(
    verifier.runtime.acdc!.store.headEvent(regk)?.said,
    issuer.runtime.acdc!.store.headEvent(regk)?.said,
    "the verifier holds the credential's registry state",
  );

  // === 5. The remote parties see the group as author ===
  assertEquals((verifier.hby.db.exns.get([presented]) as SerderKERI).pre, group);
  assert(verifier.runtime.exc.verifyAccepted(presented, "/ipex/grant"), "the Grant verifies against the group's KEL");
  for (const third of [issuer, verifier]) {
    const carried = third.arrivals.filter((arrival) => arrival.sender === agent.pre);
    assertEquals(
      carried.filter((arrival) => arrival.route !== "/fwd"),
      [],
      `${third.name} saw the agent only as a /fwd carrier`,
    );
    assertEquals(
      third.arrivals.filter((arrival) => arrival.sender === member.pre || arrival.sender === custodian.pre),
      [],
      `${third.name} received nothing authored by a group member alone`,
    );
    const authors: (string | null)[] = [issuer.hab.pre, verifier.hab.pre, group];
    assertEquals(
      [...third.hby.db.exns.getTopItemIter()].map(([, body]) => body.pre).filter((pre) => !authors.includes(pre)),
      [],
      `${third.name} stored no exchange authored by anyone but the issuer, the verifier and the group`,
    );
  }

  // === 6. Every request the edge made went to the agent's origin ===
  assert(requested.length > 0);
  const agentOrigin = new URL(agentUrl).origin;
  assertEquals(requested.filter((url) => new URL(url).origin !== agentOrigin), [], "the edge contacted only its agent");

  return {
    wallMs: Math.round(performance.now() - started),
    agentGroupCursor: agentHby.db.tops.get([group, agent.pre!]) ?? null,
  };
}

Deno.test("an edge presents its group's credential through its agent to a verifier", async () => {
  const observed = await run(edgeThroughAgent);
  console.log(`relay group e2e wall time: ${observed.wallMs} ms`);
});

/**
 * The `/fwd` intake ingests a third party's message for the custodian and stores one copy for the edge; the agent's
 * own MailboxPoller never polls the group's mailbox at the agent itself (`MailboxPoller.deliveredOnArrival`), so no
 * stored message is taken into the agent's intake a second time. The edge still polls its one stored copy, as the
 * main test asserts.
 */
Deno.test("a third party's message to a group the agent co-hosts is processed there exactly once", async () => {
  const observed = await run(edgeThroughAgent);
  assertEquals(observed.agentGroupCursor, null, "the agent did not poll the group's mailbox at itself");
});
