/**
 * A pinned KERIpy v2 peer and a keri-ts edge in relay mode exchange a v2 credential over IPEX (run in Docker).
 *
 * Our side is the downstream product's shape: the edge is a runtime with `relay` set, and every request it makes
 * goes to its agent, a real `runHostKernel` host with `enableRelay`, KRAM on and full workers. The edge authorizes
 * the agent as its `mailbox`. The KERIpy peer (packages/keri/test/fixtures/ipex-mailbox-peer.py, `relay` mode) is a
 * v2 Habery with KRAM on that publishes its own controller location and end role, serves its OOBI with the stock
 * `OOBIEnd`, resolves ours with its own `Oobiery`, and sends with its own `StreamPoster`, which picks the edge's
 * published `mailbox` end role and wraps each message in a v2 `/fwd` to the agent. Nothing is posted into either
 * side by the test: the fixture's `/_relay` control only chooses an action and reads state.
 *
 * Each check names the KERIpy profile it runs against. The profile rule (2.2.5 gate): upstream `main` first, the
 * `candidate` (kentbull/keripy v2-spec) only for a check main cannot perform, with the missing capability named.
 */
import { collectPayload, concatBytes, nestedPayload, Vrsn_2_0 } from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn, suspend } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { runHostKernel } from "@keri-ts/hosting";
import { createHabery } from "keri-ts/db/lmdb";
import {
  AcdcV2Regery as Regery,
  addMailbox,
  type AgentRuntime,
  createAgentRuntime,
  FetchHttpClient,
  type Hab,
  type Habery,
  type HttpClient,
  type MailboxAdminDeps,
  present,
  type Receiptor,
  receiveIssuance,
  RegistryAuthor,
  type Relay,
  Roles,
  runAgentRuntime,
  settleRuntimeIngress,
  systemClock,
  waitForPresentation,
} from "keri-ts/runtime";
import type { RegBaser } from "../../../src/acdc/regbasing.ts";
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
const BUDGET_MS = 60_000;

