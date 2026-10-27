/** Native candidate proof APIs in both directions; TS intake uses the ordinary HTTP listener. */
import { createProtocolHandler } from "@keri-ts/hosting";
import { b, BlindState, BoundState, makeBlindState, parseBytes, SerderACDC, t, Vrsn_2_0 } from "cesr-ts";
import { call, run } from "effection";
import { assert, assertEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { vet, vetBinds } from "../../../src/acdc/regeventing.ts";
import { publicOpeningAttachment } from "../../../src/acdc/registering.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/identity/habbing.ts";
import { envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import { createAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { createInteropContext, runCmd } from "./interop-test-helpers.ts";
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

Deno.test({
  name: "interop/native-registry - POSIX protected Python custody handoff derives exact openings after TS reopen",
  ignore: Deno.build.os === "windows",
  async fn() {
    assertEquals(Deno.env.get("KERIPY_INTEROP_PROFILE"), "candidate");
    const ctx = await createInteropContext();
    const { createWalletBaser } = await import("../../../../wallet/mod.ts");
    const { RegistryCustody } = await import("../../../../wallet/src/custody.ts");
    const options = { name: "custody-ts", headDirPath: ctx.home, skipConfig: true, bran: "MyPasscodeARealSecret" };
    const requestPath = `${ctx.home}/custody-request.json`, handoff = `${ctx.home}/custody.json`;
    let evidence: {
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
                handoff,
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
          yield* call(() =>
            assertRejects(
              () => custody.importCustody(handoff, { ...evidence, controller: holder.pre }),
              Error,
              "controller",
            )
          );
          yield* call(() => custody.importCustody(handoff, evidence));
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
          assert(store.opening(successor.body.said!) !== null, "separately published public successor survives reopen");
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
