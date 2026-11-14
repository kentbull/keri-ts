/**
 * A registry event held for the issuer KEL event that anchors it makes its holder ask the issuer for that KEL, and the
 * issuer answers, between keri-ts and the pinned KERIpy candidate in both directions (run in Docker).
 *
 * The holder is given the issuer's inception and the registry inception, never the interaction that anchors it. The
 * only way the anchoring event can reach the holder is the issuer's answer to the holder's `logs` query, so each test
 * reads three facts from the peers' own owners: the issuer parsed a `logs` query for its KEL from the first event the
 * holder lacked, the issuer posted its log in answer, and the held event left the anchor escrow for the registry head.
 * The KERIpy fixture is packages/keri/test/fixtures/anchor_query_peer.py; the keri-ts peer is a runtime behind the
 * ordinary protocol handler with its host workers running.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import { parseBytes, Vrsn_2_0 } from "cesr-ts";
import { call, ensure, type Operation, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertExists } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { regcept } from "../../../src/acdc/messaging.ts";
import type { Hab, Habery } from "../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../src/app/identity/lmdb-habery.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../src/core/roles.ts";
import { createInteropContext, randomPort, spawnChild, stopChild } from "./interop-test-helpers.ts";
import { post } from "./ipex-witness-helpers.ts";
import { observed } from "./ipex/peers.ts";

const PEER = fromFileUrl(new URL("../../fixtures/anchor_query_peer.py", import.meta.url));

/** Coordinates a peer publishes. */
interface Info {
  pre: string;
  url: string;
}

/** What the KERIpy peer's own owners report. */
interface PeerSnapshot {
  known: Record<string, number>;
  queries: { route: string; q: Record<string, string>; said: string }[];
  posted: { why: string; said: string; ilk: string }[];
  held: string[];
  head: string | null;
}

/** The KERIpy fixture's control endpoint; it never reports a row the test supplied. */
class PythonPeer {
  constructor(readonly info: Info) {}

  async command<T>(action: string, args: object = {}): Promise<T> {
    const response = await fetch(new URL("_fixture", this.info.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, ...args }),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    assertEquals(response.status, 200, `${action}: ${text}`);
    return JSON.parse(text) as T;
  }

  snapshot(regk?: string): Promise<PeerSnapshot> {
    return this.command("snapshot", { regk: regk ?? null });
  }
}

/** Run the KERIpy fixture for one scenario; its output is kept for the failure message. */
async function withPythonPeer(body: (py: PythonPeer) => Promise<void>): Promise<void> {
  const context = await createInteropContext();
  const port = randomPort();
  const child = spawnChild(context.pythonCommand, [PEER, context.home, String(port)], context.env, context.repoRoot);
  const output = Promise.all([new Response(child.liveStdout).text(), new Response(child.liveStderr).text()]);
  let exited: Deno.CommandStatus | undefined;
  void child.status.then((status) => {
    exited = status;
  });
  let failure: { cause: unknown } | undefined;
  let diagnostics = "";
  try {
    const info = await observed("KERIpy listener", async () => {
      if (exited) throw new Error(`KERIpy exited ${exited.code}: ${(await output).join("\n")}`);
      try {
        return JSON.parse(await Deno.readTextFile(`${context.home}/ready.json`)) as Info;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return undefined;
        throw error;
      }
    });
    await body(new PythonPeer(info));
  } catch (error) {
    failure = { cause: error };
  } finally {
    diagnostics = await stopChild(child);
    await output;
    await Deno.remove(context.home, { recursive: true });
  }
  if (failure) throw new Error(`KERIpy anchor query fixture: ${diagnostics}`, failure);
}

/** A keri-ts runtime behind the ordinary protocol handler, with its host workers running. */
interface TypeScriptPeer {
  hby: Habery;
  hab: Hab;
  runtime: AgentRuntime;
  info: Info;
}

function* typeScriptPeer(name: string): Operation<TypeScriptPeer> {
  const hby = yield* createHabery({
    name: `${name}-${crypto.randomUUID()}`,
    temp: true,
    skipConfig: true,
    skipSignator: true,
  });
  yield* ensure(() => hby.close(true));
  const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
  yield* ensure(() => runtime.close());
  const handler = createProtocolHandler(runtime);
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
  yield* ensure(function*() {
    yield* call(() => server.shutdown());
    yield* call(() => handler.close?.());
  });
  const hab = hby.makeHab(name);
  yield* spawn(() => runAgentRuntime(runtime, { hab }));
  return { hby, hab, runtime, info: { pre: hab.pre!, url: `http://127.0.0.1:${server.addr.port}/` } };
}

