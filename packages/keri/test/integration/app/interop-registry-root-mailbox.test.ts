/**
 * Registry root copies cross implementations over real KERIpy witness mailboxes.
 *
 * A KERIpy issuer sends its held root to a Tufa holder with `kli vc registry root
 * send`, and a Tufa issuer sends one to a KERIpy holder with `tufa vc registry
 * root send`. Each receiver starts `receive --listen` only after its whole KRAM
 * short-lag window has passed, so the late mailbox fetch relies on the built-in
 * `/registry/root` KRAM exemption. Each receive is a drain: the handler retains
 * the verifiable root automatically, with no approval step, and the command
 * reports it retained. Store setup (registry authoring and public TEL acceptance)
 * uses each implementation's library on the same store; delivery and listening
 * use the installed CLIs only.
 */
import { makeBlindState, MtrDex, Salter, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import type { Habery } from "../../../src/app/identity/habbing.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { WitnessReceiptor } from "../../../src/app/witness/receipting.ts";
import { setupHby } from "../../../src/cli/common/existing.ts";
import {
  createInteropContext,
  extractPrefix,
  type InteropContext,
  type KeriPyWitnessNode,
  requireSuccess,
  runCmdWithTimeout,
  runTufaWithTimeout,
  startKeriPyWitnessHarness,
} from "./interop-test-helpers.ts";
import { PASSCODE, queryKliPrefix, resolveWitnessesForKli, SALT } from "./interop-witness-helpers.ts";

const PEER = fromFileUrl(new URL("../../fixtures/registry_root_peer.py", import.meta.url));
/** Receiver KRAM: short-lag window 1 s + 5 s, exceeded before each receiver listens. */
const KRAM = { enabled: true, denials: [], caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } };
const KRAM_WINDOW_MS = 6_000;

/** Parse every JSON object line a command printed. */
function results(output: string): Record<string, unknown>[] {
  return output.split(/\r?\n/).map(line => line.trim()).filter(line => line.startsWith("{")).map(line =>
    JSON.parse(line)
  );
}

/** Run the KERIpy operator-side fixture and return its JSON result. */
async function peer(ctx: InteropContext, args: string[]): Promise<Record<string, unknown>> {
  const done = await requireSuccess(
    `registry root peer ${args[0]}`,
    runCmdWithTimeout(ctx.pythonCommand, [PEER, ...args, "--passcode", PASSCODE], ctx.env, 60_000),
  );
  return results(done.stdout).at(-1)!;
}

/** Open the Tufa store exactly as its CLI does, with one runtime, then close both. */
async function withTufaStore<T>(
  name: string,
  headDirPath: string,
  use: (hby: Habery, runtime: AgentRuntime) => Operation<T>,
): Promise<T> {
  return await run(function*() {
    const hby = yield* setupHby(name, "", PASSCODE, false, headDirPath, { skipConfig: false, compat: false });
    try {
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {});
      try {
        return yield* use(hby, runtime);
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close();
    }
  });
}

function witnessOobi(node: KeriPyWitnessNode, pre: string): string {
  return `${node.httpOrigin}/oobi/${pre}/witness/${node.pre}`;
}

