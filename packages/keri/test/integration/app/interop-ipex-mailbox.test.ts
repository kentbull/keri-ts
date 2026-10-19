/** Witnessed TS IPEX conversations carried by a real KERIpy KRAM mailbox. */
import {
  collectPayload,
  Compactor,
  concatBytes,
  Counter,
  framePayload,
  Kinds,
  type MapperMap,
  parseBytes,
  Prefixer,
  SerderACDC,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { createProtocolHandler } from "../../../../tufa/src/http/protocol-handler.ts";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { RegistryObserver } from "../../../src/acdc/observing.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  runAgentRuntimeUntil,
  runtimeOobiTerminalState,
} from "../../../src/app/agent-runtime.ts";
import { requestFrame } from "../../../src/app/cesr-egress.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex-building.ts";
import { consumeMailboxSse } from "../../../src/app/mailbox-sse.ts";
import { WitnessReceiptor } from "../../../src/app/witnessing.ts";
import { query, reply } from "../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { loadNests } from "../../../src/db/exchange-nests.ts";
import {
  createInteropContext,
  randomPort,
  spawnChild,
  startKeriPyWitnessHarness,
  withStartedChild,
} from "./interop-test-helpers.ts";
import { assertKeriPyWitnessStores } from "./interop-witness-helpers.ts";
import {
  accepted,
  anchor,
  inspectMailbox,
  introduce,
  introduceProvider,
  nonce,
  post,
  signed,
} from "./ipex-witness-helpers.ts";

const PYTHON_PEER = fromFileUrl(new URL("../../fixtures/kram-mailbox-peer.py", import.meta.url));

