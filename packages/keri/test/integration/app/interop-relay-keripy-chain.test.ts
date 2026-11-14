/**
 * The whole IPEX conversation, and an Apply ended by a Spurn, between a keri-ts edge in relay mode and a pinned
 * KERIpy v2 peer on the `candidate` profile (run in Docker).
 *
 * The composition is the one in interop-relay-keripy.test.ts, which covers a single Grant and Admit: the edge is a
 * runtime with `relay` set behind a real `runHostKernel` agent (`enableRelay`, KRAM on, the edge's `mailbox` end
 * role); the KERIpy peer (packages/keri/test/fixtures/ipex-mailbox-peer.py, `relay` mode) resolves the edge's OOBI
 * with its own Oobiery and sends with its own StreamPoster, picking the edge's published `mailbox`. The fixture's
 * `/_relay` and `/_chain` controls only choose an action and read state; they never post protocol bytes into us.
 *
 * Roles. The chain is the verifier flow: the KERIpy peer, as verifier, applies for a credential the keri-ts party
 * holds; keri-ts offers it, KERIpy agrees, keri-ts grants, KERIpy admits. The Spurn checks reverse the roles: keri-ts
 * applies and KERIpy spurns, so across this file keri-ts sends an Apply, an Offer and a Grant and receives an Offer's
 * Agree, a Grant's Admit and an Apply's Spurn (its own Admit is covered by the existing file).
 *
 * The helpers up to `groupReceives` are copied from interop-relay-keripy.test.ts so that file stays as it is.
 */
import { runHostKernel } from "@keri-ts/hosting";
import { collectPayload, concatBytes, MtrDex, nestedPayload, parseBytes, type Siger, Signer, Vrsn_2_0 } from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn, suspend } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { createHabery } from "keri-ts/db/lmdb";
import {
  AcdcV2Regery as Regery,
  addMailbox,
  type AgentRuntime,
  agreeFor,
  completeGroupMailbox,
  createAgentRuntime,
  exchangeAnswer,
  FetchHttpClient,
  type Hab,
  type Habery,
  type HttpClient,
  incept,
  interact,
  type MailboxAdminDeps,
  messagize,
  pendingApplies,
  present,
  type PresentationDeps,
  proposeGroupAdmit,
  proposeGroupMailbox,
  proposeGroupNegotiation,
  proposeGroupPresentation,
  receiveIssuance,
  type Relay,
  Roles,
  runAgentRuntime,
  settleRuntimeIngress,
  systemClock,
  waitForGroupIpex,
  waitForPresentation,
} from "keri-ts/runtime";
import type { RegBaser } from "../../../src/acdc/regbasing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import { loadNests } from "../../../src/db/exchange/exchange-nests.ts";
import { openLmdbRegistry } from "../../../src/db/lmdb-stores.ts";
import {
  randomPort,
  resolveKeripyRuntime,
  spawnChild,
  withStartedChild,
  workspaceRoot,
} from "./interop-test-helpers.ts";

const PEER = fromFileUrl(new URL("../../fixtures/ipex-mailbox-peer.py", import.meta.url));
const KRAM = { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } } as const;
/** Bound on every single wait; a scenario is bounded by the sum of its waits. */
const BUDGET_MS = 20_000;

/** Wait for `cond`, bounded; the error names what was awaited. */
function* until(cond: () => boolean, what: string, ms = BUDGET_MS): Operation<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    yield* sleep(25);
  }
}

/** Wait for an asynchronous read to return a value, bounded. */
function* observe<T>(what: string, read: () => Promise<T | undefined>, ms = BUDGET_MS): Operation<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = yield* call(read);
    if (value !== undefined) return value;
    if (Date.now() > end) throw new Error(`timed out after ${ms} ms waiting for ${what}`);
    yield* sleep(50);
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

/** A Habery and a v2 registry store whose lifetime is the current scope. */
interface Stores {
  hby: Habery;
  baser: RegBaser;
}

