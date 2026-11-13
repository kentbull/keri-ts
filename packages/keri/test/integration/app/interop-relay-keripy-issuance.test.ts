/**
 * keri-ts in relay mode issues a v2 credential to a pinned KERIpy v2 peer and revokes it, and holds one KERIpy revokes
 * (run in Docker).
 *
 * The shape is the one interop-relay-keripy.test.ts uses, and the setup helpers are copied from it: the edge is a
 * runtime with `relay` set behind a real `runHostKernel` agent (`enableRelay`, KRAM on); the edge authorizes the agent
 * as its `mailbox`; the KERIpy peer (packages/keri/test/fixtures/ipex-mailbox-peer.py, `relay` mode) resolves our
 * OOBIs with its own `Oobiery` and sends with its own `StreamPoster`. That file covers KERIpy as issuer; this one
 * covers keri-ts as issuer, single-sig and as the group, and revocation in both directions.
 *
 * Every credential here is publicly opened: each `bup` carries its opening in the published TEL, and the Grant's
 * registry proof carries the issued one. KERIpy's IPEX handler records the state each Grant authenticated
 * (`Baser.exrs`) and judges none of it; the fixture's `holding` action reads that record, its TEL head and the state
 * an opening it holds for that head discloses.
 *
 * A revocation travels as revocation evidence, the issuer's KEL and the TEL with the revoked `bup` and its published
 * opening, sent to the holder's published end role: keri-ts by its relay's Poster (as the legacy
 * `deliverCredentialRevocation` sends a `rev`), KERIpy by StreamPoster. It cannot travel as a second Grant: keri-ts
 * refuses to present a revoked credential ("Current authenticated graph truth is required before use.",
 * src/app/ipex/ipex-discloser.ts `requireGraph`, from `issuedNodeVerdict` in ipex-node-authentication.ts).
 * Candidate profile (kentbull/keripy v2-spec) only.
 */
import { runHostKernel } from "@keri-ts/hosting";
import {
  collectPayload,
  makeBlindState,
  MtrDex,
  nestedPayload,
  parseBytes,
  type SerderACDC,
  type Siger,
  Signer,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn, suspend } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { createHabery } from "keri-ts/db/lmdb";
