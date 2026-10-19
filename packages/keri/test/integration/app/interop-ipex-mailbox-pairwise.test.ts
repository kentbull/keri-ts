/** Independent KERIpy/TS credential processors exchange signed graphs through KRAM. */
import { collectPayload, framePayload, parseBytes, Prefixer, SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { decodeBase64 } from "jsr:@std/encoding/base64";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { createProtocolHandler } from "../../../../tufa/src/http/protocol-handler.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  runAgentRuntimeUntil,
  runtimeOobiTerminalState,
} from "../../../src/app/agent-runtime.ts";
import { requestFrame } from "../../../src/app/cesr-egress.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex-building.ts";
import { consumeMailboxSse } from "../../../src/app/mailbox-sse.ts";
import { WitnessReceiptor } from "../../../src/app/witnessing.ts";
import { query, reply } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { loadNests } from "../../../src/db/exchange-nests.ts";
import {
  createInteropContext,
  randomPort,
  spawnChild,
  startKeriPyWitnessHarness,
  withStartedChild,
} from "./interop-test-helpers.ts";
import { assertKeriPyWitnessStores } from "./interop-witness-helpers.ts";
import { inspectMailbox, introduce, introduceProvider, post, postKel, signed } from "./ipex-witness-helpers.ts";
import { disclosurePlan, graphDisclosures } from "./ipex/disclosures.ts";
import { observed, type PeerInfo, type PeerSnapshot, type Verb } from "./ipex/peers.ts";

const PROVIDER = fromFileUrl(new URL("../../fixtures/kram-mailbox-peer.py", import.meta.url));
const PEER = fromFileUrl(new URL("../../fixtures/ipex-mailbox-peer.py", import.meta.url));