function* stores(name: string): Operation<Stores> {
  const hby = yield* createHabery({
    name: `${name}-${crypto.randomUUID()}`,
    bran: `${name}RelayKeriPyPasscodeABCDE`.slice(0, 21),
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

/** What the KERIpy peer reports about one exchange it holds. */
interface PeerExchange {
  accepted: boolean;
  escrowed: boolean;
  route: string | null;
  sender: string | null;
  prior: string | null;
  /** SAID of the stored answer to this exchange (`erpy`), when there is one. */
  response: string | null;
  nests: { said: string; issuer: string; issuee: string | null; registry: string | null }[];
}

/** The KERIpy peer's observations; it never reports a row the test supplied. */
interface PeerState {
  oobis: Record<string, string | null>;
  known: Record<string, number | null>;
  ends: Record<string, Record<string, string[]>>;
  exchanges: Record<string, PeerExchange>;
  registries: Record<string, string | null>;
  received: string[];
}

/** The KERIpy peer's state query. */
interface StateQuery {
  urls?: string[];
  pres?: string[];
  saids?: string[];
  registries?: string[];
}

/** How the KERIpy peer's credential is authenticated: a private v2 registry state, or the issuer's signature. */
type Credential = "private" | "signed";

/** The credential the KERIpy peer issued; `registry` is null and `events` empty for a signed credential. */
interface PeerIssued {
  credential: string;
  schema: string;
  registry: string | null;
  events: string[];
}

/** A negotiation message the KERIpy peer sent, and whether its own Exchanger accepted it. */
interface PeerSent {
  said: string;
  accepted: boolean;
}

/** The running KERIpy peer: its identifier, endpoint, OOBI and its action controls. */
class KeriPyRelayPeer {
  constructor(readonly pre: string, readonly url: string, readonly oobi: string) {}

  private async command<T>(path: string, action: string, args: object): Promise<T> {
    const response = await fetch(new URL(path, this.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...args }),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    assertEquals(response.status, 200, `${action}: ${text}`);
    return JSON.parse(text) as T;
  }

  resolve(urls: string[]): Promise<unknown> {
    return this.command("_relay", "resolve", { urls });
  }
  issue(recipient: string, credential: Credential): Promise<PeerIssued> {
    return this.command("_relay", "issue", { recipient, registry: credential !== "signed" });
  }
  grant(): Promise<string> {
    return this.command("_relay", "grant", {});
  }
  admit(grant: string): Promise<string> {
    return this.command("_relay", "admit", { grant });
  }
  state(query: StateQuery): Promise<PeerState> {
    return this.command("_relay", "state", query);
  }
  /** Open with an Apply for a credential of `schema`, whose plan requires only the root node and schema. */
  apply(recipient: string, schema: string): Promise<PeerSent> {
    return this.command("_chain", "apply", { recipient, schema });
  }
  agree(offer: string): Promise<PeerSent> {
    return this.command("_chain", "agree", { offer });
  }
  spurn(prior: string): Promise<PeerSent> {
    return this.command("_chain", "spurn", { prior });
  }
  /** Answer `apply` with an Offer, and send it even when the KERIpy peer itself refuses it. */
  offer(apply: string): Promise<PeerSent> {
    return this.command("_chain", "offer", { apply });
  }
}

/** Run `body` against a fresh KERIpy candidate peer, verified against its pinned commit. */
async function withKeriPyPeer(body: (peer: KeriPyRelayPeer) => Promise<void>): Promise<void> {
  const root = Deno.env.get("KERIPY_CANDIDATE_ROOT")?.trim(), python = Deno.env.get("KERIPY_CANDIDATE_PYTHON")?.trim();
  if (!root || !python) throw new Error("The candidate KERIpy peer requires KERIPY_CANDIDATE_ROOT and _PYTHON.");
  const home = await Deno.makeTempDir({ prefix: "relay-keripy-chain-" });
  try {
    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      HOME: home,
      KERIPY_INTEROP_PROFILE: "candidate",
      KERIPY_INTEROP_ROOT: root,
      KERIPY_INTEROP_PYTHON: python,
    };
    // The profile owns its exact pin; the probe refuses a checkout at any other commit.
    delete env.KERIPY_INTEROP_EXPECTED_COMMIT;
    const keripy = await resolveKeripyRuntime(home, env);
    const port = randomPort();
    const child = spawnChild(keripy.pythonCommand, [PEER, "relay", home, String(port)], env, workspaceRoot());
    const output = Promise.all([new Response(child.liveStdout).text(), new Response(child.liveStderr).text()]);
    try {
      await withStartedChild(child, port, async () => {
        const ready = JSON.parse(await Deno.readTextFile(`${home}/ready.json`)) as {
          pre: string;
          url: string;
          oobi: string;
        };
        await body(new KeriPyRelayPeer(ready.pre, ready.url, ready.oobi));
      });
      await output;
    } catch (cause) {
      throw new Error(`KERIpy candidate relay peer output:\n${(await output).join("\n")}`, { cause });
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

/** The agent: a real host with relaying, KRAM and full workers. */
interface Agent {
  url: string;
  hab: Hab;
  hby: Habery;
  runtime: AgentRuntime;
}

/** Start the agent host on a fresh store with a transferable identifier; its lifetime is the current scope. */
function* startAgent(): Operation<Agent> {
  const port = reservePort();
  const url = `http://127.0.0.1:${port}/`;
  const { hby } = yield* stores("agent");
  const hab = hby.makeHab("agent", undefined, { transferable: true });
  yield* preload(hby, [hab.makeLocScheme(url, hab.pre!, "http"), hab.makeEndRole(hab.pre!, Roles.controller, true)]);
  const listening = Promise.withResolvers<void>();
  let hosted: AgentRuntime | undefined;
  const host = yield* spawn(() =>
    runHostKernel(hby, {
      enableMailboxStore: true,
      enableRelay: true,
      kram: KRAM,
      serviceHab: hab,
      http: { port, hostname: "127.0.0.1", onListen: () => listening.resolve() },
      protocolPolicy: {},
      companionHosts: [function*(runtime) {
        hosted = runtime;
        yield* suspend();
      }],
    })
  );
  yield* ensure(() => host.halt());
  yield* call(() => listening.promise);
  yield* until(() => !!hosted, "the agent runtime");
  return { url, hab, hby, runtime: hosted! };
}

/** The edge: a relay runtime over a recording client, with its registry store. */
interface Edge {
  hby: Habery;
  runtime: AgentRuntime;
  /** Every URL the edge's HTTP client was asked to reach. */
  requested: string[];
}

/** Compose the edge's runtime with `relay` set to the agent; `member` is the habitat its host runs for. */
function* startEdge(agent: Agent, hby: Habery, baser: RegBaser, member: Hab): Operation<Edge> {
  const requested: string[] = [];
  const relay: Relay = { aid: agent.hab.pre!, oobi: `${agent.url}oobi/${agent.hab.pre}/controller` };
  const runtime = yield* createAgentRuntime(hby, recording(new FetchHttpClient(), requested), systemClock, {
    relay,
    acdc: new Regery(hby, baser),
    kram: KRAM,
  });
  yield* ensure(() => runtime.close());
  const host = yield* spawn(() => runAgentRuntime(runtime, { hab: member }));
  yield* ensure(() => host.halt());
  yield* until(() => hby.db.roobi.get(relay.oobi)?.state === "resolved", "the edge to resolve the agent's OOBI");
  return { hby, runtime, requested };
}

/** Authorize the agent as `hab`'s mailbox from the edge, and wait for the agent to accept it. */
function* authorizeMailbox(agent: Agent, edge: Edge, hab: Hab): Operation<void> {
  assertEquals((yield* addMailbox(adminDeps(edge.runtime), hab, agent.hab.pre!)).state, "authorized");
  yield* until(
    () => agent.hby.db.ends.get([hab.pre!, Roles.mailbox, agent.hab.pre!])?.allowed === true,
    `the agent to accept ${hab.pre}'s mailbox authorization`,
  );
}

/**
 * Introduce the two sides through their OOBIs: the edge learns the KERIpy peer by asking the agent; the KERIpy peer
 * resolves `pre`'s mailbox OOBI at the agent with its own Oobiery and must end holding its KEL at `kever.sn`.
 */
function* introduce(py: KeriPyRelayPeer, agent: Agent, edge: Edge, hab: Hab): Operation<void> {
  edge.runtime.oobiery.resolve(py.oobi);
  yield* until(() => edge.hby.db.roobi.get(py.oobi)?.state === "resolved", "the edge to resolve the KERIpy OOBI");
  const oobi = `${agent.url}oobi/${hab.pre}/mailbox/${agent.hab.pre}`;
  yield* call(() => py.resolve([oobi]));
  const introduced = yield* observe(`the KERIpy peer to resolve ${hab.pre}'s mailbox OOBI at the agent`, async () => {
    const state = await py.state({ urls: [oobi], pres: [hab.pre!] });
    return state.oobis[oobi] === "resolved" && state.ends[hab.pre!]?.mailbox?.includes(agent.hab.pre!)
      ? state
      : undefined;
  });
  assertEquals(introduced.known[hab.pre!], hab.kever!.sn, "the KERIpy peer holds the KEL");
}

/** Our side as one party: the agent, the edge, and the identifier that talks (the single-sig edge or the group). */
interface Party {
  agent: Agent;
  edge: Edge;
  /** The identifier that sends and receives the IPEX messages. */
  hab: Hab;
  /** The identifier whose endpoint the edge runs as (the edge itself, or the group's edge member). */
  member: Hab;
}

/** Every request the edge made went to the agent's origin. */
function assertOnlyAgent(party: Party): void {
  assert(party.edge.requested.length > 0);
  const origin = new URL(party.agent.url).origin;
  assertEquals(
    party.edge.requested.filter((url) => new URL(url).origin !== origin),
    [],
    "the edge contacted only its agent",
  );
}

/** Start the agent and the single-sig edge, onboard it through the agent, and introduce it to the KERIpy peer. */
function* singleSigRelay(py: KeriPyRelayPeer, beforeIntroduction: (edge: Hab) => Operation<void>): Operation<Party> {
  const agent = yield* startAgent();
  const { hby, baser } = yield* stores("edge");
  const hab = hby.makeHab("edge");
  const edge = yield* startEdge(agent, hby, baser, hab);
  yield* authorizeMailbox(agent, edge, hab);
  yield* beforeIntroduction(hab);
  yield* introduce(py, agent, edge, hab);
  return { agent, edge, hab, member: hab };
}

/**
 * Start the agent and the edge as a group member, and onboard both the member and the group through the agent.
 *
 * The product's shape, as in packages/hosting/test/relay-group-e2e.test.ts: the edge member is a non-transferable,
 * single-key identifier with an externally held signer (weight 1); the custodian on the agent is the group's sole
 * rotation member (weight 0). The group is `[member, custodian]`, `isith ["1","0"]`, `nsith "1"`, toad 0. The group's
 * inception and the coordinator event that elects the edge member as lead are dispatched into both stores.
 */
function* groupRelay(py: KeriPyRelayPeer, beforeIntroduction: (group: Hab) => Operation<void>): Operation<Party> {
  const agent = yield* startAgent();
  const custodian = agent.hby.makeHab("custodian");
  const { hby, baser } = yield* stores("edge");
  const signer = Signer.random({ code: MtrDex.Ed25519_Seed, transferable: false });
  const icp = incept([signer.verfer.qb64], { version: Vrsn_2_0, code: signer.verfer.code, nsith: "0", toad: 0 });
  const member = hby.makeSignedHab("edge", undefined, {
    serder: icp,
    sigers: [signer.sign(icp.raw, { index: 0 }) as Siger],
  });
  hby.mgr.hold([signer]);
  const edge = yield* startEdge(agent, hby, baser, member);
  edge.runtime.oobiery.resolve(`${agent.url}oobi/${custodian.pre}/controller`);
  yield* until(() => !!hby.db.getKever(custodian.pre!), "the edge to learn the custodian's KEL from the agent");
  yield* authorizeMailbox(agent, edge, member);

  const signing = [member.pre!, custodian.pre!];
  const groupArgs = { isith: ["1", "0"], nsith: "1", toad: 0 };
  const edgeGroup = hby.makeGroupHab("group", member, signing, [custodian.pre!], undefined, groupArgs);
  agent.hby.makeGroupHab("group", custodian, signing, [custodian.pre!], undefined, groupArgs);
  const inception = parseBytes(messagize(edgeGroup.serder, { sigers: edgeGroup.sigers, gvrsn: Vrsn_2_0 }))[0];
  for (const store of [hby, agent.hby]) {
    yield* dispatchEnvelope(envelopeFromFrame(inception, true), store.rvy, store.kevery);
  }
  const group = edgeGroup.hab, state = group.kever!;
  const coordinator = interact(group.pre!, state.said, state.sn + 1, [], { version: Vrsn_2_0 });
  const coordinatorWire = messagize(coordinator, { sigers: group.sign(coordinator.raw, true), gvrsn: Vrsn_2_0 });
  yield* edge.runtime.reactor.processBytes(coordinatorWire, { local: true });
  yield* agent.runtime.reactor.processBytes(coordinatorWire, { local: true });
  for (const store of [hby, agent.hby]) assertEquals(store.db.getKever(group.pre!)?.sn, 1, "the coordinator holds");

  yield* proposeGroupMailbox(hby, edge.runtime.protocol, edge.runtime.postman, group, agent.hab.pre!);
  yield* until(
    () => hby.db.ends.get([group.pre!, Roles.mailbox, agent.hab.pre!])?.allowed === true,
    "the edge to accept the group's mailbox role",
  );
  assertEquals((yield* completeGroupMailbox(adminDeps(edge.runtime), group, agent.hab.pre!)).state, "authorized");
  yield* until(
    () => agent.hby.db.ends.get([group.pre!, Roles.mailbox, agent.hab.pre!])?.allowed === true,
    "the agent to accept the group's mailbox authorization",
  );

  yield* beforeIntroduction(group);
  yield* introduce(py, agent, edge, group);
  return { agent, edge, hab: group, member };
}

/** The credential the keri-ts party holds and can disclose, received from the KERIpy peer. */
interface Held {
  party: Party;
  issued: PeerIssued;
  /** The admitted Grant's nodes, exactly as transferred, for a presentation of the same view. */
  transferred: Uint8Array;
}

/** The admitted Grant's own nodes, for presenting the credential it carried. */
function* transferredView(party: Party, grant: string): Operation<Uint8Array> {
  return concatBytes(
    ...(yield* call(() =>
      Promise.all(loadNests(party.edge.hby.db, grant).map((node) => collectPayload(nestedPayload(node, Vrsn_2_0))))
    )),
  );
}

/** The single-sig edge receives a private v2 credential from the KERIpy peer (Grant, Admit), as in the existing file. */
function* singleSigHolds(py: KeriPyRelayPeer): Operation<Held> {
  let issued: PeerIssued | undefined;
  const party = yield* singleSigRelay(py, function*(edge) {
    issued = yield* call(() => py.issue(edge.pre!, "private"));
  });
  const grant = yield* call(() => py.grant());
  const { runtime } = party.edge;
  yield* until(
    () => !!runtime.exc.retainedInput(grant, { pending: true }) || runtime.exc.complete(grant),
    "the edge to poll the KERIpy Grant from its mailbox at the agent",
  );
  const outcome = yield* receiveIssuance(runtime.operations!.issuance, { grant, timeoutMs: BUDGET_MS });
  assertEquals(outcome.outcome, "admitted", JSON.stringify(outcome));
  return { party, issued: issued!, transferred: yield* transferredView(party, grant) };
}

/** The group receives a private v2 credential from the KERIpy peer (Grant, group Admit), as in the existing file. */
function* groupHolds(py: KeriPyRelayPeer): Operation<Held> {
  let issued: PeerIssued | undefined;
  const party = yield* groupRelay(py, function*(group) {
    issued = yield* call(() => py.issue(group.pre!, "private"));
  });
  const { agent, edge, hab: group } = party;
  const grant = yield* call(() => py.grant());
  yield* until(() => edge.runtime.exc.complete(grant), "the edge to poll and accept the KERIpy Grant to the group");
  yield* until(() => agent.runtime.exc.complete(grant), "the custodian on the agent to accept the Grant");
  const { said: admit } = yield* proposeGroupAdmit(edge.runtime.operations!.groupIpex, {
    hab: group,
    grant,
    message: "Relay group admit",
  });
  assertEquals(
    (yield* waitForGroupIpex(edge.runtime.operations!.groupIpex, admit, { timeoutMs: BUDGET_MS })).status,
    { state: "done", phase: "accepted" },
  );
  yield* observe("the KERIpy peer to accept the group's Admit", async () => {
    const state = await py.state({ saids: [admit] });
    return state.exchanges[admit]?.accepted ? state : undefined;
  });
  return { party, issued: issued!, transferred: yield* transferredView(party, grant) };
}

// --- what is new in this file ---

/** The presentation collaborators of the edge's runtime, for the pure IPEX reads. */
function presentationDeps(party: Party): PresentationDeps {
  return party.edge.runtime.operations!.presentation.deps;
}

/** Wait for the KERIpy peer to accept `said` from `sender` as the answer to `prior`, and return what it holds. */
function* keriPyAccepts(
  py: KeriPyRelayPeer,
  said: string,
  sender: string,
  prior: string | null,
  what: string,
): Operation<PeerExchange> {
  const state = yield* observe(`the KERIpy peer to accept the ${what}`, async () => {
    const state = await py.state({ saids: prior ? [prior, said] : [said] });
    return state.exchanges[said]?.accepted ? state : undefined;
  });
  const exchange = state.exchanges[said];
  assertEquals(exchange.route, `/ipex/${what.toLowerCase()}`);
  assertEquals(exchange.sender, sender, `the ${what} is ours`);
  if (prior) {
    assertEquals(exchange.prior, prior, `the ${what} answers its prior`);
    assertEquals(state.exchanges[prior].response, said, `the KERIpy peer records the ${what} as the prior's answer`);
  } else {
    assertEquals(exchange.prior, null, `the ${what} opens the exchange`);
  }
  return exchange;
}

/** Wait for the edge to accept the KERIpy peer's `said` as the answer to the exchange `prior` that we sent. */
function* edgeAcceptsAnswer(party: Party, py: KeriPyRelayPeer, prior: string, said: string, route: string) {
  const deps = presentationDeps(party);
  yield* until(
    () => deps.exc.complete(said) && exchangeAnswer(deps, prior)?.answer === said,
    `the edge to accept the KERIpy ${route} as the answer to ${prior}`,
  );
  assertEquals(exchangeAnswer(deps, prior), { answer: said, route, sender: py.pre, accepted: true });
  assertEquals(party.edge.hby.db.exns.get([said])?.sad?.p, prior);
}

/**
 * The whole chain, the verifier flow: the KERIpy peer applies for the credential the keri-ts party holds; keri-ts
 * offers it, KERIpy agrees, keri-ts grants (the Grant answers the Agree), KERIpy admits. Each message crosses the
 * relay (the edge's through its agent; KERIpy's by StreamPoster to the party's published mailbox), and each side
 * accepts it as the answer to the one before in the same exchange. `offer` and `grant` are how the party sends:
 * `present` for the single-sig edge, the group proposals for the group.
 */
function* wholeChain(
  py: KeriPyRelayPeer,
  held: Held,
  offer: (apply: string) => Operation<string>,
  grant: (agree: string) => Operation<string>,
): Operation<void> {
  const { party, issued } = held;
  const { hab } = party, deps = presentationDeps(party);

  // 1. Apply, KERIpy -> keri-ts: an opener; the party lists it as pending.
  const { said: apply } = yield* call(() => py.apply(hab.pre!, issued.schema));
  yield* until(() => deps.exc.complete(apply), "the edge to accept the KERIpy Apply");
  const listed = pendingApplies(deps, { hab }).find((pending) => pending.apply === apply);
  assertExists(listed, "the Apply is pending for the party");
  assertEquals([listed.applicant, listed.state, listed.plan], [py.pre, "pending", [[issued.schema, "/", []]]]);

  // 2. Offer, keri-ts -> KERIpy, answering the Apply.
  const offered = yield* offer(apply);
  yield* keriPyAccepts(py, offered, hab.pre!, apply, "Offer");
  assertEquals(exchangeAnswer(deps, apply)?.answer, offered, "the party reads its Offer as the Apply's answer");
  assertEquals(pendingApplies(deps, { hab }).some((pending) => pending.apply === apply), false, "no longer pending");

  // 3. Agree, KERIpy -> keri-ts, answering the Offer.
  const { said: agree } = yield* call(() => py.agree(offered));
  yield* edgeAcceptsAnswer(party, py, offered, agree, "/ipex/agree");
  assertEquals(agreeFor(deps, offered)?.answer, agree);

  // 4. Grant, keri-ts -> KERIpy, answering the Agree, with the credential.
  const granted = yield* grant(agree);
  const accepted = yield* keriPyAccepts(py, granted, hab.pre!, agree, "Grant");
  assertEquals(accepted.nests.map((nest) => nest.said), [issued.credential], "the KERIpy peer holds the credential");

  // 5. Admit, KERIpy -> keri-ts, answering the Grant.
  const admit = yield* call(() => py.admit(granted));
  yield* edgeAcceptsAnswer(party, py, granted, admit, "/ipex/admit");
  assertOnlyAgent(party);
}

/** How long a refused message gets after the edge has polled it, so an acceptance would have been committed. */
const SETTLE_MS = 500;

/** How many messages the agent holds in the party's `credential` mailbox topic. */
function storedCount(party: Party): number {
  const mailboxer = party.agent.runtime.mailboxer;
  assertExists(mailboxer, "the agent hosts a mailbox store");
  return mailboxer.getTopicMsgs(`${party.hab.pre}/credential`).length;
}

/**
 * Wait until the agent has stored the message at ordinal `index` of the party's `credential` mailbox topic and the
 * edge has polled and processed it: the edge's cursor advances past a message only after delivering it to intake.
 * The stored copy is the CESR text-domain child, so it is found by ordinal, not by SAID.
 */
function* edgePolled(party: Party, index: number, what: string): Operation<void> {
  const { agent, edge, hab } = party;
  yield* until(() => storedCount(party) > index, `the agent to store the ${what} in the party's mailbox`);
  yield* until(() => {
    const topics = edge.hby.db.tops.get([hab.pre!, agent.hab.pre!])?.topics ?? {};
    return (topics["/credential"] ?? -1) >= index;
  }, `the edge to poll the ${what} from the party's mailbox`);
  yield* sleep(SETTLE_MS);
}

/**
 * An Apply answered with a Spurn ends the exchange: keri-ts applies, the KERIpy peer spurns the Apply, and both read
 * the Spurn as the Apply's answer. The KERIpy peer then answers the same Apply with an Offer anyway: its own
 * Exchanger refuses it, and so does the edge after polling it. `apply` is how the party sends its Apply.
 */
function* spurnedApply(
  py: KeriPyRelayPeer,
  party: Party,
  schema: string,
  apply: (schema: string) => Operation<string>,
): Operation<void> {
  const { hab } = party, deps = presentationDeps(party);
  const applied = yield* apply(schema);
  yield* keriPyAccepts(py, applied, hab.pre!, null, "Apply");

  const { said: spurn } = yield* call(() => py.spurn(applied));
  yield* edgeAcceptsAnswer(party, py, applied, spurn, "/ipex/spurn");
  const state = yield* call(() => py.state({ saids: [applied, spurn] }));
  assertEquals(state.exchanges[applied].response, spurn, "the KERIpy peer reads the Spurn as the Apply's answer");
  assertEquals(state.exchanges[spurn].prior, applied);

  // A later Offer in the spurned exchange: refused on both sides.
  const index = storedCount(party);
  const late = yield* call(() => py.offer(applied));
  assertEquals(late.accepted, false, "the KERIpy peer refuses an Offer to an Apply already answered");
  yield* edgePolled(party, index, "late Offer");
  assertEquals(party.edge.hby.db.exns.get([late.said]), null, "the edge did not accept the late Offer");
  assertEquals(deps.exc.retainedInput(late.said, { pending: true }), null, "nor holds it pending");
  assertEquals(exchangeAnswer(deps, applied)?.answer, spurn, "the Spurn stays the Apply's answer");
  const after = yield* call(() => py.state({ saids: [applied, late.said] }));
  assertEquals(after.exchanges[late.said].accepted, false);
  assertEquals(after.exchanges[applied].response, spurn);
  assertOnlyAgent(party);
}

Deno.test("relay single-sig and KERIpy candidate complete the whole IPEX chain", async () => {
  await withKeriPyPeer((py) =>
    run(function*() {
      const held = yield* singleSigHolds(py);
      const { party, transferred } = held;
      const presentation = party.edge.runtime.operations!.presentation;
      const selection = { transferred, presenterAuthorized: true };
      yield* wholeChain(py, held, function*(apply) {
        const options = { priorSaid: apply, recipient: py.pre, message: "Relay offer" };
        return (yield* present(presentation, { verb: "offer", hab: party.hab, selection, options })).said;
      }, function*(agree) {
        const options = { priorSaid: agree, recipient: py.pre, message: "Relay grant" };
        const { said } = yield* present(presentation, { verb: "grant", hab: party.hab, selection, options });
        const delivered = yield* waitForPresentation(presentation, said, { timeoutMs: BUDGET_MS });
        assertEquals(delivered.status.state, "done", JSON.stringify(delivered.status));
        return said;
      });
    })
  );
});

Deno.test("relay group and KERIpy candidate complete the whole IPEX chain", async () => {
  await withKeriPyPeer((py) =>
    run(function*() {
      const held = yield* groupHolds(py);
      const { party, transferred } = held;
      const { groupIpex, presentation } = party.edge.runtime.operations!;
      const selection = { transferred, presenterAuthorized: true };
      // The edge member's weight satisfies the group's threshold: the weight-0 custodian approves nothing.
      const accepted = function*(said: string) {
        assertEquals(
          (yield* waitForGroupIpex(groupIpex, said, { timeoutMs: BUDGET_MS })).status,
          { state: "done", phase: "accepted" },
        );
        return said;
      };
      yield* wholeChain(py, held, function*(apply) {
        const options = { priorSaid: apply, recipient: py.pre, message: "Relay group offer" };
        const { said } = yield* proposeGroupNegotiation(presentation.deps, groupIpex, {
          verb: "offer",
          hab: party.hab,
          selection,
          options,
        });
        return yield* accepted(said);
      }, function*(agree) {
        const options = { priorSaid: agree, recipient: py.pre, message: "Relay group grant" };
        const { said } = yield* proposeGroupPresentation(presentation.deps, groupIpex, {
          hab: party.hab,
          selection,
          options,
        });
        return yield* accepted(said);
      });
    })
  );
});

Deno.test("an Apply answered with a Spurn ends the exchange", async () => {
  await withKeriPyPeer((py) =>
    run(function*() {
      let schema = "";
      const party = yield* singleSigRelay(py, function*(edge) {
        // A signed credential gives the Apply a real schema; nothing is disclosed before the Spurn.
        schema = (yield* call(() => py.issue(edge.pre!, "signed"))).schema;
      });
      const presentation = party.edge.runtime.operations!.presentation;
      yield* spurnedApply(py, party, schema, function*(schema) {
        const options = { recipient: py.pre, message: "Relay apply", plan: [[schema, "/", []]] as const };
        const { said } = yield* present(presentation, { verb: "apply", hab: party.hab, options });
        return said;
      });
    })
  );
});

Deno.test("a group's Apply answered with a Spurn ends the exchange", async () => {
  await withKeriPyPeer((py) =>
    run(function*() {
      let schema = "";
      const party = yield* groupRelay(py, function*(group) {
        schema = (yield* call(() => py.issue(group.pre!, "signed"))).schema;
      });
      const { groupIpex, presentation } = party.edge.runtime.operations!;
      yield* spurnedApply(py, party, schema, function*(schema) {
        const options = { recipient: py.pre, message: "Relay group apply", plan: [[schema, "/", []]] as const };
        const { said } = yield* proposeGroupNegotiation(presentation.deps, groupIpex, {
          verb: "apply",
          hab: party.hab,
          options,
        });
        assertEquals(
          (yield* waitForGroupIpex(groupIpex, said, { timeoutMs: BUDGET_MS })).status,
          { state: "done", phase: "accepted" },
        );
        return said;
      });
    })
  );
});