/** Send our inception to the peer, which needs it to verify the signed query. */
function* introduceTo(ts: TypeScriptPeer, url: string): Operation<void> {
  const inception = ts.hab.kever!.serder;
  assertEquals(inception.sn, 0);
  const wire = messagize(inception, {
    sigers: ts.hab.sign(inception.raw, true),
    gvrsn: Vrsn_2_0,
    pipelined: true,
    genusify: true,
  });
  for (const frame of parseBytes(wire)) yield* call(() => post(url, frame));
}

/** Wait for a bounded condition on actual state; the label names what was awaited. */
function* until<T>(what: string, read: () => Promise<T | undefined> | T | undefined): Operation<T> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const value = yield* call(async () => await read());
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    yield* sleep(25);
  }
}

Deno.test("interop/anchor-query - keri-ts holder asks a KERIpy issuer for the missing anchor and accepts the registry", async () => {
  await withPythonPeer(async (py) => {
    await run(function*() {
      const ts = yield* typeScriptPeer("holder");
      yield* introduceTo(ts, py.info.url);
      yield* call(() => py.command("connect", { remote: ts.info }));
      yield* until("the holder to resolve the KERIpy issuer's KEL and controller endpoint", () => {
        const ends = ts.hab.endsFor(py.info.pre)[Roles.controller] ?? {};
        return ts.hby.db.getKever(py.info.pre) && Object.values(ends).some((urls) => urls.http) ? true : undefined;
      });
      const issued = yield* call(() => py.command<{ regk: string; rip: string; sn: number }>("issue", { extra: 1 }));
      assertEquals(issued.sn, 2, "the anchor is the issuer's second event after inception");
      yield* call(() => py.command("send_rip"));

      // The held event is accepted only after the issuer's answer carried the anchoring interaction.
      const store = ts.runtime.acdc!.store;
      yield* until(
        "the held registry inception to be accepted",
        () => store.head(issued.regk)?.qb64 === issued.rip ? true : undefined,
      );
      const answered = yield* call(() => py.snapshot());
      const logs = answered.queries.filter((query) => query.route === "logs");
      assertEquals(logs.length, 1, "one logs query, not one per retry");
      assertEquals(logs[0].q.fn, "1", "the replay starts at the first event the holder lacked");
      assertEquals(answered.posted.filter((sent) => sent.why === "replay").map((sent) => sent.ilk), ["ixn", "ixn"]);
      assertEquals(
        ts.hby.db.getKever(py.info.pre)?.sn,
        issued.sn,
        "the answer carried the issuer's log through the anchor",
      );
      assertEquals([...store.baser.maes.getAllItemIter()].length, 0, "the held event left the anchor escrow");
    });
  });
});

Deno.test("interop/anchor-query - KERIpy holder asks a keri-ts issuer for the missing anchor and accepts the registry", async () => {
  await withPythonPeer(async (py) => {
    await run(function*() {
      const ts = yield* typeScriptPeer("issuer");
      yield* introduceTo(ts, py.info.url);
      yield* call(() => py.command("connect", { remote: ts.info }));
      yield* until("the issuer to resolve the KERIpy holder's KEL and controller endpoint", () => {
        const ends = ts.hab.endsFor(py.info.pre)[Roles.controller] ?? {};
        return ts.hby.db.getKever(py.info.pre) && Object.values(ends).some((urls) => urls.http) ? true : undefined;
      });
      const known = yield* call(() => py.snapshot());
      assertEquals(known.known[ts.hab.pre!], 0, "the holder knows only the issuer's inception");

      ts.hab.interact({ data: [] });
      const rip = regcept(ts.hab.pre!);
      ts.hab.interact({ data: [{ i: rip.said, s: "0", d: rip.said }] });
      const anchor = ts.hab.kever!.sn;
      assertEquals(anchor, 2);
      yield* call(() => post(py.info.url, { body: rip, attachments: [], gvrsn: Vrsn_2_0 }));

      const regk = rip.said!;
      yield* until(
        "the held registry inception to be accepted",
        async () => (await py.snapshot(regk)).head === regk ? true : undefined,
      );
      const answered = yield* call(() => py.snapshot(regk));
      assertEquals(
        answered.posted.filter((sent) => sent.why === "anchor-query").length,
        1,
        "one logs query, not one per retry",
      );
      assertEquals(answered.known[ts.hab.pre!], anchor, "the answer carried the issuer's log through the anchor");
      assertEquals(answered.held, [], "the held event left the anchor escrow");
    });
  });
});
