/** Native candidate proof APIs in both directions; TS intake uses the ordinary HTTP listener. */
import { createProtocolHandler, sourceRequest, SourceTrust } from "@keri-ts/hosting";
import {
  b,
  BlindState,
  BoundState,
  concatBytes,
  Counter,
  makeBlindState,
  parseBytes,
  SerderACDC,
  t,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, sleep } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { createObservationBaser, Observer } from "../../../../observer/mod.ts";
import {
  author as serviceAuthor,
  certificate,
  kel as serviceKel,
  serveTls,
  signed as serviceSigned,
} from "../../../../observer/test/fixtures/service.ts";
import { Registrar } from "../../../../registrar/mod.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { vet, vetBinds } from "../../../src/acdc/regeventing.ts";
import { publicOpeningAttachment } from "../../../src/acdc/registering.ts";
import { essrEnvelope } from "../../../src/app/exchanges/essr.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/identity/habbing.ts";
import { envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import { createAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import {
  createInteropContext,
  randomPort,
  readChildOutput,
  runCmd,
  spawnChild,
  type SpawnedChild,
  stopChild,
} from "./interop-test-helpers.ts";
import { post } from "./ipex-witness-helpers.ts";

const peer = fromFileUrl(new URL("../../fixtures/native_registry_peer.py", import.meta.url));
/** Public native bodies, signed KEL replay and one intentionally disclosed opening; no shared database. */
interface NativeEvidence {
  rip: string;
  update: string;
  publicUpdate: string;
  laterUpdate: string;
  credential: string;
  opening: { d: string; u: string; td: string; ts: string; bn: string; bd: string };
  kel: string;
}

Deno.test("interop/native-registry - Python evidence reaches ordinary TS intake and survives reopen", async () => {
  assertEquals(Deno.env.get("KERIPY_INTEROP_PROFILE"), "candidate");
  const ctx = await createInteropContext();
  const options = { name: "native-observer", headDirPath: ctx.home, skipConfig: true };
  try {
    const result = await runCmd(ctx.pythonCommand, [peer, "author"], ctx.env);
    assertEquals(result.code, 0, result.stderr);
    const evidence: NativeEvidence = JSON.parse(result.stdout);
    const rip = new SerderACDC({ raw: b(evidence.rip) });
    const update = new SerderACDC({ raw: b(evidence.update) });
    const later = new SerderACDC({ raw: b(evidence.laterUpdate) });
    const acdc = new SerderACDC({ raw: b(evidence.credential) });
    const blinder = BoundState.fromSad(evidence.opening);
    const [published] = parseBytes(b(evidence.publicUpdate));
    assertEquals(BoundState.qb64(envelopeFromFrame(published).bsss[0]), BoundState.qb64(blinder));
    assertEquals(blinder.d.code, "I", "Python author exercises the SHA-256 opening boundary");
    await run(function*() {
      const hby = yield* createHabery(options);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      const handler = createProtocolHandler(runtime);
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
      const url = `http://127.0.0.1:${server.addr.port}/`;
      try {
        for (const frame of parseBytes(b(evidence.kel))) yield* call(() => post(url, frame));
        for (
          const frame of [{ body: rip, attachments: [], gvrsn: Vrsn_2_0 }, published, {
            body: later,
            attachments: [],
            gvrsn: Vrsn_2_0,
          }]
        ) {
          yield* call(() => post(url, frame));
        }
        assertEquals(runtime.acdc!.store.head(rip.said!)?.qb64, later.said);
        assertEquals(t(runtime.acdc!.store.event(update.said!)!.raw), evidence.update);
      } finally {
        yield* call(() => server.shutdown());
        yield* call(() => handler.close?.());
        yield* runtime.close();
        yield* hby.close();
      }
    });
    await run(function*() {
      const hby = yield* createHabery(options);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const store = runtime.acdc!.store;
        assertEquals(store.head(rip.said!)?.qb64, later.said);
        assertEquals(store.opening(update.said!), publicOpeningAttachment(blinder), "published proof survives reopen");
        assertEquals(store.opening(later.said!), null, "opaque suffix stays private");
        const replayed = parseBytes(store.cloneTel(rip.said!));
        assertEquals(BoundState.qb64(envelopeFromFrame(replayed[1]).bsss[0]), BoundState.qb64(blinder));
        const chain = {
          db: hby.db,
          rip: store.event(rip.said!)!,
          updates: [store.event(update.said!)!, store.event(later.said!)!],
          acdc,
        };
        assertEquals(
          vetBinds({ ...chain, blinders: [blinder], target: acdc.said! }).kind,
          "missing",
          "current standing remains opaque",
        );
        const state = vetBinds({ ...chain, at: update.said!, blinders: [blinder], target: acdc.said! });
        assertEquals(state.kind, "verified");
        if (state.kind !== "verified") throw new Error("Expected verified native state");
        assertEquals(state.state.acdc, acdc.said);
        assertEquals(state.state.state, "issued");
        assertEquals(state.state.binding, "mutual");
        assertEquals(state.state.anchors.map(([sn]) => sn), [1, 2]);
        assertEquals(vet({ ...chain, updates: [update], blinder }), state);
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("interop/native-registry - Python vets TS native evidence against an independently parsed KEL", async () => {
  assertEquals(Deno.env.get("KERIPY_INTEROP_PROFILE"), "candidate");
  const ctx = await createInteropContext();
  try {
    const evidence = await run(function*() {
      const hby = yield* createHabery({ name: "native-author", temp: true, skipConfig: true });
      try {
        const issuer = hby.makeHab("issuer");
        const rip = regcept(issuer.pre);
        issuer.interact({ data: [{ i: rip.said, s: "0", d: rip.said }] });
        const acdc = acdcmap(issuer.pre, { regid: rip.said, attribute: { d: "", name: "Ada" } });
        const opening = makeBlindState({ acdc: acdc.said!, state: "issued" });
        const update = blindate(rip.said!, rip.said!, opening.d.nonce);
        issuer.interact({ data: [{ i: rip.said, s: "1", d: update.said }] });
        const kel = [0, 1, 2].map((sn) => t(acceptedEventReplayMessage(hby, issuer.pre, sn, Vrsn_2_0).message)).join(
          "",
        );
        return {
          rip: t(rip.raw),
          update: t(update.raw),
          credential: t(acdc.raw),
          opening: BlindState.toSad(opening),
          kel,
        };
      } finally {
        yield* hby.close(true);
      }
    });
    const path = `${ctx.home}/native-evidence.json`;
    await Deno.writeTextFile(path, JSON.stringify(evidence));
    const result = await runCmd(ctx.pythonCommand, [peer, "verify", path], ctx.env);
    assertEquals(result.code, 0, result.stderr);
    const state = JSON.parse(result.stdout);
    assertEquals(state.regid, new SerderACDC({ raw: b(evidence.rip) }).said);
    assertEquals(state.said, new SerderACDC({ raw: b(evidence.update) }).said);
    assertEquals(state.acdc, new SerderACDC({ raw: b(evidence.credential) }).said);
    assertEquals(state.state, "issued");
    assertEquals(state.binding, "mutual");
    assertEquals(state.sn, 1);
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

for (const essr of [false, true]) {
  Deno.test({
    name:
      `interop/native-registry - signed encrypted salt replies derive exact openings after reciprocal reopen (ESSR=${essr})`,
    async fn() {
      assertEquals(Deno.env.get("KERIPY_INTEROP_PROFILE"), "candidate");
      const ctx = await createInteropContext();
      const { createWalletBaser, RegistrySaltService } = await import("../../../../wallet/mod.ts");
      const { RegistryCustody } = await import("../../../../wallet/src/custody.ts");
      const options = { name: "custody-ts", headDirPath: ctx.home, skipConfig: true, bran: "MyPasscodeARealSecret" };
      const requestPath = `${ctx.home}/custody-request.json`;
      let evidence: {
        saltReply: string;
        registry: string;
        controller: string;
        discloser: string;
        rip: string;
        credential: string;
        updates: string[];
        publicUpdate: string;
        kel: string;
        opening: NativeEvidence["opening"];
        future: string;
      };
      try {
        await run(function*() {
          const hby = yield* createHabery(options);
          const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
          const db = yield* createWalletBaser({ name: options.name, headDirPath: ctx.home });
          const handler = createProtocolHandler(runtime);
          const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
          try {
            const holder = hby.makeHab("holder"), root = `${ctx.home}/python`;
            yield* call(() => Deno.mkdir(root));
            yield* call(() =>
              Deno.writeTextFile(
                requestPath,
                JSON.stringify({
                  root,
                  essr,
                  discloser: holder.pre,
                  kel: t(acceptedEventReplayMessage(hby, holder.pre, 0, Vrsn_2_0).message),
                }),
              )
            );
            const result = yield* call(() => runCmd(ctx.pythonCommand, [peer, "custody", requestPath], ctx.env));
            assertEquals(result.code, 0, result.stderr);
            evidence = JSON.parse(result.stdout);
            const url = `http://127.0.0.1:${server.addr.port}/`;
            for (const frame of parseBytes(b(evidence.kel))) yield* call(() => post(url, frame));
            for (const raw of [evidence.rip, ...evidence.updates, evidence.publicUpdate]) {
              const frame = raw === evidence.publicUpdate ? parseBytes(b(raw))[0] : {
                body: new SerderACDC({ raw: b(raw) }),
                attachments: [],
                gvrsn: Vrsn_2_0,
              };
              yield* call(() => post(url, frame));
            }
            const store = runtime.acdc!.store, custody = new RegistryCustody({ hby, registry: store, db });
            const credential = new SerderACDC({ raw: b(evidence.credential) });
            const update = new SerderACDC({ raw: b(evidence.updates[0]) });
            assertEquals(store.head(evidence.registry)!.qb64, parseBytes(b(evidence.publicUpdate))[0].body.said);
            assertThrows(
              () => custody.derive(evidence.registry, 1, credential.said!, "issued"),
              Error,
              "not provisioned",
            );
            const saltService = new RegistrySaltService(custody, runtime.protocol.rvy);
            saltService.register();
            saltService.registerEnvelope(holder, runtime.exc, runtime.reactor);
            // The ordinary HTTP parser and Revery authenticate the foreign issuer.
            for (const frame of parseBytes(b(evidence.saltReply))) yield* call(() => post(url, frame));
            const opening = custody.derive(evidence.registry, 1, credential.said!, "issued", {
              bound: true,
              bsn: holder.kever!.sn,
              bd: holder.kever!.serder.said!,
            });
            assertEquals(BoundState.qb64(opening as BoundState), BoundState.qb64(BoundState.fromSad(evidence.opening)));
            custody.retainDerivedUpdate(update, opening);
            assertEquals(store.opening(update.said!), null, "custody never publishes its derived opening");
            const state = vet({
              db: hby.db,
              rip: store.seqEvent(evidence.registry, 0)!,
              updates: [update],
              acdc: credential,
              blinder: opening,
            });
            assertEquals(state.kind, "verified");
            assertEquals(
              BlindState.qb64(custody.derive(evidence.registry, 17, credential.said!, "revoked") as BlindState),
              evidence.future,
            );
            const issuer = holder;
            const registry = runtime.acdc!.makeRegistry("reverse-handoff", issuer.pre);
            const rip = store.event(registry.regk!)!;
            issuer.interact({ data: [{ i: registry.regk, s: "0", d: rip.said }] });
            assertEquals(registry.anchorMsg(rip.said!).kind, "accept");
            const info = custody.createCustody(registry.regk!, evidence.controller);
            const reverseCredential = acdcmap(issuer.pre, {
              regid: registry.regk!,
              attribute: { d: "", i: info.discloser, role: "reverse-custody-holder" },
            });
            const issuee = hby.db.getKever(info.discloser)!;
            const bound = { bound: true, bsn: issuee.sn, bd: issuee.serder.said! };
            const reverseOpening = custody.derive(
              registry.regk!,
              1,
              reverseCredential.said!,
              "issued",
              bound,
            ) as BoundState;
            const reverseUpdate = blindate(registry.regk!, rip.said!, reverseOpening.d.nonce);
            custody.retainDerivedUpdate(reverseUpdate, reverseOpening);
            assertEquals(registry.processEvent(reverseUpdate).kind, "escrow");
            issuer.interact({ data: [{ i: registry.regk, s: "1", d: reverseUpdate.said }] });
            assertEquals(registry.anchorMsg(reverseUpdate.said!).kind, "accept");
            assertEquals(store.opening(reverseUpdate.said!), null, "reverse custody is not public proof publication");
            const reverseReply = saltService.makeReply(issuer, registry.regk!, info.discloser);
            const reverse = {
              root: `${ctx.home}/python`,
              essr,
              saltReply: t(
                essr
                  ? essrEnvelope(
                    issuer,
                    issuer.endorse(reverseReply, { pipelined: false, gvrsn: Vrsn_2_0 }),
                    info.discloser,
                    hby.db.getKever(info.discloser)!.verfers[0],
                  )
                  : issuer.endorse(reverseReply),
              ),
              info,
              credential: t(reverseCredential.raw),
              update: reverseUpdate.said,
              bsn: Number(bound.bsn),
              bd: bound.bd,
              tel: t(store.cloneTel(registry.regk!)),
              kel: [0, 1, 2].map((sn) => t(acceptedEventReplayMessage(hby, issuer.pre, sn, Vrsn_2_0).message)).join(""),
            };
            const expected = {
              opening: BoundState.qb64(reverseOpening),
              future: BlindState.qb64(
                custody.derive(registry.regk!, 17, reverseCredential.said!, "revoked") as BlindState,
              ),
              update: reverseUpdate.said,
              state: "issued",
            };
            for (const receive of ["import", "reopen"]) {
              yield* call(() => Deno.writeTextFile(requestPath, JSON.stringify({ ...reverse, receive })));
              const result = yield* call(() => runCmd(ctx.pythonCommand, [peer, "custody", requestPath], ctx.env));
              assertEquals(result.code, 0, result.stderr);
              assertEquals(JSON.parse(result.stdout), expected, `TS custody survives Python ${receive}`);
            }
          } finally {
            yield* call(() => server.shutdown());
            yield* call(() => handler.close?.());
            yield* db.close();
            yield* runtime.close();
            yield* hby.close();
          }
        });
        await run(function*() {
          const hby = yield* createHabery(options);
          const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
          const db = yield* createWalletBaser({ name: options.name, headDirPath: ctx.home });
          try {
            const store = runtime.acdc!.store, custody = new RegistryCustody({ hby, registry: store, db });
            const update = new SerderACDC({ raw: b(evidence.updates[0]) });
            assertEquals(
              BoundState.qb64(custody.derivedOpening(update) as BoundState),
              BoundState.qb64(BoundState.fromSad(evidence.opening)),
            );
            assertEquals(store.opening(update.said!), null);
            const successor = parseBytes(b(evidence.publicUpdate))[0];
            assertEquals(store.head(evidence.registry)!.qb64, successor.body.said);
            assert(
              store.opening(successor.body.said!) !== null,
              "separately published public successor survives reopen",
            );
            const credential = new SerderACDC({ raw: b(evidence.credential) });
            assertEquals(
              BlindState.qb64(custody.derive(evidence.registry, 17, credential.said!, "revoked") as BlindState),
              evidence.future,
            );
          } finally {
            yield* db.close();
            yield* runtime.close();
            yield* hby.close();
          }
        });
      } finally {
        await Deno.remove(ctx.home, { recursive: true });
      }
    },
  });
}

/** The selected service sources are explicit candidate inputs, separate from their declared core pins. */
async function serviceReady(path: string, child: SpawnedChild) {
  let ended = false;
  void child.status.then(() => ended = true);
  for (let i = 0; i < 300; i++) {
    try {
      return JSON.parse(await Deno.readTextFile(path)) as { pre: string; kel: string; module: string };
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    if (ended) throw new Error(`Selected Python service ended before readiness: ${await readChildOutput(child)}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Selected Python service did not bind its TLS listener");
}

Deno.test("interop/native-registry - Python registrar publication reaches TS observer cache over TLS", async () => {
  const ctx = await createInteropContext();
  try {
    await run(function*() {
      const authorHby = yield* createHabery({ name: "service-author", headDirPath: ctx.home, skipConfig: true });
      const cacheHby = yield* createHabery({ name: "service-cache", headDirPath: ctx.home, skipConfig: true });
      const publisher = authorHby.makeHab("publisher"),
        observerHab = cacheHby.makeHab("observer"),
        reader = cacheHby.makeHab("reader");
      const evidence = serviceAuthor(publisher, "foreign-publication");
      const kram = {
        enabled: true,
        denials: [],
        caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] as const },
      };
      const runtime = yield* createAgentRuntime(cacheHby, new FetchHttpClient(), systemClock, { kram });
      const records = yield* createObservationBaser({ name: "service-observations", headDirPath: ctx.home });
      const port = randomPort(), ready = `${ctx.home}/registrar-ready.json`, input = `${ctx.home}/registrar.json`;
      const kel = t(concatBytes(serviceKel(publisher), serviceKel(observerHab)));
      yield* call(() =>
        Deno.writeTextFile(
          input,
          JSON.stringify({
            root: `${ctx.home}/python`,
            port,
            ready,
            certificate,
            bootstrap: kel,
            publishers: [publisher.pre],
            observers: [observerHab.pre],
          }),
        )
      );
      const child = spawnChild(ctx.pythonCommand, [peer, "registrar", input], ctx.env);
      try {
        const selected = yield* call(() => serviceReady(ready, child));
        assert(selected.module.endsWith("/registrar/src/kfregistrar/core/serving.py"), selected.module);
        const url = `https://127.0.0.1:${port}/`;
        const trust = new SourceTrust({ url, caFile: certificate, certName: "localhost" });
        const publication = new SourceTrust({ url: `${url}ingest`, caFile: certificate, certName: "localhost" });
        const published = yield* sourceRequest(
          publication,
          serviceSigned(publisher, "tels/publish", { stream: t(evidence.raw) }),
          2000,
        );
        assertEquals(published.status, 200, t(published.body));
        assertEquals(JSON.parse(t(published.body)).heads[evidence.rip.said!], evidence.update.said);
        const service = new Observer(runtime.protocol, runtime.acdc!.store, records, {
          sources: [{ url, caFile: certificate, certName: "localhost" }],
          readers: [reader.pre],
        });
        assertEquals(yield* service.pullOnce(observerHab, { timeoutMs: 2000 }), 1);
        const query = () =>
          service.handle(
            new Request("https://observer/", {
              method: "POST",
              headers: { "Content-Type": "application/cesr" },
              body: serviceSigned(reader, "tels", { i: evidence.rip.said! }).buffer as ArrayBuffer,
            }),
          );
        const response = yield* call(query);
        assertEquals(response.status, 200);
        const raw = new Uint8Array(yield* call(() => response.arrayBuffer()));
        assert(parseBytes(raw).some((frame) => frame.body.said === evidence.update.said));
        yield* cacheHby.ks.reopen();
        yield* cacheHby.db.reopen();
        yield* runtime.acdc!.baser.reopen();
        yield* records.reopen();
        assertEquals((yield* call(query)).status, 200);
        const wrong = yield* sourceRequest(
          trust,
          serviceSigned(observerHab, "tels/bulk", { i: "not-a-registry" }),
          2000,
        );
        assertEquals(wrong.status, 404);
      } finally {
        yield* call(() => stopChild(child));
        yield* records.close(true);
        yield* runtime.close();
        yield* cacheHby.close(true);
        yield* authorHby.close(true);
      }
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("interop/native-registry - TS registrar feeds selected Python observer scheduled TLS cache", async () => {
  const ctx = await createInteropContext();
  try {
    await run(function*() {
      const hostHby = yield* createHabery({ name: "service-host", headDirPath: ctx.home, skipConfig: true });
      const readerHby = yield* createHabery({ name: "service-reader", headDirPath: ctx.home, skipConfig: true });
      const issuer = hostHby.makeHab("issuer"), reader = readerHby.makeHab("reader");
      const evidence = serviceAuthor(issuer, "ts-source");
      const kram = {
        enabled: true,
        denials: [],
        caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] as const },
      };
      const runtime = yield* createAgentRuntime(hostHby, new FetchHttpClient(), systemClock, { kram });
      const readerRuntime = yield* createAgentRuntime(readerHby, new FetchHttpClient(), systemClock, { kram });
      yield* runtime.reactor.processBytes(evidence.raw);
      let registrar: Registrar | undefined;
      const sourceReplies: string[] = [];
      const pem = yield* call(() => Deno.readTextFile(certificate));
      const source = yield* call(() =>
        serveTls(pem, async (req) => {
          const response = await (registrar?.handle(req) ?? new Response("starting", { status: 503 }));
          sourceReplies.push(`${response.status}: ${response.status === 200 ? "CESR" : await response.clone().text()}`);
          return response;
        })
      );
      const port = randomPort(), ready = `${ctx.home}/observer-ready.json`, input = `${ctx.home}/observer.json`;
      yield* call(() =>
        Deno.writeTextFile(
          input,
          JSON.stringify({
            root: `${ctx.home}/python`,
            port,
            ready,
            certificate,
            source: `https://127.0.0.1:${source.addr.port}/`,
            readers: [reader.pre],
            bootstrap: t(serviceKel(reader)),
          }),
        )
      );
      const child = spawnChild(ctx.pythonCommand, [peer, "observer", input], ctx.env);
      try {
        const selected = yield* call(() => serviceReady(ready, child));
        assert(selected.module.endsWith("/observer/src/kfobserver/core/evidence.py"), selected.module);
        yield* runtime.reactor.processBytes(b(selected.kel));
        registrar = new Registrar(runtime.protocol, runtime.acdc!.store, {
          observers: [selected.pre],
          fullEvidence: true,
        });
        const trust = new SourceTrust({
          url: `https://127.0.0.1:${port}/`,
          caFile: certificate,
          certName: "localhost",
        });
        let response;
        for (let i = 0; i < 50; i++) {
          response = yield* sourceRequest(trust, serviceSigned(reader, "tels", { i: evidence.rip.said! }), 2000);
          if (response.status === 200) break;
          assert([404, 503].includes(response.status), `${response.status}: ${t(response.body)}`);
          yield* sleep(20);
        }
        assertEquals(response?.status, 200, sourceReplies.join("\n"));
        const received = yield* call(() =>
          new Registrar(readerRuntime.protocol, readerRuntime.acdc!.store).ingest(
            concatBytes(Counter.makeGVC(Vrsn_2_0), response!.body),
          )
        );
        assertEquals(received.rejected, {});
        assertEquals(received.pending, {});
        assertEquals(received.heads[evidence.rip.said!], evidence.update.said);
        assertEquals(t(readerRuntime.acdc!.store.event(evidence.update.said!)!.raw), t(evidence.update.raw));
        const wrong = yield* sourceRequest(trust, serviceSigned(reader, "tels", { i: "not-a-registry" }), 2000);
        assertEquals(wrong.status, 404);
      } finally {
        const output = yield* call(() => stopChild(child));
        if (output) console.log(output);
        yield* call(() => source.shutdown());
        yield* readerRuntime.close();
        yield* runtime.close();
        yield* readerHby.close(true);
        yield* hostHby.close(true);
      }
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});