for (const count of [1, 2]) {
  Deno.test(`IPEX mailbox: ${count}-signer TS holder, KERIpy provider and three witnesses, apply through admit`, async () => {
    const ctx = await createInteropContext(), aliases = ["wan", "wil", "wes"];
    try {
      const witnesses = await startKeriPyWitnessHarness(ctx, { aliases });
      try {
        const port = randomPort(), mailboxUrl = `http://127.0.0.1:${port}/`;
        const provider = spawnChild(
          ctx.pythonCommand,
          [PYTHON_PEER, String(port), "1", `${ctx.home}/mailbox`],
          ctx.env,
          ctx.repoRoot,
        );
        await withStartedChild(provider, port, async () => {
          const providerPre = (await inspectMailbox(mailboxUrl, "unknown-controller")).provider;
          await run(function*() {
            const hbys: Habery[] = [], runtimes: AgentRuntime[] = [];
            const listeners: {
              server: Deno.HttpServer<Deno.NetAddr>;
              handler: ReturnType<typeof createProtocolHandler>;
            }[] = [];
            try {
              for (let i = 0; i < count + 2; i++) {
                const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
                hbys.push(hby);
                runtimes.push(
                  yield* createAgentRuntime(hby, {
                    kram: { enabled: true, caches: { "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000] } },
                  }),
                );
              }
              const [issuerHby, receiverHby, ...holderHbys] = hbys;
              const [issuerRuntime, receiverRuntime, ...holderRuntimes] = runtimes;
              const wit = { wits: witnesses.nodes.map((node) => node.pre), toad: 2 };
              const issuer = issuerHby.makeHab("issuer", undefined, wit);
              const receiver = receiverHby.makeHab("receiver", undefined, wit);
              const members = holderHbys.map((hby) => hby.makeHab("member", undefined, count === 1 ? wit : {}));
              let holders = members;
              if (count === 2) {
                const inceptions = holderHbys.map((hby, i) =>
                  acceptedEventReplayMessage(hby, members[i].pre, 0).message
                );
                for (const [i, runtime] of holderRuntimes.entries()) {
                  yield* runtime.reactor.processBytes(inceptions[1 - i]);
                }
                const mids = members.map((hab) => hab.pre);
                const groups = holderHbys.map((hby, i) =>
                  hby.makeGroupHab("holder", members[i], mids, mids, undefined, { isith: "2", nsith: "2", ...wit })
                );
                for (const [i, runtime] of holderRuntimes.entries()) {
                  yield* runtime.reactor.processBytes(groups[1 - i].message);
                  runtime.hby.kevery.processEscrows();
                  assertExists(groups[i].hab.kever);
                }
                holders = groups.map(({ hab }) => hab);
              }
              const holder = holders[0], holderRuntime = holderRuntimes[0];
              for (
                const [runtime, hab] of [[issuerRuntime, issuer], [receiverRuntime, receiver], [
                  holderRuntime,
                  holder,
                ]] as const
              ) {
                for (const node of witnesses.nodes) runtime.oobiery.resolve(node.controllerOobi);
                const oobis = [
                  ...witnesses.nodes.map((node) => node.controllerOobi),
                  `${mailboxUrl}oobi/${providerPre}/controller`,
                ];
                runtime.oobiery.resolve(oobis.at(-1)!);
                yield* runAgentRuntimeUntil(
                  runtime,
                  () => oobis.every((url) => runtimeOobiTerminalState(runtime, url).status !== "pending"),
                  { hab: runtime === holderRuntime ? members[0] : hab, timeoutMs: 20_000, pollMailbox: false },
                );
                for (const url of oobis) assertEquals(runtimeOobiTerminalState(runtime, url).status, "resolved", url);
                yield* new WitnessReceiptor(runtime.hby, { reactor: runtime.reactor, services: runtime.services })
                  .submit(hab.pre);
              }
              const registry = issuerRuntime.acdc!.makeRegistry("issuance", issuer.pre);
              const rip = issuerRuntime.acdc!.store.event(registry.regk!)!;
              yield* anchor(rip, [issuer], [issuerRuntime]);
              accepted(registry, rip);
              const credential = acdcmap(issuer.pre, {
                regid: rip.said!,
                uuid: nonce(),
                attribute: {
                  d: "",
                  u: nonce(),
                  i: holder.pre,
                  status: { d: "", u: nonce(), value: "citizen" },
                  private: { d: "", u: nonce(), value: "mailbox-secret" },
                },
              });
              const compact = new Compactor({
                mad: structuredClone(credential.sad!.a) as MapperMap,
                kind: Kinds.json,
                verify: false,
              });
              compact.compact(["a/status/"], "a");
              const partial = acdcmap(issuer.pre, {
                regid: rip.said!,
                uuid: credential.sad!.u as string,
                schema: credential.sad!.s as MapperMap,
                attribute: compact.partials!["a/status/"].mad,
              });
              assertEquals(partial.said, credential.said);
              const [proof, issued] = registry.blind(credential, "issued");
              const source = yield* anchor(issued, [issuer], [issuerRuntime]);
              accepted(registry, issued);

              const urls: string[] = [];
              for (const [i, runtime] of [receiverRuntime, ...holderRuntimes].entries()) {
                const handler = createProtocolHandler(runtime, { serviceHab: i === 0 ? receiver : holders[i - 1] });
                const observer = new RegistryObserver(runtime.hby.db, runtime.acdc!.store);
                const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
                  if (new URL(request.url).pathname !== "/_registry") return await handler(request);
                  for (const frame of parseBytes(await readCesrRequestBytes(request))) {
                    assertInstanceOf(frame.body, SerderACDC);
                    assertEquals(observer.processEvent(frame.body).kind, "accept");
                  }
                  return new Response(null, { status: 204 });
                });
                listeners.push({ server, handler });
                urls.push(`http://127.0.0.1:${server.addr.port}/`);
              }
              const [receiverUrl, ...holderUrls] = urls;
              const sources = [
                [issuerHby, issuer.pre],
                [receiverHby, receiver.pre],
                ...holderHbys.map((hby, i) => [hby, members[i].pre] as const),
                ...(count === 2 ? [[holderHbys[0], holder.pre] as const] : []),
              ] as const;
              for (const [hby, pre] of sources) {
                for (const url of urls) yield* call(() => introduce(url, hby, pre));
                yield* call(() => introduceProvider(mailboxUrl, hby, pre));
              }
              for (const url of urls) {
                for (const body of [rip, issued]) {
                  yield* call(() => post(`${url}_registry`, { body, attachments: [], gvrsn: Vrsn_2_0 }));
                }
              }
              for (const signers of [holders, [receiver]]) {
                const body = reply("/end/role/add", { cid: signers[0].pre, role: "mailbox", eid: providerPre }, {
                  pre: signers[0].pre,
                  pvrsn: Vrsn_2_0,
                });
                for (const url of [...urls, mailboxUrl]) yield* call(() => post(url, signed(body, signers)));
              }
              for (const hab of [issuer, receiver, holder]) {
                const state = yield* call(() => inspectMailbox(mailboxUrl, hab.pre));
                assertEquals(state.sender?.witnesses, wit.wits);
                assertEquals(state.sender?.threshold, 2);
                assertEquals(state.sender?.receipts, [0, 1, 2]);
              }
              const proofWire = Counter.enclose({
                code: "BlindedStateQuadruples",
                version: Vrsn_2_0,
                qb64: concatBytes(proof.d.qb64b, proof.u.qb64b, proof.td.qb64b, proof.ts.qb64b),
              });
              const [node] = parseBytes(
                messagize(
                  partial,
                  concatBytes(
                    proofWire,
                    ...messageAttachmentGroups({ sourceSeals: [source] }, Vrsn_2_0).map((g) => g.raw),
                  ),
                  { gvrsn: Vrsn_2_0, genusify: true },
                ),
              );
              const plan: [string, string, string[]][] = [[(credential.schema as { $id: string }).$id, "/", [
                "a/status/",
              ]]];
              const apply = ipexExnBody(receiver.pre, "/ipex/apply", [], {
                message: "apply",
                recipient: holder.pre,
                xid: credential.said!,
                plan,
              });
              const offer = ipexExnBody(holder.pre, "/ipex/offer", [partial], { message: "offer", prior: apply });
              const agree = ipexExnBody(receiver.pre, "/ipex/agree", [], { message: "agree", prior: offer });
              const grant = ipexExnBody(holder.pre, "/ipex/grant", [partial], { message: "grant", prior: agree });
              const admit = ipexExnBody(receiver.pre, "/ipex/admit", [], { message: "admit", prior: grant });
              const cursors = new Map<string, number>();
              for (const body of [apply, offer, agree, grant, admit]) {
                const fromHolder = body.pre === holder.pre;
                const signers = fromHolder ? holders : [receiver];
                const destination = fromHolder ? receiver : holder;
                const recipientSigners = fromHolder ? [receiver] : holders;
                const destinationUrls = fromHolder ? [receiverUrl] : holderUrls;
                const originUrls = fromHolder ? holderUrls : [receiverUrl];
                const originRuntime = fromHolder ? holderRuntime : receiverRuntime;
                const sender = fromHolder ? members[0] : receiver;
                const nests = body === grant
                  ? [node]
                  : body === offer
                  ? [{ body: partial, attachments: [], gvrsn: Vrsn_2_0 }]
                  : [];
                for (const url of originUrls) yield* call(() => post(url, signed(body, signers, nests)));
                const contributions = body === grant ? signers.map((signer) => [signer]) : [signers];
                for (const [index, contribution] of contributions.entries()) {
                  const frame = signed(body, contribution, nests);
                  const message = yield* call(() => collectPayload(framePayload(frame)));
                  assertEquals(
                    destination.db.exns.get(body.said!),
                    null,
                    "recipient has not received this IPEX message yet",
                  );
                  const delivered = yield* call(function*() {
                    const postman = originRuntime.poster;
                    yield* spawn(() => postman.deliverDo());
                    const evt = postman.send({
                      src: sender.pre,
                      dest: destination.pre,
                      topic: "/credential",
                      msg: message,
                      delivery: "indirect",
                    }, { notify: true });
                    const outcome = yield* postman.wait(evt);
                    if (outcome.kin === "failed") throw outcome.error;
                    return outcome;
                  });
                  assertEquals(delivered.deliveries, [mailboxUrl]);
                  const qry = query("mbx", {
                    i: destination.pre,
                    src: providerPre,
                    topics: { "/credential": cursors.get(destination.pre) ?? 0 },
                  }, { pre: destination.pre, pvrsn: Vrsn_2_0 });
                  const [queryFrame] = parseBytes(
                    messagize(qry, {
                      sigers: recipientSigners.flatMap((hab) => hab.sign(qry.raw, true)),
                      seal: { i: new Prefixer({ qb64: destination.pre }) },
                      gvrsn: Vrsn_2_0,
                      genusify: true,
                    }),
                  );
                  const response = yield* requestFrame(mailboxUrl, queryFrame, { signal: AbortSignal.timeout(10_000) });
                  assertEquals(response.status, 200);
                  let received = false;
                  yield* consumeMailboxSse(response, new AbortController(), function*(event) {
                    const [forwarded] = parseBytes(event.msg);
                    assertEquals(forwarded.body.raw, body.raw);
                    assertEquals(new TextDecoder().decode(event.msg).includes("mailbox-secret"), false);
                    for (const url of destinationUrls) yield* call(() => post(url, forwarded));
                    cursors.set(destination.pre, event.idx + 1);
                    received = true;
                    return false;
                  }, { idleTimeoutMs: 2000, maxDurationMs: 5000 });
                  assertEquals(received, true, "the mailbox yielded the signed IPEX payload");
                  const state = yield* call(() => inspectMailbox(mailboxUrl, destination.pre, [qry.said!]));
                  assertEquals(state.rows[0].cached, true, "KRAM authenticated the mailbox query");
                  assertEquals(state.rows[0].pending, false);
                  if (index < contributions.length - 1) {
                    assertExists(destination.db.pmkm.get([holder.pre, grant.said!]));
                    assertEquals(destination.db.exns.get(grant.said!), null, "one holder signature is insufficient");
                  }
                }
                for (const hby of [receiverHby, ...holderHbys]) {
                  assertExists(hby.db.exns.get(body.said!), `${body.route} accepted by ${hby.name}`);
                }
              }
              for (const hby of [receiverHby, ...holderHbys]) {
                assertEquals(hby.db.erpy.get(grant.said!)?.qb64, admit.said);
                const nodes = loadNests(hby.db, grant.said!);
                assertEquals(nodes.length, 1);
                assertEquals(nodes[0].body.said, credential.said);
                assertEquals(new TextDecoder().decode(nodes[0].body.raw).includes("mailbox-secret"), false);
                assertEquals(
                  hby.db.exns.get(credential.said!),
                  null,
                  "the enclosing grant never independently dispatches its credential",
                );
              }
              for (
                const [hby, hab] of [[issuerHby, issuer], [receiverHby, receiver], [holderHbys[0], holder]] as const
              ) {
                assertEquals(hby.db.wigs.get([hab.pre, hab.kever!.said]).map((sig) => sig.index).sort(), [0, 1, 2]);
                yield* call(() => assertKeriPyWitnessStores(ctx, witnesses, aliases, hab.pre, hab.kever!.sn, 3));
              }
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