/** Control commands choose actions and inspect state; they never supply accepted protocol rows. */
async function command<T>(url: string, path: string, args: object): Promise<T> {
  const response = await fetch(new URL(path, url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  assertEquals(response.status, 200, text);
  return JSON.parse(text);
}

for (const tsDiscloser of [true, false]) {
  for (const count of [1, 2]) {
    const graphCase = count === 1 ? "multi-hop" : "branching";
    Deno.test(`IPEX mailbox pairwise: ${tsDiscloser ? "TS → KERIpy" : "KERIpy → TS"}, ${count}-signer TS, witnessed ${graphCase}`, async () => {
      const ctx = await createInteropContext(), aliases = ["wan", "wil", "wes"];
      try {
        const witnesses = await startKeriPyWitnessHarness(ctx, { aliases });
        try {
          const providerPort = randomPort(), mailboxUrl = `http://127.0.0.1:${providerPort}/`;
          const provider = spawnChild(
            ctx.pythonCommand,
            [PROVIDER, String(providerPort), "1", `${ctx.home}/mailbox`],
            ctx.env,
            ctx.repoRoot,
          );
          await withStartedChild(provider, providerPort, async () => {
            const providerPre = (await inspectMailbox(mailboxUrl, "unknown")).provider;
            const config = `${ctx.home}/peer-config.json`;
            await Deno.writeTextFile(
              config,
              JSON.stringify({
                provider: { pre: providerPre, url: mailboxUrl },
                witnesses: witnesses.nodes.map((node) => ({ pre: node.pre, url: node.controllerOobi })),
              }),
            );
            const peerPort = randomPort();
            const child = spawnChild(
              ctx.pythonCommand,
              [PEER, ctx.home, config, graphCase, String(peerPort)],
              ctx.env,
              ctx.repoRoot,
            );
            let exited: Deno.CommandStatus | undefined;
            void child.status.then((status) => {
              exited = status;
            });
            const output = Promise.all([new Response(child.liveStdout).text(), new Response(child.liveStderr).text()]);
            try {
              await withStartedChild(child, peerPort, async () => {
                const py = await observed("witnessed Python IPEX peer", async () => {
                  if (exited) throw new Error(`Python IPEX peer exited ${exited.code}`);
                  try {
                    return JSON.parse(await Deno.readTextFile(`${ctx.home}/ready.json`)) as PeerInfo & {
                      authorization: string;
                      event: string;
                      witnesses: string[];
                      kels: string[];
                    };
                  } catch (error) {
                    if (error instanceof Deno.errors.NotFound) return undefined;
                    throw error;
                  }
                });
                await run(function*() {
                  const hbys: Habery[] = [], runtimes: AgentRuntime[] = [];
                  const listeners: {
                    server: Deno.HttpServer<Deno.NetAddr>;
                    handler: ReturnType<typeof createProtocolHandler>;
                  }[] = [];
                  try {
                    for (let i = 0; i < count; i++) {
                      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
                      hbys.push(hby);
                      runtimes.push(
                        yield* createAgentRuntime(hby, {
                          kram: {
                            enabled: true,
                            caches: { "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000] },
                          },
                        }),
                      );
                    }
                    const wit = { wits: witnesses.nodes.map((node) => node.pre), toad: 2 };
                    const members = hbys.map((hby) => hby.makeHab("member", undefined, count === 1 ? wit : {}));
                    let signers: Hab[] = members;
                    if (count === 2) {
                      const inceptions = hbys.map((hby, i) =>
                        acceptedEventReplayMessage(hby, members[i].pre, 0).message
                      );
                      for (const [i, runtime] of runtimes.entries()) {
                        yield* runtime.reactor.processBytes(inceptions[1 - i]);
                      }
                      const mids = members.map((hab) => hab.pre);
                      const groups = hbys.map((hby, i) =>
                        hby.makeGroupHab("controller", members[i], mids, mids, undefined, {
                          isith: "2",
                          nsith: "2",
                          ...wit,
                        })
                      );
                      for (const [i, runtime] of runtimes.entries()) {
                        yield* runtime.reactor.processBytes(groups[1 - i].message);
                        runtime.hby.kevery.processEscrows();
                        assertExists(groups[i].hab.kever);
                      }
                      signers = groups.map(({ hab }) => hab);
                    }
                    const hab = signers[0], hby = hbys[0], runtime = runtimes[0];
                    const oobis = [
                      ...witnesses.nodes.map((node) => node.controllerOobi),
                      `${mailboxUrl}oobi/${providerPre}/controller`,
                    ];
                    for (const url of oobis) runtime.oobiery.resolve(url);
                    yield* runAgentRuntimeUntil(
                      runtime,
                      () => oobis.every((url) => runtimeOobiTerminalState(runtime, url).status !== "pending"),
                      {
                        hab: members[0],
                        timeoutMs: 20_000,
                        pollMailbox: false,
                      },
                    );
                    for (const url of oobis) assertEquals(runtimeOobiTerminalState(runtime, url).status, "resolved");
                    yield* new WitnessReceiptor(hby, { reactor: runtime.reactor, services: runtime.services }).submit(
                      hab.pre,
                    );
                    const graph = graphDisclosures(hby, hab, graphCase);
                    const urls: string[] = [];
                    for (const [i, memberRuntime] of runtimes.entries()) {
                      const handler = createProtocolHandler(memberRuntime, { serviceHab: signers[i] });
                      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
                      listeners.push({ server, handler });
                      urls.push(`http://127.0.0.1:${server.addr.port}/`);
                    }
                    const ts: PeerInfo = {
                      pre: hab.pre,
                      url: urls[0],
                      schema: (graph.fullNodes[0].sad!.s as { $id: string }).$id,
                      commitment: graph.fullNodes[0].said!,
                    };
                    const plan = disclosurePlan(tsDiscloser ? ts.schema : py.schema, graphCase);
                    // Exchange actual public KEL evidence through both production HTTP intake paths.
                    for (
                      const [owner, pre] of [
                        ...hbys.map((owner, i) => [owner, members[i].pre] as const),
                        [hby, hab.pre] as const,
                        ...graph.issuers.map((issuer) => [hby, issuer.pre] as const),
                      ]
                    ) {
                      for (const url of urls) yield* call(() => introduce(url, owner, pre));
                      yield* call(() => postKel(py.url, owner, pre));
                      yield* call(() => introduceProvider(mailboxUrl, owner, pre));
                    }
                    for (const kel of py.kels) {
                      for (const frame of parseBytes(decodeBase64(kel))) {
                        for (const url of urls) yield* call(() => post(url, frame));
                      }
                    }
                    for (const frame of parseBytes(decodeBase64(py.authorization))) {
                      for (const url of urls) yield* call(() => post(url, frame));
                    }
                    yield* call(() => command(py.url, "_mailbox", { action: "connect", remote: ts, plan }));
                    const role = reply("/end/role/add", { cid: hab.pre, role: "mailbox", eid: providerPre }, {
                      pre: hab.pre,
                      pvrsn: Vrsn_2_0,
                    });
                    for (const url of [...urls, py.url, mailboxUrl]) {
                      yield* call(() => post(url, signed(role, signers)));
                    }
                    yield* call(() =>
                      observed(
                        "Python verified TS controller",
                        async () =>
                          (await command<PeerSnapshot>(py.url, "_fixture", { action: "snapshot" })).known.includes(
                              hab.pre,
                            )
                            ? true
                            : undefined,
                      )
                    );
                    for (const [pre, event] of [[hab.pre, hab.kever!.said], [py.pre, py.event]]) {
                      const state = yield* call(() => inspectMailbox(mailboxUrl, pre));
                      assertEquals(state.sender?.event, event);
                      assertEquals(state.sender?.witnesses, wit.wits);
                      assertEquals(state.sender?.threshold, 2);
                      assertEquals(state.sender?.receipts, [0, 1, 2]);
                    }
                    assertEquals(py.witnesses, wit.wits);
                    let cursor = 0;
                    const received: string[] = [], queries: string[] = [], rejected: string[] = [];
                    const ids: string[] = [], verbs: Verb[] = ["apply", "offer", "agree", "grant", "admit"];
                    for (const [index, verb] of verbs.entries()) {
                      const fromTs = index % 2 === (tsDiscloser ? 1 : 0);
                      const prior = ids.at(-1);
                      // A missing/unsigned deep ancestor is delivered and refused before the valid grant.
                      for (const invalid of verb === "grant" ? [true, false] : [false]) {
                        let said: string;
                        if (fromTs) {
                          const carried = verb === "grant" ? invalid ? graph.badNodes : graph.nodes : [];
                          const previous = prior ? hby.db.exns.get(prior) : undefined;
                          if (prior) assertExists(previous);
                          const body = ipexExnBody(hab.pre, `/ipex/${verb}`, carried, {
                            message: invalid ? "invalid chain" : verb,
                            prior: previous ?? undefined,
                            recipient: py.pre,
                            ...(!prior ? { xid: graph.fullNodes[0].said!, plan } : {}),
                          });
                          const nests = carried.map((node) => {
                            const issuer = graph.issuers.find((issuer) => issuer.pre === node.issuer);
                            assertExists(issuer);
                            return invalid && node.said === graph.unsigned
                              ? { body: node, attachments: [], gvrsn: Vrsn_2_0 }
                              : signed(node, issuer.pre === hab.pre ? signers : [issuer]);
                          });
                          const wire = yield* call(() => collectPayload(framePayload(signed(body, signers, nests))));
                          assertEquals(new TextDecoder().decode(wire).includes("hidden-value"), false);
                          for (const memberRuntime of runtimes) {
                            yield* memberRuntime.reactor.processBytes(wire);
                            assertEquals(Boolean(memberRuntime.hby.db.exns.get(body.said!)), !invalid);
                          }
                          const delivery = yield* call(function*() {
                            const postman = runtime.poster;
                            yield* spawn(() => postman.deliverDo());
                            const evt = postman.send({
                              src: members[0].pre,
                              dest: py.pre,
                              topic: "/credential",
                              msg: wire,
                              delivery: "indirect",
                            }, { notify: true });
                            const outcome = yield* postman.wait(evt);
                            if (outcome.kin === "failed") throw outcome.error;
                            return outcome;
                          });
                          assertEquals(delivery.deliveries, [mailboxUrl]);
                          said = body.said!;
                          yield* call(() =>
                            observed(
                              `Python received ${verb}`,
                              async () =>
                                (await command<PeerSnapshot>(py.url, "_fixture", { action: "snapshot" })).received
                                    .includes(said)
                                  ? true
                                  : undefined,
                            )
                          );
                        } else {
                          said = yield* call(() => command<string>(py.url, "_mailbox", { verb, prior, invalid }));
                          yield* call(() =>
                            observed(`TS mailbox received ${verb}`, async () => {
                              await run(function*() {
                                const qry = query("mbx", {
                                  i: hab.pre,
                                  src: providerPre,
                                  topics: { "/credential": cursor },
                                }, { pre: hab.pre, pvrsn: Vrsn_2_0 });
                                const [frame] = parseBytes(messagize(qry, {
                                  sigers: signers.flatMap((signer) => signer.sign(qry.raw, true)),
                                  seal: { i: new Prefixer({ qb64: hab.pre }) },
                                  gvrsn: Vrsn_2_0,
                                  genusify: true,
                                }));
                                const response = yield* requestFrame(mailboxUrl, frame, {
                                  signal: AbortSignal.timeout(10_000),
                                });
                                assertEquals(response.status, 200);
                                queries.push(qry.said!);
                                yield* consumeMailboxSse(response, new AbortController(), function*(event) {
                                  const [payload] = parseBytes(event.msg);
                                  assertEquals(new TextDecoder().decode(event.msg).includes("hidden-value"), false);
                                  for (const memberRuntime of runtimes) {
                                    yield* memberRuntime.reactor.processBytes(event.msg);
                                  }
                                  received.push(payload.body.said!);
                                  cursor = event.idx + 1;
                                  return false;
                                }, { idleTimeoutMs: 2000, maxDurationMs: 5000 });
                              });
                              return received.includes(said) ? true : undefined;
                            })
                          );
                        }
                        const pyState = yield* call(() =>
                          command<PeerSnapshot>(py.url, "_fixture", { action: "snapshot", inspect: said })
                        );
                        assertEquals(pyState.inspected?.accepted, !invalid, `Python ${verb}`);
                        for (const store of hbys) {
                          assertEquals(Boolean(store.db.exns.get(said)), !invalid, `TS ${verb}`);
                        }
                        if (invalid) {
                          rejected.push(said);
                          assertEquals(pyState.inspected?.escrowed, false);
                          assertEquals(pyState.inspected?.nests, 0);
                          for (const store of hbys) {
                            assertEquals(store.db.epse.get(said), null);
                            assertEquals(store.db.enst.get(said).length, 0);
                          }
                        } else ids.push(said);
                      }
                    }
                    const snapshot = yield* call(() =>
                      command<PeerSnapshot>(py.url, "_fixture", { action: "snapshot" })
                    );
                    const grant = ids[3];
                    assertEquals(snapshot.messages.length, 5);
                    assertEquals(snapshot.notifications, 5);
                    for (const store of hbys) {
                      assertEquals([...store.db.exns.getItemIter()].length, 5);
                      assertEquals(store.db.erpy.get(grant)?.qb64, ids[4]);
                      for (const [index, said] of ids.entries()) {
                        const body = store.db.exns.get(said)!;
                        const pyBody = snapshot.messages.find((message) => message.d === said);
                        assertExists(pyBody);
                        assertEquals(body.route, `/ipex/${verbs[index]}`);
                        for (const field of ["i", "ri", "p", "x"] as const) {
                          assertEquals(body.sad![field], pyBody[field]);
                        }
                        assertEquals(pyBody.p, index ? ids[index - 1] : "");
                        const first = snapshot.messages.find((message) => message.d === ids[0])!;
                        assertEquals(pyBody.x, first.x, "one exchange identity throughout the conversation");
                        const sender = index % 2 === (tsDiscloser ? 1 : 0) ? hab.pre : py.pre;
                        assertEquals(pyBody.i, sender);
                        assertEquals(pyBody.ri, sender === hab.pre ? py.pre : hab.pre);
                      }
                      const nodes = loadNests(store.db, grant);
                      assertEquals(nodes.map(({ body }) => body.said), snapshot.nodes.map((node) => node.said));
                      assertEquals(nodes.length, count === 1 ? 3 : 4);
                      assertEquals(nodes[0].body.said, tsDiscloser ? ts.commitment : py.commitment);
                      for (const { body } of nodes) {
                        assertInstanceOf(body, SerderACDC);
                        assertEquals((body.sad!.a as { status: { value: string } }).status.value, "citizen");
                        assertEquals(typeof (body.sad!.a as { private: unknown }).private, "string");
                        assertEquals(new TextDecoder().decode(body.raw).includes("hidden-value"), false);
                        assertEquals(store.db.exns.get(body.said!), null);
                      }
                      for (const said of rejected) assertEquals(store.db.exns.get(said), null);
                    }
                    for (const node of snapshot.nodes) {
                      assertEquals(node.attributes.status.value, "citizen");
                      assertEquals(typeof node.attributes.private, "string");
                      assertEquals(node.raw.includes("hidden-value"), false);
                      assertEquals(node.independentlyAccepted, false);
                    }
                    const tsQueries = yield* call(() => inspectMailbox(mailboxUrl, hab.pre, queries));
                    assertEquals(tsQueries.rows.every((row) => row.cached && !row.pending), true);
                    const pyQueries = yield* call(() => inspectMailbox(mailboxUrl, py.pre));
                    assertEquals(
                      pyQueries.queries.length > 0,
                      true,
                      "the real Python Poller completed KRAM authentication",
                    );
                    assertEquals(hby.db.wigs.get([hab.pre, hab.kever!.said]).map((sig) => sig.index).sort(), [0, 1, 2]);
                    yield* call(() => assertKeriPyWitnessStores(ctx, witnesses, aliases, hab.pre, 0, 3));
                    yield* call(() => assertKeriPyWitnessStores(ctx, witnesses, aliases, py.pre, 1, 3));
                  } finally {
                    for (const { server, handler } of listeners.reverse()) {
                      yield* call(() => server.shutdown());
                      yield* call(() => handler.close?.());
                    }
                    for (const runtime of runtimes.reverse()) yield* runtime.close();
                    for (const hby of hbys.reverse()) yield* hby.close(true);
                  }
                });
              });
              await output;
            } catch (cause) {
              throw new Error(`Python mailbox IPEX peer: ${(await output).join("\n")}`, { cause });
            }
          });
        } finally {
          await witnesses.close();
          await Deno.remove(witnesses.home, { recursive: true });
          await Deno.remove(witnesses.configRoot, { recursive: true });
        }
      } finally {
        await Deno.remove(ctx.home, { recursive: true });
      }
    });
  }
}