Deno.test("Interop registry root: KERIpy and Tufa replicate roots to each other over witness mailboxes after the KRAM window", async () => {
  const ctx = await createInteropContext();
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-registry-root-" });
  const kli = { name: `kli-root-${crypto.randomUUID().slice(0, 8)}`, base: `root-${crypto.randomUUID().slice(0, 8)}` };
  const tufa = `tufa-root-${crypto.randomUUID().slice(0, 8)}`;
  const kliStore = ["--name", kli.name, "--base", kli.base, "--passcode", PASSCODE];
  const tufaStore = ["--name", tufa, "--head-dir", headDirPath, "--passcode", PASSCODE];
  const harness = await startKeriPyWitnessHarness(ctx, { aliases: ["wan", "wil", "wes"] });
  try {
    const witnesses = harness.activeWitnesses(3);
    const wits = witnesses.flatMap(node => ["--wits", node.pre]);
    const inception = ["--transferable", "--icount", "1", "--isith", "1", "--ncount", "1", "--nsith", "1"];

    // Encrypted KERIpy and Tufa controllers, each witnessed by the same KERIpy witnesses.
    await requireSuccess(
      "kli init",
      runCmdWithTimeout(ctx.kliCommand, ["init", ...kliStore, "--salt", SALT], ctx.env, 30_000),
    );
    await resolveWitnessesForKli(ctx.kliCommand, ctx.env, kli.name, kli.base, witnesses);
    const kliPre = extractPrefix(
      (await requireSuccess(
        "kli incept",
        runCmdWithTimeout(
          ctx.kliCommand,
          ["incept", ...kliStore, "--alias", "kli", ...inception, "--toad", "3", "--receipt-endpoint", ...wits],
          ctx.env,
          30_000,
        ),
      )).stdout,
    );
    await requireSuccess("tufa init", runTufaWithTimeout(["init", ...tufaStore], ctx.env, ctx.repoRoot, 30_000));
    for (const node of witnesses) {
      await requireSuccess(
        `tufa resolves ${node.alias}`,
        runTufaWithTimeout(
          ["oobi", "resolve", ...tufaStore, "--url", node.controllerOobi, "--oobi-alias", node.alias],
          ctx.env,
          ctx.repoRoot,
          30_000,
        ),
      );
    }
    const tufaPre = extractPrefix(
      (await requireSuccess(
        "tufa incept",
        runTufaWithTimeout(
          ["incept", ...tufaStore, "--alias", "tufa", ...inception, "--toad", "3", "--receipt-endpoint", ...wits],
          ctx.env,
          ctx.repoRoot,
          30_000,
        ),
      )).stdout,
    );

    // Both receivers run KRAM from their own store config, as an operator enables it.
    assertEquals((await peer(ctx, ["kram", "--name", kli.name, "--base", kli.base])).kram, KRAM);
    await withTufaStore(tufa, headDirPath, function*(hby) {
      hby.cf!.put({ ...hby.cf!.get(), kram: KRAM });
      assertEquals(hby.cf!.get().kram, KRAM);
    });

    // KERIpy issuer -> Tufa holder.
    const telA = `${headDirPath}/keripy-tel.json`;
    const authored = await peer(ctx, [
      "author",
      "--name",
      kli.name,
      "--base",
      kli.base,
      "--alias",
      "kli",
      "--recipient",
      tufaPre,
      "--tel",
      telA,
    ]);
    const registryA = authored.registry as string;
    for (const [label, store, oobi] of [["kli", kliStore, tufaPre], ["tufa", tufaStore, kliPre]] as const) {
      const command = label === "kli" ? ctx.kliCommand : Deno.execPath();
      const prefix = label === "kli" ? [] : ["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts"];
      const url = witnessOobi(witnesses[0], oobi);
      await requireSuccess(
        `${label} resolves its peer`,
        runCmdWithTimeout(
          command,
          [...prefix, "oobi", "resolve", ...store, label === "kli" ? "--oobi" : "--url", url, "--oobi-alias", "peer"],
          ctx.env,
          30_000,
          ctx.repoRoot,
        ),
      );
    }
    await withTufaStore(tufa, headDirPath, function*(hby, runtime) {
      for (const raw of JSON.parse(yield* call(() => Deno.readTextFile(telA))) as string[]) {
        yield* runtime.reactor.processBytes(new TextEncoder().encode(raw));
      }
      assertEquals(runtime.acdc!.store.headEvent(registryA)?.said, authored.event);
      assertEquals(hby.mgr.getRegistryRoot(tufaPre, registryA), null);
    });
    const sentA = results(
      (await requireSuccess(
        "kli root send",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            ...["vc", "registry", "root", "send", ...kliStore, "--alias", "kli", "--version", "2.0"],
            ...["--registry", registryA, "--recipient", tufaPre, "--acdc", authored.acdc as string, "--timeout", "45"],
          ],
          ctx.env,
          60_000,
        ),
      )).stdout,
    );
    assertEquals(sentA.map(item => [item.recipient, item.gid, item.transmitted]), [[tufaPre, tufaPre, true]]);
    // The Tufa holder is offline past its whole KRAM short-lag window.
    await new Promise(resolve => setTimeout(resolve, KRAM_WINDOW_MS + 2_000));
    const receivedA = results(
      (await requireSuccess(
        "tufa root receive --listen",
        runTufaWithTimeout(
          [
            ...["vc", "registry", "root", "receive", ...tufaStore, "--alias", "tufa"],
            ...["--registry", registryA, "--listen", "--timeout", "60"],
          ],
          ctx.env,
          ctx.repoRoot,
          90_000,
        ),
      )).stdout,
    );
    assertEquals(receivedA, [{ registry: registryA, phase: "listening" }, {
      gid: tufaPre,
      registry: registryA,
      retained: true,
    }]);
    await withTufaStore(tufa, headDirPath, function*(hby) {
      assertEquals(hby.mgr.getRegistryRoot(tufaPre, registryA)?.qb64, authored.root);
    });

    // Tufa issuer -> KERIpy holder.
    const telB = `${headDirPath}/tufa-tel.json`;
    const authoredB = await withTufaStore(tufa, headDirPath, function*(hby, runtime) {
      const hab = hby.habByName("tufa")!;
      const receiptor = new WitnessReceiptor(hby, runtime.protocol, runtime.http, runtime.clock);
      const rip = regcept(hab.pre!);
      const seal = function*(event: typeof rip, sn: number) {
        hab.interact({ data: [{ i: rip.said!, s: sn.toString(16), d: event.said! }], version: Vrsn_2_0 });
        yield* receiptor.submit(hab.pre!);
        yield* runtime.reactor.processBytes(event.raw);
      };
      yield* seal(rip, 0);
      const root = new Salter({ raw: crypto.getRandomValues(new Uint8Array(16)), code: MtrDex.Salt_128 });
      hab.mgr.putRegistryRoot(hab.pre!, rip.said!, root);
      const acdc = acdcmap(hab.pre!, { regid: rip.said!, attribute: { d: "", i: kliPre, role: "reader" } });
      const opening = makeBlindState({ salt: root.qb64, sn: 1, acdc: acdc.said!, state: "issued" });
      const event = blindate(rip.said!, rip.said!, opening.d.nonce);
      yield* seal(event, 1);
      assertEquals(runtime.acdc!.store.headEvent(rip.said!)?.said, event.said);
      const tel = [rip, event].map(node => new TextDecoder().decode(node.raw));
      yield* call(() => Deno.writeTextFile(telB, JSON.stringify(tel)));
      return { registry: rip.said!, acdc: acdc.said!, event: event.said!, root: root.qb64 };
    });
    await queryKliPrefix(ctx.kliCommand, ctx.env, kli.name, kli.base, "kli", tufaPre);
    const accepted = await peer(ctx, [
      "accept",
      "--name",
      kli.name,
      "--base",
      kli.base,
      "--issuer",
      tufaPre,
      "--registry",
      authoredB.registry,
      "--tel",
      telB,
    ]);
    assertEquals(accepted.head, authoredB.event);
    const sentB = results(
      (await requireSuccess(
        "tufa root send",
        runTufaWithTimeout(
          [
            ...["vc", "registry", "root", "send", ...tufaStore, "--alias", "tufa"],
            ...["--registry", authoredB.registry, "--recipient", kliPre, "--acdc", authoredB.acdc, "--timeout", "45"],
          ],
          ctx.env,
          ctx.repoRoot,
          60_000,
        ),
      )).stdout,
    );
    assertEquals(sentB.map(item => [item.recipient, item.gid, item.transmitted]), [[kliPre, kliPre, true]]);
    await new Promise(resolve => setTimeout(resolve, KRAM_WINDOW_MS + 2_000));
    const receivedB = results(
      (await requireSuccess(
        "kli root receive --listen",
        runCmdWithTimeout(
          ctx.kliCommand,
          [
            ...["vc", "registry", "root", "receive", ...kliStore, "--alias", "kli", "--version", "2.0"],
            ...["--registry", authoredB.registry, "--listen", "--timeout", "60"],
          ],
          ctx.env,
          90_000,
        ),
      )).stdout,
    ).at(-1)!;
    assertEquals(receivedB, { gid: kliPre, registry: authoredB.registry, retained: true });
    const retained = await peer(ctx, [
      "root",
      "--name",
      kli.name,
      "--base",
      kli.base,
      "--gid",
      kliPre,
      "--registry",
      authoredB.registry,
    ]);
    assertExists(retained.root);
    assertEquals(retained.root, authoredB.root);
  } finally {
    await harness.close();
    await Deno.remove(headDirPath, { recursive: true }).catch(() => {});
  }
});