/** A pinned KERIpy reference profile this file can select. */
type Profile = "main" | "candidate";

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
  yield* ensure(function* () {
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
  /** Accepted TEL head SAID of each asked registry. */
  registries: Record<string, string | null>;
  /** Whether the KERIpy peer holds an opening of each asked registry's head (candidate only). */
  openings: Record<string, boolean>;
  received: string[];
}

/** The KERIpy peer's state query. */
interface StateQuery {
  urls?: string[];
  pres?: string[];
  saids?: string[];
  registries?: string[];
}

/**
 * How a credential is authenticated and how its state is opened.
 * - `private`: a v2 registry; the issued state is an anchored blindable update (`bup`) whose opening travels only
 *   in the Grant, on the node.
 * - `public`: a v2 registry whose `bup` carries its opening in the published TEL; the Grant carries none, and any
 *   reader of the TEL learns the state without an Unblind or key exchange ("unblinded" for keri-ts).
 * - `signed`: no registry; the issuer's signature on the node.
 */
type Credential = "private" | "public" | "signed";

/** The credential the KERIpy peer issued; `registry` is null and `events` empty for a signed credential. */
interface PeerIssued {
  credential: string;
  /** SAID of the credential's schema. */
  schema: string;
  registry: string | null;
  /** SAIDs of the published TEL events, in order: `rip`, then the issued `bup`. */
  events: string[];
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
  issue(recipient: string, credential: Credential): Promise<PeerIssued> {
    return this.command("issue", { recipient, registry: credential !== "signed", public: credential === "public" });
  }
  grant(): Promise<string> {
    return this.command("grant", {});
  }
  admit(grant: string): Promise<string> {
    return this.command("admit", { grant });
  }
  state(query: StateQuery): Promise<PeerState> {
    return this.command("state", query);
  }
}

/** Run `body` against a fresh KERIpy peer from `profile`, verified against its pinned commit. */
async function withKeriPyPeer(profile: Profile, body: (peer: KeriPyRelayPeer) => Promise<void>): Promise<void> {
  const prefix = profile === "main" ? "KERIPY_MAIN" : "KERIPY_CANDIDATE";
  const root = Deno.env.get(`${prefix}_ROOT`)?.trim(), python = Deno.env.get(`${prefix}_PYTHON`)?.trim();
  if (!root || !python) throw new Error(`The ${profile} KERIpy peer requires ${prefix}_ROOT and ${prefix}_PYTHON.`);
  const home = await Deno.makeTempDir({ prefix: `relay-keripy-${profile}-` });
  try {
    const env: Record<string, string> = {
      ...Deno.env.toObject(),
      HOME: home,
      KERIPY_INTEROP_PROFILE: profile,
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
      throw new Error(`KERIpy ${profile} relay peer output:\n${(await output).join("\n")}`, { cause });
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

/**
 * Whether the agent's own identifier is transferable (the product's shape) or non-transferable (a `B` prefix).
 * KERIpy main's StreamPoster can introduce itself only to a non-transferable mailbox; see the main tests.
 */
type AgentKind = "transferable" | "non-transferable";

/** Our side: the agent host and the edge runtime behind it, onboarded and introduced to the KERIpy peer. */
interface RelaySide {
  agentUrl: string;
  agent: Hab;
  agentRt: AgentRuntime;
  edge: AgentRuntime;
  edgeHab: Hab;
  /** Every URL the edge's HTTP client was asked to reach. */
  requested: string[];
}

/**
 * Start the agent and the single-sig edge and onboard the edge through the agent only. `beforeIntroduction` runs
 * before either side resolves the other's OOBI, so KEL events it anchors are in the KEL each side first learns.
 */
function* singleSigRelay(
  py: KeriPyRelayPeer,
  agentKind: AgentKind,
  beforeIntroduction: (edge: Hab) => Operation<void>,
): Operation<RelaySide> {
  const agentPort = reservePort();
  const agentUrl = `http://127.0.0.1:${agentPort}/`;
  const { hby: agentHby } = yield* stores("agent");
  const agent = agentHby.makeHab("agent", undefined, { transferable: agentKind === "transferable" });
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
      companionHosts: [function* (runtime) {
        hosted = runtime;
        yield* suspend();
      }],
    })
  );
  yield* ensure(() => agentHost.halt());
  yield* call(() => listening.promise);
  yield* until(() => !!hosted, "the agent runtime");
  const agentRt = hosted!;

  const edgeStores = yield* stores("edge");
  const edgeHby = edgeStores.hby;
  const edgeHab = edgeHby.makeHab("edge");
  const requested: string[] = [];
  const relay: Relay = { aid: agent.pre!, oobi: `${agentUrl}oobi/${agent.pre}/controller` };
  const edge = yield* createAgentRuntime(edgeHby, recording(new FetchHttpClient(), requested), systemClock, {
    relay,
    acdc: new Regery(edgeHby, edgeStores.baser),
    kram: KRAM,
  });
  yield* ensure(() => edge.close());
  const edgeHost = yield* spawn(() => runAgentRuntime(edge, { hab: edgeHab }));
  yield* ensure(() => edgeHost.halt());

  // Onboarding through the agent only.
  yield* until(() => edgeHby.db.roobi.get(relay.oobi)?.state === "resolved", "the edge to resolve the agent's OOBI");
  assertEquals((yield* addMailbox(adminDeps(edge), edgeHab, agent.pre!)).state, "authorized");
  yield* until(
    () => agentHby.db.ends.get([edgeHab.pre!, Roles.mailbox, agent.pre!])?.allowed === true,
    "the agent to accept the edge's mailbox authorization",
  );

  yield* beforeIntroduction(edgeHab);

  // The edge learns the KERIpy peer by asking the agent; the KERIpy peer resolves the edge's mailbox OOBI at the
  // agent with its own Oobiery.
  edge.oobiery.resolve(py.oobi);
  yield* until(() => edgeHby.db.roobi.get(py.oobi)?.state === "resolved", "the edge to resolve the KERIpy OOBI");
  assertEquals(agentHby.db.roobi.get(py.oobi)?.state, "resolved", "the agent fetched the KERIpy OOBI");
  assert(requested.includes(`${agentUrl}oobi/${py.pre}/controller`), "the edge read the KERIpy OOBI from the agent");
  const edgeOobi = `${agentUrl}oobi/${edgeHab.pre}/mailbox/${agent.pre}`;
  yield* call(() => py.resolve([edgeOobi]));
  const introduced = yield* observe("the KERIpy peer to resolve the edge's mailbox OOBI at the agent", async () => {
    const state = await py.state({ urls: [edgeOobi], pres: [edgeHab.pre!] });
    return state.oobis[edgeOobi] === "resolved" && state.ends[edgeHab.pre!]?.mailbox?.includes(agent.pre!)
      ? state
      : undefined;
  });
  assertEquals(introduced.known[edgeHab.pre!], edgeHab.kever!.sn, "the KERIpy peer holds the edge's KEL");
  return { agentUrl, agent, agentRt, edge, edgeHab, requested };
}

/** Every request the edge made went to the agent's origin. */
function assertOnlyAgent(side: RelaySide): void {
  assert(side.requested.length > 0);
  const origin = new URL(side.agentUrl).origin;
  assertEquals(side.requested.filter((url) => new URL(url).origin !== origin), [], "the edge contacted only its agent");
}

/** What the receive direction proved, for the present direction to build on. */
interface Received {
  side: RelaySide;
  issued: PeerIssued;
  grant: string;
  admit: string;
}

/**
 * Receive (R): the KERIpy peer issues a v2 credential to the edge and opens with its Grant, sent by StreamPoster
 * with any TEL ahead of it; the edge polls them from its mailbox at the agent and admits; the agent forwards the
 * Admit to the KERIpy peer's controller endpoint, which accepts it as the Grant's answer.
 */
function* receiveFromKeriPy(py: KeriPyRelayPeer, agentKind: AgentKind, credential: Credential): Operation<Received> {
  let issued: PeerIssued | undefined;
  const side = yield* singleSigRelay(py, agentKind, function* (edge) {
    issued = yield* call(() => py.issue(edge.pre!, credential));
  });
  const { edge, edgeHab, agentRt } = side;
  const grant = yield* call(() => py.grant());
  yield* until(
    () => !!edge.exc.retainedInput(grant, { pending: true }) || edge.exc.complete(grant),
    "the edge to poll the KERIpy Grant from its mailbox at the agent",
  );
  assertEquals(agentRt.hby.db.exns.get([grant]), null, "the agent stored the Grant for the edge; it is not party");
  const outcome = yield* receiveIssuance(edge.operations!.issuance, { grant, timeoutMs: BUDGET_MS });
  assertEquals(outcome.outcome, "admitted", JSON.stringify(outcome));
  if (outcome.outcome !== "admitted") throw new Error("unreachable");
  assertEquals(outcome.delivery.state, "delivered", JSON.stringify(outcome.delivery));
  const admit = outcome.admit;
  assert(
    loadNests(edge.hby.db, grant).some((frame) => frame.body.said === issued!.credential),
    "the edge holds the credential",
  );
  if (issued!.registry) {
    const head = issued!.events.at(-1)!;
    assertEquals(edge.acdc!.store.headEvent(issued!.registry)?.said, head, "the edge holds the TEL head");
    // A public opening is read from the published TEL; a private one only from the Grant, never stored as public.
    assertEquals(!!edge.acdc!.store.opening(head), credential === "public", "where the edge read the state from");
  }
  const seen = yield* observe("the KERIpy peer to accept the edge's Admit", async () => {
    const state = await py.state({ saids: [grant, admit] });
    return state.exchanges[admit]?.accepted ? state : undefined;
  });
  assertEquals(seen.exchanges[admit].sender, edgeHab.pre, "the Admit is the edge's own");
  assertEquals(seen.exchanges[admit].prior, grant);
  assertEquals(seen.exchanges[grant].response, admit, "the KERIpy peer records the Admit as the Grant's answer");
  return { side, issued: issued!, grant, admit };
}

/** The receive check: the edge admits a KERIpy-issued credential. */
function* receiveCheck(py: KeriPyRelayPeer, agentKind: AgentKind, credential: Credential): Operation<void> {
  const { side } = yield* receiveFromKeriPy(py, agentKind, credential);
  assertOnlyAgent(side);
}

/**
 * Wait for the KERIpy peer to accept the edge's Grant of `credential`, answer it with an Admit by StreamPoster, and
 * for the edge to poll that Admit from its mailbox at the agent.
 */
function* keriPyAdmits(
  side: RelaySide,
  py: KeriPyRelayPeer,
  grant: string,
  credential: string,
  registry: string | null,
): Operation<PeerState> {
  const { edge, edgeHab } = side;
  const accepted = yield* observe("the KERIpy peer to accept the edge's Grant", async () => {
    const state = await py.state({ saids: [grant], registries: registry ? [registry] : [] });
    return state.exchanges[grant]?.accepted ? state : undefined;
  });
  const exchange = accepted.exchanges[grant];
  assertEquals(exchange.sender, edgeHab.pre, "the Grant is the edge's own");
  assertEquals(exchange.nests.map((nest) => nest.said), [credential], "the KERIpy peer holds the credential");
  const admit = yield* call(() => py.admit(grant));
  const answered = yield* waitForPresentation(edge.operations!.presentation, grant, {
    timeoutMs: BUDGET_MS,
    until: (status) => status.state !== "active" && (status.state !== "done" || !!status.response),
  });
  assertEquals(answered.status.state, "done", JSON.stringify(answered.status));
  assertEquals((answered.status as { response?: { said: string } }).response?.said, admit, "the edge polled the Admit");
  assertEquals(edge.hby.db.erpy.get([grant])?.qb64, admit, "the edge holds the KERIpy Admit as the Grant's answer");
  return accepted;
}

/**
 * Present (P): after receiving a KERIpy-issued credential, the edge presents it back to the KERIpy peer as a Grant
 * through the agent (the admitted Grant's own nodes, with presenter authorization); the KERIpy peer accepts it,
 * reads the credential's registry state and answers with an Admit.
 */
function* presentCheck(py: KeriPyRelayPeer, agentKind: AgentKind, credential: Credential): Operation<void> {
  const { side, issued, grant } = yield* receiveFromKeriPy(py, agentKind, credential);
  const { edge, edgeHab } = side;
  const transferred = concatBytes(
    ...(yield* call(() =>
      Promise.all(loadNests(edge.hby.db, grant).map((node) => collectPayload(nestedPayload(node, Vrsn_2_0))))
    )),
  );
  const { said: presented } = yield* present(edge.operations!.presentation, {
    verb: "grant",
    hab: edgeHab,
    selection: { transferred, presenterAuthorized: true },
    options: { recipient: py.pre, message: "Relay presentation" },
  });
  const accepted = yield* keriPyAdmits(side, py, presented, issued.credential, issued.registry);
  if (issued.registry) {
    assertEquals(accepted.registries[issued.registry], issued.events.at(-1), "the KERIpy peer reads its TEL head");
  }
  assertOnlyAgent(side);
}

/** A receipt collector for an identifier with no witnesses: anchoring needs no receipts. */
function unwitnessed(hby: Habery): Receiptor {
  return { hby, *receipt(): Operation<void> {} } as unknown as Receiptor;
}

/**
 * The edge issues a publicly opened v2 credential to the KERIpy peer and grants it through the agent; the Grant's
 * proof support carries the edge's KEL and the TEL with the published opening. The KERIpy peer accepts the Grant,
 * holds the TEL head and its opening, and answers with an Admit.
 */
function* issueToKeriPy(py: KeriPyRelayPeer, agentKind: AgentKind): Operation<void> {
  const side = yield* singleSigRelay(py, agentKind, function* () {});
  const { edge, edgeHab } = side;
  const author = new RegistryAuthor(edge.acdc!, unwitnessed(edge.hby));
  yield* author.incept("relay", edgeHab.pre!);
  const registry = author.registry("relay", edgeHab.pre!);
  const credential = author.create(registry, { issuee: py.pre, attribute: { name: "Ada" } });
  const update = yield* author.update(registry, credential, "issued", { public: true });
  assertExists(edge.acdc!.store.opening(update.said!), "the edge published the opening with its TEL");
  const node = yield* call(() =>
    collectPayload(nestedPayload({ body: credential, attachments: [], gvrsn: Vrsn_2_0 }, Vrsn_2_0))
  );
  const { said: grant } = yield* present(edge.operations!.presentation, {
    verb: "grant",
    hab: edgeHab,
    selection: { transferred: node, presenterAuthorized: true },
    options: { recipient: py.pre, message: "Relay issuance" },
  });
  const accepted = yield* keriPyAdmits(side, py, grant, credential.said!, registry.regk!);
  assertEquals(accepted.registries[registry.regk!], update.said, "the KERIpy peer holds the edge's TEL head");
  assertEquals(accepted.openings[registry.regk!], true, "the KERIpy peer holds the published opening of that head");
  assertOnlyAgent(side);
}

// --- upstream main (WebOfTrust c7e74adc): every check fails; each records the first cause that stops it ---

Deno.test({
  name: "KERIpy main -> relay single-sig",
  // EXPECTED FAILURE against main. KERIpy's StreamPoster raises before it sends anything: forwarding.py:608
  // (`introduce`) reads `hab.db.vrc`, which does not exist (the Baser store is `vrcs`), whenever the mailbox
  // identifier is transferable, and our agent's is. The fixture's `grant` answers 500 with
  // "AttributeError: 'Baser' object has no attribute 'vrc'". Fixed upstream after the pin by 999d226d
  // ("Fix introduction receipt lookup for the target peer", WebOfTrust/keripy#1721). A signed credential, because
  // main cannot send a v2 TEL at all (see the candidate tests).
  ignore: true,
  async fn() {
    await withKeriPyPeer("main", (py) => run(() => receiveCheck(py, "transferable", "signed")));
  },
});

Deno.test({
  name: "KERIpy main -> relay single-sig, non-transferable agent",
  // EXPECTED FAILURE against main, the next cause once the agent is non-transferable. Main opens every IPEX v2
  // conversation with an `exn` whose `p` is empty and whose `x` is a fresh random digest (acdc/ipexing.py:2035
  // apply, :2119 offer, :2322 grant). The KERI v2 specification requires the first message of a transaction to be an
  // `xip` and `x` to be that `xip`'s SAID (kswg-keri-specification spec-body.md "Exchange Identifier"), so keri-ts
  // refuses the Grant: decision `reject`, "Exchange route /ipex/grant failed handler verification." (an opener
  // without a prior must be an `xip`: packages/keri/src/app/ipex/ipex-v2.ts verifyContext, the `!priorSaid` branch).
  // keri-ts is right; this is a KERIpy main nonconformance.
  ignore: true,
  async fn() {
    await withKeriPyPeer("main", (py) => run(() => receiveCheck(py, "non-transferable", "signed")));
  },
});

Deno.test({
  name: "relay single-sig -> KERIpy main",
  // EXPECTED FAILURE against main. Main cannot take in anything a keri-ts presentation needs: (1) its Parser has
  // no v2 registry route, so the `rip`/`bup` TEL frames ahead of the Grant raise "Unexpected message ilk"
  // (core/parsing.py, the SerderACDC branch); (2) it drops every `xip`: Kevery.processXip is a stub that does
  // nothing (core/eventing.py, "Stub: KERI v2 exchange transaction; no processing yet."), so the Grant (an `xip`,
  // as the specification requires of an opener) is neither accepted nor escrowed and no Admit is sent. A keri-ts
  // Apply is dropped the same way. The test times out waiting for the KERIpy peer to accept the Grant.
  ignore: true,
  async fn() {
    await withKeriPyPeer("main", (py) => run(() => issueToKeriPy(py, "transferable")));
  },
});

// --- candidate (kentbull/keripy v2-spec 54cf0a04), for what main cannot perform (above) ---

Deno.test("KERIpy candidate -> relay single-sig", async () => {
  await withKeriPyPeer("candidate", (py) => run(() => receiveCheck(py, "transferable", "private")));
});

Deno.test("relay single-sig -> KERIpy candidate", async () => {
  await withKeriPyPeer("candidate", (py) => run(() => presentCheck(py, "transferable", "private")));
});

Deno.test({
  name: "a publicly opened v2 credential issued by KERIpy is admitted and read by keri-ts",
  // NOT FINISHED: the test's construction is incomplete, so this proves nothing yet in either direction. The
  // fixture's public issue builds the Grant origin with `messagize(full)` and no opening, which the candidate
  // refuses before anything is sent: "ValueError: Missing authenticator for msg=..." (keri/core/eventing.py
  // messagize). Remove `ignore` once the origin is built without that authenticator check.
  ignore: true,
  async fn() {
    await withKeriPyPeer("candidate", (py) => run(() => receiveCheck(py, "transferable", "public")));
  },
});

Deno.test({
  name: "a publicly opened v2 credential issued by keri-ts is admitted and read by KERIpy",
  // NOT FINISHED: the test's construction is incomplete. Selecting the bare issued node with
  // `{ transferred, presenterAuthorized: true }` is refused locally before anything is sent: "ValidationError:
  // Current authenticated graph truth is required before use." (packages/keri/src/app/ipex/ipex-discloser.ts:501,
  // requireGraph). The issuer's own selection path is still to be chosen. Remove `ignore` once it is.
  ignore: true,
  async fn() {
    await withKeriPyPeer("candidate", (py) => run(() => issueToKeriPy(py, "transferable")));
  },
});