import {
  acdcmap,
  AcdcV2Regery as Regery,
  addMailbox,
  type AgentRuntime,
  blindate,
  completeGroupMailbox,
  createAgentRuntime,
  FetchHttpClient,
  type Hab,
  type Habery,
  type HttpClient,
  incept,
  interact,
  type MailboxAdminDeps,
  messagize,
  present,
  proposeGroupMailbox,
  proposeGroupPresentation,
  proposeRegistryEvent,
  type Receiptor,
  receiveIssuance,
  regcept,
  RegistryAuthor,
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

// --- setup, copied from interop-relay-keripy.test.ts ---

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

/** The credential the KERIpy peer issued. */
interface PeerIssued {
  credential: string;
  schema: string;
  registry: string | null;
  /** SAIDs of the published TEL events, in order: `rip`, then the issued `bup`. */
  events: string[];
}

/** The registry state KERIpy's IPEX handler recorded for one credential in one accepted Grant, and its TEL head. */
interface PeerHolding {
  state: string | null;
  /** SAID of the registry head the Grant's proof authenticated. */
  said: string | null;
  sn: number | null;
  /** The registry's accepted TEL head now. */
  head: string | null;
  /** The state an opening the peer holds for that head discloses; null when it holds none. */
  current: string | null;
}

/** What the KERIpy peer's revocation produced: the revoked `bup` and the KEL event that anchors it. */
interface PeerRevoked {
  event: string;
  anchor: string;
}

/** The running KERIpy peer: its identifier, endpoint, OOBI and its action control. */
class KeriPyRelayPeer {
  constructor(readonly pre: string, readonly url: string, readonly oobi: string) {}

  private async command<T>(action: string, args: object): Promise<T> {
    const response = await fetch(new URL("_relay", this.url), {
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
    return this.command("resolve", { urls });
  }
  /** Issue a publicly opened registry credential to `recipient`. */
  issue(recipient: string): Promise<PeerIssued> {
    return this.command("issue", { recipient, registry: true, public: true });
  }
  grant(): Promise<string> {
    return this.command("grant", {});
  }
  admit(grant: string): Promise<string> {
    return this.command("admit", { grant });
  }
  revoke(): Promise<PeerRevoked> {
    return this.command("revoke", {});
  }
  holding(grant: string, credential: string, registry: string): Promise<PeerHolding> {
    return this.command("holding", { grant, credential, registry });
  }
  state(query: StateQuery): Promise<PeerState> {
    return this.command("state", query);
  }
}

/** Run `body` against a fresh KERIpy candidate peer, verified against its pinned commit. */
async function withKeriPyPeer(body: (peer: KeriPyRelayPeer) => Promise<void>): Promise<void> {
  const root = Deno.env.get("KERIPY_CANDIDATE_ROOT")?.trim(), python = Deno.env.get("KERIPY_CANDIDATE_PYTHON")?.trim();
  if (!root || !python) throw new Error("The KERIpy peer requires KERIPY_CANDIDATE_ROOT and KERIPY_CANDIDATE_PYTHON.");
  const home = await Deno.makeTempDir({ prefix: "relay-keripy-issuance-" });
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

/** Start the agent host on a fresh store, with a transferable identifier; its lifetime is the current scope. */
function* startAgent(): Operation<Agent> {
  const port = reservePort();
  const url = `http://127.0.0.1:${port}/`;
  const { hby } = yield* stores("agent");
  const hab = hby.makeHab("agent");
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

/** Every request the edge made went to the agent's origin. */
function assertOnlyAgent(agent: Agent, edge: Edge): void {
  assert(edge.requested.length > 0);
  const origin = new URL(agent.url).origin;
  assertEquals(edge.requested.filter((url) => new URL(url).origin !== origin), [], "the edge contacted only its agent");
}

/** Our single-sig side: the agent and the edge behind it, onboarded and introduced to the KERIpy peer. */
interface SingleSide {
  agent: Agent;
  edge: Edge;
  hab: Hab;
}

/** Start the agent and a single-sig edge; `beforeIntroduction` runs before either side resolves the other's OOBI. */
function* singleSigRelay(
  py: KeriPyRelayPeer,
  beforeIntroduction: (edge: Hab) => Operation<void>,
): Operation<SingleSide> {
  const agent = yield* startAgent();
  const { hby, baser } = yield* stores("edge");
  const hab = hby.makeHab("edge");
  const edge = yield* startEdge(agent, hby, baser, hab);
  yield* authorizeMailbox(agent, edge, hab);
  yield* beforeIntroduction(hab);
  yield* introduce(py, agent, edge, hab);
  return { agent, edge, hab };
}

/** Our group side: the agent, the edge, the edge member and the group as the edge holds it. */
interface GroupSide {
  agent: Agent;
  edge: Edge;
  member: Hab;
  group: Hab;
}

/**
 * Start the agent and the edge as a group member and onboard both through the agent (as interop-relay-keripy.test.ts
 * `groupRelay`): the edge member is non-transferable with a held signer (weight 1); the custodian on the agent is the
 * group's sole rotation member (weight 0); `isith ["1","0"]`, `nsith "1"`, toad 0. The group's inception and the
 * coordinator event are dispatched into both stores in-process; the group's `mailbox` role goes through the relay.
 */
function* groupRelay(py: KeriPyRelayPeer): Operation<GroupSide> {
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
  yield* introduce(py, agent, edge, group);
  return { agent, edge, member, group };
}

/** A receipt collector for an identifier with no witnesses: anchoring needs no receipts. */
function unwitnessed(hby: Habery): Receiptor {
  return { hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
}

/** The credential's own node, as the `transferred` bytes of a Grant selection. */
function* credentialNode(credential: SerderACDC): Operation<Uint8Array> {
  return yield* call(() =>
    collectPayload(nestedPayload({ body: credential, attachments: [], gvrsn: Vrsn_2_0 }, Vrsn_2_0))
  );
}

/**
 * Send the revocation evidence to the KERIpy peer through the relay: the issuer's KEL (which ends with the anchor) and
 * its registry's TEL (which ends with the revoked `bup` and its published opening), as one stream from `sender`.
 */
function* sendRevocation(edge: Edge, sender: Hab, issuer: string, regk: string, py: KeriPyRelayPeer): Operation<void> {
  const msgs = [...edge.hby.db.clonePreIter(issuer, 0, Vrsn_2_0), ...edge.runtime.acdc!.store.cloneTelIter(regk)];
  const postman = edge.runtime.postman;
  const outcome = yield* postman.wait(
    postman.sendStream({ src: sender.pre!, dest: py.pre, msgs, topic: "credential" }, { notify: true }),
  );
  assert(outcome.kin !== "failed", `the revocation evidence was not sent: ${JSON.stringify(outcome)}`);
}

/** Wait for the KERIpy peer to accept the revoked head, then check what it reads (see the expected-failure tests). */
function* keriPyLearnsRevocation(
  py: KeriPyRelayPeer,
  grant: string,
  credential: string,
  regk: string,
  revoked: string,
  readsRevoked: boolean,
): Operation<void> {
  const held = yield* observe("the KERIpy peer to accept the revoked TEL head", async () => {
    const holding = await py.holding(grant, credential, regk);
    return holding.head === revoked ? holding : undefined;
  });
  assertEquals(held.state, "issued", "the admitted Grant's record is unchanged");
  if (readsRevoked) assertEquals(held.current, "revoked", "KERIpy reads the credential as revoked");
}

/** Wait for the KERIpy peer to accept a Grant of `credential` from `sender`, and return what it recorded. */
function* keriPyHolds(
  py: KeriPyRelayPeer,
  grant: string,
  sender: string,
  credential: string,
  registry: string,
): Operation<PeerHolding> {
  const accepted = yield* observe(`the KERIpy peer to accept the Grant ${grant}`, async () => {
    const state = await py.state({ saids: [grant] });
    return state.exchanges[grant]?.accepted ? state : undefined;
  });
  assertEquals(accepted.exchanges[grant].sender, sender, "the Grant is ours");
  assertEquals(accepted.exchanges[grant].nests.map((nest) => nest.said), [credential], "it carries the credential");
  return yield* call(() => py.holding(grant, credential, registry));
}

// --- keri-ts issues and revokes ---

/**
 * Single-sig issuer: the edge incepts a v2 registry, issues a publicly opened credential to the KERIpy peer and grants
 * it through the agent (`refresh` attaches the current registry proof); KERIpy admits and records `issued`. The edge
 * revokes (a second public `bup`) and sends the revocation evidence through the agent; KERIpy accepts the revoked
 * `bup` as its TEL head. `readsRevoked` also requires KERIpy to read the state from it.
 */
function* singleSigIssuesAndRevokes(py: KeriPyRelayPeer, readsRevoked: boolean): Operation<void> {
  const { agent, edge, hab } = yield* singleSigRelay(py, function*() {});
  const acdc = edge.runtime.acdc!;
  const author = new RegistryAuthor(acdc, unwitnessed(edge.hby));
  yield* author.incept("relay", hab.pre!);
  const registry = author.registry("relay", hab.pre!);
  const regk = registry.regk!;
  const credential = author.create(registry, { issuee: py.pre, attribute: { name: "Ada" } });
  const issued = yield* author.update(registry, credential, "issued", { public: true });
  const { said: grant } = yield* present(edge.runtime.operations!.presentation, {
    verb: "grant",
    hab,
    selection: { transferred: yield* credentialNode(credential), presenterAuthorized: true, refresh: true },
    options: { recipient: py.pre, message: "Relay issuance" },
  });
  const held = yield* keriPyHolds(py, grant, hab.pre!, credential.said!, regk);
  assertEquals(held, { state: "issued", said: issued.said!, sn: 1, head: issued.said!, current: null });
  const admit = yield* call(() => py.admit(grant));
  const answered = yield* waitForPresentation(edge.runtime.operations!.presentation, grant, {
    timeoutMs: BUDGET_MS,
    until: (status) => status.state !== "active" && (status.state !== "done" || !!status.response),
  });
  assertEquals((answered.status as { response?: { said: string } }).response?.said, admit, "the edge polled the Admit");

  const revoked = yield* author.update(registry, credential, "revoked", { public: true });
  assertEquals(acdc.store.publicOpening(revoked.said!)?.ts.label, "revoked", "the edge published the revoked opening");
  yield* sendRevocation(edge, hab, hab.pre!, regk, py);
  yield* keriPyLearnsRevocation(py, grant, credential.said!, regk, revoked.said!, readsRevoked);
  assertOnlyAgent(agent, edge);
}

/**
 * Group issuer, acting as the group: the edge proposes the group's `rip` and each public `bup` with
 * `proposeRegistryEvent`, whose anchor the edge member's weight alone satisfies, so no approval by the weight-0
 * custodian is driven; the Grant is a `proposeGroupPresentation` the edge member completes alone. KERIpy accepts the
 * Grant against the group's KEL and records `issued`; the edge member sends the group's revocation evidence through
 * the agent and KERIpy accepts the revoked `bup` as its TEL head. `readsRevoked` as for the single-sig issuer.
 */
function* groupIssuesAndRevokes(py: KeriPyRelayPeer, readsRevoked: boolean): Operation<void> {
  const { agent, edge, member, group } = yield* groupRelay(py);
  const runtime = edge.runtime, store = runtime.acdc!.store;
  const proposals = runtime.operations!.groupIpex.deps.registry!;
  const accepted = function*(event: SerderACDC, what: string): Operation<void> {
    const regid = event.ilk === "rip" ? event.said! : event.regid!;
    yield* until(() => store.seqEvent(regid, Number(BigInt(`0x${event.sad!.n}`)))?.said === event.said, what);
  };
  const rip = regcept(group.pre!);
  yield* proposeRegistryEvent(proposals, group, rip);
  yield* accepted(rip, "the group's registry inception");
  const regk = rip.said!;
  const credential = acdcmap(group.pre!, { issuee: py.pre, regid: regk, attribute: { name: "Ada" } });
  const update = function*(prior: SerderACDC, state: string): Operation<SerderACDC> {
    const sn = Number(BigInt(`0x${prior.sad!.n}`)) + 1;
    const opening = makeBlindState({ sn, acdc: credential.said!, state });
    const bup = blindate(regk, prior.said!, opening.d.nonce, { sn });
    yield* proposeRegistryEvent(proposals, group, bup, opening);
    yield* accepted(bup, `the group's ${state} update`);
    assertEquals(store.publicOpening(bup.said!)?.ts.label, state, "the group published the opening");
    return bup;
  };
  const issued = yield* update(rip, "issued");
  const { said: grant } = yield* proposeGroupPresentation(
    runtime.operations!.presentation.deps,
    runtime.operations!.groupIpex,
    {
      hab: group,
      selection: { transferred: yield* credentialNode(credential), presenterAuthorized: true, refresh: true },
      options: { recipient: py.pre, message: "Relay group issuance" },
    },
  );
  assertEquals(
    (yield* waitForGroupIpex(runtime.operations!.groupIpex, grant, { timeoutMs: BUDGET_MS })).status,
    { state: "done", phase: "accepted" },
  );
  const held = yield* keriPyHolds(py, grant, group.pre!, credential.said!, regk);
  assertEquals(held, { state: "issued", said: issued.said!, sn: 1, head: issued.said!, current: null });
  const admit = yield* call(() => py.admit(grant));
  yield* until(() => edge.hby.db.erpy.get([grant])?.qb64 === admit, "the edge to poll the KERIpy Admit of the group");

  const revoked = yield* update(issued, "revoked");
  yield* sendRevocation(edge, member, group.pre!, regk, py);
  yield* keriPyLearnsRevocation(py, grant, credential.said!, regk, revoked.said!, readsRevoked);
  assertOnlyAgent(agent, edge);
}

// --- KERIpy issues and revokes ---

/**
 * KERIpy issues a publicly opened credential to the single-sig edge and grants it (as interop-relay-keripy.test.ts
 * does); the edge admits. KERIpy then revokes and sends the anchoring KEL event and the revoked `bup` by StreamPoster
 * to the edge's mailbox; the edge holds the revoked head and reads `revoked` from its published opening.
 */
function* keriPyRevokesHeld(py: KeriPyRelayPeer): Operation<void> {
  let issued: PeerIssued | undefined;
  const { agent, edge } = yield* singleSigRelay(py, function*(hab) {
    issued = yield* call(() => py.issue(hab.pre!));
  });
  const runtime = edge.runtime, store = runtime.acdc!.store, regk = issued!.registry!;
  const grant = yield* call(() => py.grant());
  yield* until(
    () => !!runtime.exc.retainedInput(grant, { pending: true }) || runtime.exc.complete(grant),
    "the edge to poll the KERIpy Grant from its mailbox at the agent",
  );
  const outcome = yield* receiveIssuance(runtime.operations!.issuance, { grant, timeoutMs: BUDGET_MS });
  assertEquals(outcome.outcome, "admitted", JSON.stringify(outcome));
  assert(loadNests(edge.hby.db, grant).some((frame) => frame.body.said === issued!.credential), "the edge holds it");
  const head = issued!.events.at(-1)!;
  assertEquals(store.headEvent(regk)?.said, head);
  assertEquals(store.publicOpening(head)?.ts.label, "issued", "the edge reads it issued");

  const revoked = yield* call(() => py.revoke());
  yield* until(() => store.headEvent(regk)?.said === revoked.event, "the edge to accept the KERIpy revocation");
  assertEquals(edge.hby.db.getKever(py.pre)?.said, revoked.anchor, "the edge holds the anchoring KEL event");
  const opening = store.publicOpening(revoked.event);
  assertExists(opening, "the edge retained the published opening");
  assertEquals(opening.ts.label, "revoked", "the edge reads it revoked");
  assertEquals(opening.td.nonce, issued!.credential, "for the credential it holds");
  assertOnlyAgent(agent, edge);
}

Deno.test("relay single-sig issues to KERIpy candidate and revokes", async () => {
  await withKeriPyPeer((py) => run(() => singleSigIssuesAndRevokes(py, false)));
});

Deno.test("relay group issues to KERIpy candidate and revokes", async () => {
  await withKeriPyPeer((py) => run(() => groupIssuesAndRevokes(py, false)));
});

/*
 * EXPECTED FAILURE: the KERIpy candidate (54cf0a04) accepts the revoked `bup` but cannot read its state. Its Parser
 * routes a TEL event to `Regery.processEvent` (core/parsing.py, the SerderACDC rip/bup branch), which drops the
 * published opening the frame carries (acdc/registraring.py `processEvent` takes `sscs`/`ssts` and ignores the
 * BlindState attachments in `**kwa`); only `Regery.ingest` returns a vetted opening, and retaining it is left to
 * the caller ("opening retention ... caller policy"). So KERIpy holds the revoked head and no opening for it, and
 * `current` reads null. keri-ts, as holder, retains a published opening at intake (the KERIpy-revokes test below).
 * Fix belongs in KERIpy: retain the vetted `disclosedOpening` of an accepted `bup` on the Parser path.
 */
Deno.test({
  name: "KERIpy candidate reads a relay single-sig revocation as revoked",
  ignore: true,
  async fn() {
    await withKeriPyPeer((py) => run(() => singleSigIssuesAndRevokes(py, true)));
  },
});

/* EXPECTED FAILURE: the group issuer's revocation, for the same cause as the single-sig one above. */
Deno.test({
  name: "KERIpy candidate reads a relay group revocation as revoked",
  ignore: true,
  async fn() {
    await withKeriPyPeer((py) => run(() => groupIssuesAndRevokes(py, true)));
  },
});

Deno.test("KERIpy candidate revokes a credential held by relay single-sig", async () => {
  await withKeriPyPeer((py) => run(() => keriPyRevokesHeld(py)));
});
