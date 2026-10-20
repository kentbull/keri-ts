/** Public hosted TEL endorsement and independent pinned-main observer acceptance. */
import { concatBytes, Diger, NumDex, parseBytes, Seqner, type Siger, t } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { createProtocolHandler } from "../../../../tufa/src/http/protocol-handler.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { acceptedEventReplayMessage, createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { attachmentCounterQb64b } from "../../../src/core/attachment-countering.ts";
import { incept } from "../../../src/core/protocol-vdr-eventing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import {
  createInteropContext,
  randomPort,
  runCmd,
  spawnChild,
  withStartedChild,
  writeAgentConfig,
} from "./interop-test-helpers.ts";
import { introduce, post } from "./ipex-witness-helpers.ts";

/** Bound observation wait; the assertion reads actual received protocol evidence. */
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for hosted backer evidence");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

Deno.test("interop/backers - public agent persists a partial endorsement across restart and completes Python-observed quorum", async () => {
  assertEquals(Deno.env.get("KERIPY_INTEROP_PROFILE"), "main");
  const ctx = await createInteropContext();
  const port = randomPort(), backerUrl = `http://127.0.0.1:${port}/`;
  const store = { name: "backer-host", headDirPath: ctx.home, skipConfig: true };
  const backerPre = await run(function*() {
    const hby = yield* createHabery(store);
    try {
      return hby.makeHab("backer", undefined, { transferable: false }).pre;
    } finally {
      yield* hby.close();
    }
  });
  await writeAgentConfig(ctx.home, "backer-host", "backer", port);
  const start = () =>
    spawnChild(
      "deno",
      [
        "run",
        "-A",
        "packages/tufa/mod.ts",
        "agent",
        "--name",
        store.name,
        "--head-dir",
        ctx.home,
        "--config-dir",
        ctx.home,
        "--config-file",
        "backer-host",
        "--port",
        String(port),
        "--backer-alias",
        "backer",
      ],
      ctx.env,
      ctx.repoRoot,
    );
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: "backer-issuer", temp: true, skipConfig: true });
      const issuer = hby.makeHab("issuer");
      const withheld = hby.makeHab("withheld", undefined, { transferable: false });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      const handler = createProtocolHandler(runtime);
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
      const issuerUrl = `http://127.0.0.1:${server.addr.port}/`;
      const vcp = incept(issuer.pre, { baks: [withheld.pre, backerPre], toad: 2 });
      issuer.interact({ data: [{ i: vcp.pre, s: vcp.snh, d: vcp.said }] });
      assertEquals(issuer.kever!.sn, 1);
      const ordinal = new Uint8Array(16);
      ordinal[15] = 1;
      const source = {
        seqner: new Seqner({ code: NumDex.Huge, raw: ordinal }),
        saider: new Diger({ qb64: issuer.kever!.said }),
      };
      const telWire = (signatures: readonly Siger[] = []) =>
        concatBytes(
          vcp.raw,
          ...(signatures.length
            ? [attachmentCounterQb64b("WitnessIdxSigs", signatures.length), ...signatures.map((sig) => sig.qb64b)]
            : []),
          attachmentCounterQb64b("SealSourceCouples", 1),
          source.seqner.qb64b,
          source.saider.qb64b,
        );
      const request = telWire();
      const reger = runtime.vdr!.reger;
      try {
        yield* call(() =>
          withStartedChild(start(), port, async () => {
            await introduce(backerUrl, hby, issuer.pre);
            for (const wire of [issuer.makeEndRole(issuer.pre), issuer.makeLocScheme(issuerUrl), request]) {
              for (const frame of parseBytes(wire)) await post(backerUrl, frame);
            }
            await until(() => reger.tibs.get(dgKey(vcp.pre!, vcp.said!)).some((sig) => sig.index === 1));
            assertEquals(reger.tels.getOn(vcp.pre!, 0), null);
          })
        );
        const received = reger.tibs.get(dgKey(vcp.pre!, vcp.said!))[0].qb64;
        // The actual CLI host reopens its stores. Only the withheld contribution is new.
        const complete = telWire(withheld.sign(vcp.raw, true));
        yield* call(() =>
          withStartedChild(start(), port, async () => {
            for (const frame of parseBytes(complete)) await post(backerUrl, frame);
            await until(() => reger.tels.getOn(vcp.pre!, 0)?.qb64 === vcp.said);
          })
        );
        assertEquals(reger.tibs.get(dgKey(vcp.pre!, vcp.said!)).find((sig) => sig.index === 1)?.qb64, received);
        const reopened = yield* createHabery(store);
        const reopenedRuntime = yield* createAgentRuntime(reopened, new FetchHttpClient(), systemClock);
        try {
          const stored = reopenedRuntime.vdr!.reger;
          assertEquals(stored.tels.getOn(vcp.pre!, 0)?.qb64, vcp.said);
          assertEquals(stored.bens.getOn([backerPre, vcp.pre!], 0)?.qb64, vcp.said);
          assertEquals(stored.tibs.get(dgKey(vcp.pre!, vcp.said!)).find((sig) => sig.index === 1)?.qb64, received);
        } finally {
          yield* reopenedRuntime.close();
          yield* reopened.close();
        }
        const kel = [0, 1].map((sn) => t(acceptedEventReplayMessage(hby, issuer.pre, sn).message)).join("");
        const evidence = `${ctx.home}/backer-evidence.json`;
        yield* call(() =>
          Deno.writeTextFile(
            evidence,
            JSON.stringify({
              kel,
              tel: t(reger.cloneTvt(vcp.pre!, vcp.said!)),
              registry: vcp.said,
              backers: [withheld.pre, backerPre],
            }),
          )
        );
        const peer = fromFileUrl(new URL("../../fixtures/tel_backer_peer.py", import.meta.url));
        const checked = yield* call(() => runCmd(ctx.pythonCommand, [peer, evidence], ctx.env));
        assertEquals(checked.code, 0, checked.stderr);
        // Main currently prints backer diagnostics; the final line is the driver's assertion result.
        const accepted = JSON.parse(checked.stdout.trim().split("\n").at(-1)!);
        assertEquals(accepted, { registry: vcp.said, threshold: 2, backers: [withheld.pre, backerPre] });
      } finally {
        yield* call(() => server.shutdown());
        yield* call(() => handler.close?.());
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});
