/** Native main proof APIs in both directions; TS intake uses the ordinary HTTP listener. */
import { b, BlindState, makeBlindState, parseBytes, SerderACDC, t, Vrsn_2_0 } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { createProtocolHandler } from "../../../../tufa/src/http/protocol-handler.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { vet, vetBinds } from "../../../src/acdc/regeventing.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { createInteropContext, runCmd } from "./interop-test-helpers.ts";
import { post } from "./ipex-witness-helpers.ts";

const peer = fromFileUrl(new URL("../../fixtures/native_registry_peer.py", import.meta.url));
/** Public native bodies, signed KEL replay and one intentionally disclosed opening; no shared database. */
interface NativeEvidence {
  rip: string;
  update: string;
  credential: string;
  opening: { d: string; u: string; td: string; ts: string };
  kel: string;
}

Deno.test("interop/native-registry - Python evidence reaches ordinary TS intake and survives reopen", async () => {
  assertEquals(Deno.env.get("KERIPY_INTEROP_PROFILE"), "main");
  const ctx = await createInteropContext();
  const options = { name: "native-observer", headDirPath: ctx.home, skipConfig: true };
  try {
    const result = await runCmd(ctx.pythonCommand, [peer, "author"], ctx.env);
    assertEquals(result.code, 0, result.stderr);
    const evidence: NativeEvidence = JSON.parse(result.stdout);
    const rip = new SerderACDC({ raw: b(evidence.rip) });
    const update = new SerderACDC({ raw: b(evidence.update) });
    const acdc = new SerderACDC({ raw: b(evidence.credential) });
    const blinder = BlindState.fromSad(evidence.opening);
    await run(function*() {
      const hby = yield* createHabery(options);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      const handler = createProtocolHandler(runtime);
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
      const url = `http://127.0.0.1:${server.addr.port}/`;
      try {
        for (const frame of parseBytes(b(evidence.kel))) yield* call(() => post(url, frame));
        for (const body of [rip, update]) {
          yield* call(() => post(url, { body, attachments: [], gvrsn: Vrsn_2_0 }));
        }
        assertEquals(runtime.acdc!.store.head(rip.said!)?.qb64, update.said);
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
        assertEquals(store.head(rip.said!)?.qb64, update.said);
        const chain = { db: hby.db, rip: store.event(rip.said!)!, updates: [store.event(update.said!)!], acdc };
        const state = vet({ ...chain, blinder });
        assertEquals(state.kind, "verified");
        if (state.kind !== "verified") throw new Error("Expected verified native state");
        assertEquals(state.state.acdc, acdc.said);
        assertEquals(state.state.state, "issued");
        assertEquals(state.state.binding, "mutual");
        assertEquals(state.state.anchors.map(([sn]) => sn), [1, 2]);
        assertEquals(vetBinds({ ...chain, blinders: [blinder], target: acdc.said! }), state);
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
  assertEquals(Deno.env.get("KERIPY_INTEROP_PROFILE"), "main");
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
        const kel = [0, 1, 2].map((sn) => t(acceptedEventReplayMessage(hby, issuer.pre, sn, Vrsn_2_0).message)).join("");
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
