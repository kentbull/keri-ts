/**
 * Registry root copies cross implementations over real KERIpy witness mailboxes.
 *
 * A KERIpy issuer sends its held root to a Tufa holder with `kli vc registry root
 * send`, and a Tufa issuer sends one to a KERIpy holder with `tufa vc registry
 * root send`. Each receiver starts only after its whole KRAM short-lag window
 * has passed, so the late mailbox fetch relies on the built-in `/registry/root`
 * KRAM exemption. The Tufa holder runs no registry root command at all: a plain
 * `tufa agent` drains its credential mailbox and the runtime's registered
 * handler retains the root, which a later `receive` (no `--listen`) reports.
 * The KERIpy holder uses `receive --listen`, the optional convenience drain. Store setup (registry authoring and public TEL acceptance)
 * uses each implementation's library on the same store; delivery and listening
 * use the installed CLIs only.
 *
 * Three mixed-group stories follow, each over its own group of one KERIpy and
 * one Tufa member formed and anchored with the real multisig commands. In the
 * first two, the member holding the group root runs its implementation's
 * group issuance completion send (`rootreplicating.replicate`, Tufa
 * `sendRootCopies`) directly, and the other member retains the root from its
 * mailbox. A full mixed-member group DH issuance is not expressible here, so
 * the custodian's root, `bup` and opening come from store setup and the stories
 * do not prove that issuance completion invokes the send; each implementation's
 * own group issuance tests cover that. In the third, the Tufa custodian's
 * `tufa multisig rotate`, approved by `kli multisig join`, rekeys the KERIpy
 * member and re-seals the root to it automatically.
 */
import { makeBlindState, MtrDex, Salter, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { sendRootCopies } from "../../../../tufa/src/cli/commands/registry-root.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import type { Habery } from "../../../src/app/identity/habbing.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { WitnessReceiptor } from "../../../src/app/witness/receipting.ts";
import { setupHby } from "../../../src/cli/common/existing.ts";
import {
  type CmdResult,
  createInteropContext,
  extractPrefix,
  type InteropContext,
  type KeriPyWitnessNode,
  randomPort,
  requireSuccess,
  runCmdWithTimeout,
  runTufaWithTimeout,
  spawnChild,
  startKeriPyWitnessHarness,
  stopChild,
  waitForHealth,
  workspaceRoot,
  writeAgentConfig,
} from "./interop-test-helpers.ts";
import { PASSCODE, queryKliPrefix, resolveWitnessesForKli, SALT } from "./interop-witness-helpers.ts";
import { keripyProtocolVersionArgs } from "./keripy-runtime.ts";

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
    // No receive command: an ordinary agent host polls the mailbox and retains the root.
    const agentPort = randomPort();
    await writeAgentConfig(headDirPath, "tufa-agent", "tufa", agentPort);
    const agent = spawnChild(
      Deno.execPath(),
      [
        ...["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts", "agent", ...tufaStore],
        ...["--port", String(agentPort), "--config-dir", headDirPath, "--config-file", "tufa-agent"],
      ],
      ctx.env,
      workspaceRoot(),
    );
    let receivedA: Record<string, unknown>[] = [];
    try {
      await waitForHealth(agentPort);
      const deadline = Date.now() + 60_000;
      while (true) {
        const drained = await runTufaWithTimeout(
          ["vc", "registry", "root", "receive", ...tufaStore, "--alias", "tufa", "--registry", registryA],
          ctx.env,
          ctx.repoRoot,
          30_000,
        );
        receivedA = results(drained.stdout);
        if (drained.code === 0 || Date.now() > deadline) break;
        await new Promise(resolve => setTimeout(resolve, 1_000));
      }
    } finally {
      const output = await stopChild(agent);
      if (!receivedA.length) console.error(output);
    }
    assertEquals(receivedA, [{ gid: tufaPre, registry: registryA, retained: true }]);
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

/**
 * One mixed group: a passcode-encrypted KERIpy member and Tufa member, each
 * witnessed by the same KERIpy witness, form a v2 group with the real
 * `tufa multisig incept` and `kli multisig join` commands (the topology of
 * `interop-mixed-group-cli`), with signing and next thresholds of 2.
 */
interface MixedGroup {
  ctx: InteropContext;
  headDirPath: string;
  kli: { name: string; base: string };
  tufa: string;
  kliStore: string[];
  tufaStore: string[];
  versions: string[];
  kliPre: string;
  tsPre: string;
  group: string;
}

/** Run one mixed-group story over its own witness, stores and temporary directory. */
async function withMixedGroup(story: (group: MixedGroup) => Promise<void>): Promise<void> {
  const ctx = await createInteropContext();
  ctx.env.PYTHONUNBUFFERED = "1";
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-mixed-root-" });
  const kli = {
    name: `kli-group-${crypto.randomUUID().slice(0, 8)}`,
    base: `group-${crypto.randomUUID().slice(0, 8)}`,
  };
  const tufa = `tufa-group-${crypto.randomUUID().slice(0, 8)}`;
  const kliStore = ["--name", kli.name, "--base", kli.base, "--passcode", PASSCODE];
  const tufaStore = ["--name", tufa, "--head-dir", headDirPath, "--passcode", PASSCODE];
  const versions = keripyProtocolVersionArgs(ctx.env, "2.0");
  const harness = await startKeriPyWitnessHarness(ctx, { aliases: ["wan"] });
  try {
    const witness = harness.node("wan");
    await requireSuccess("kli init", runCmdWithTimeout(ctx.kliCommand, ["init", ...kliStore], ctx.env, 30_000));
    await requireSuccess(
      "kli resolves witness",
      runCmdWithTimeout(
        ctx.kliCommand,
        ["oobi", "resolve", ...kliStore, ...versions, "--oobi", witness.controllerOobi],
        ctx.env,
        30_000,
      ),
    );
    const config = `${headDirPath}/member.json`;
    await Deno.writeTextFile(
      config,
      JSON.stringify({
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 1,
        wits: [witness.pre],
      }),
    );
    const kliPre = extractPrefix(
      (await requireSuccess(
        "kli incept",
        runCmdWithTimeout(
          ctx.kliCommand,
          ["incept", ...kliStore, ...versions, "--alias", "kli", "--file", config, "--receipt-endpoint"],
          ctx.env,
          30_000,
        ),
      )).stdout,
    );
    await requireSuccess("tufa init", runTufaWithTimeout(["init", ...tufaStore], ctx.env, ctx.repoRoot, 30_000));
    await requireSuccess(
      "tufa resolves witness",
      runTufaWithTimeout(
        ["oobi", "resolve", ...tufaStore, "--url", witness.controllerOobi],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    const tsPre = extractPrefix(
      (await requireSuccess(
        "tufa incept",
        runTufaWithTimeout(
          [
            ...["incept", ...tufaStore, "--version", "2.0", "--alias", "tufa", "--transferable"],
            ...["--icount", "1", "--ncount", "1", "--toad", "1", "--wits", witness.pre, "--receipt-endpoint"],
          ],
          ctx.env,
          ctx.repoRoot,
          30_000,
        ),
      )).stdout,
    );
    await requireSuccess(
      "tufa introduces the KERIpy member",
      runTufaWithTimeout(
        ["oobi", "resolve", ...tufaStore, "--url", witnessOobi(witness, kliPre), "--oobi-alias", "kli"],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    await requireSuccess(
      "kli introduces the Tufa member",
      runCmdWithTimeout(
        ctx.kliCommand,
        ["oobi", "resolve", ...kliStore, ...versions, "--oobi", witnessOobi(witness, tsPre), "--oobi-alias", "tufa"],
        ctx.env,
        30_000,
      ),
    );
    const groupConfig = `${headDirPath}/group.json`;
    await Deno.writeTextFile(
      groupConfig,
      JSON.stringify({
        aids: [tsPre, kliPre],
        rmids: [tsPre, kliPre],
        isith: "2",
        nsith: "2",
        toad: 1,
        wits: [witness.pre],
      }),
    );
    const [proposed, joined] = await settled(
      "group inception",
      runTufaWithTimeout(
        [
          ...["multisig", "incept", ...tufaStore, "--version", "2.0", "--alias", "tufa", "--group", "group"],
          ...["--file", groupConfig, "--approval-timeout", "60", "--receipt-endpoint"],
        ],
        ctx.env,
        ctx.repoRoot,
        90_000,
      ),
      runCmdWithTimeout(
        ctx.kliCommand,
        ["multisig", "join", ...kliStore, ...versions, "--group", "group", "--auto"],
        ctx.env,
        90_000,
      ),
    );
    const group = results(proposed.stdout).at(-1)!;
    assertEquals(group.accepted, true, proposed.stdout);
    assertEquals(joined.stdout.includes(String(group.group)), true, joined.stdout);
    await story({
      ctx,
      headDirPath,
      kli,
      tufa,
      kliStore,
      tufaStore,
      versions,
      kliPre,
      tsPre,
      group: String(group.group),
    });
  } finally {
    await harness.close();
    await Deno.remove(headDirPath, { recursive: true }).catch(() => {});
  }
}

/** Run two concurrent commands that must both succeed, as a proposer and an approver. */
async function settled(
  label: string,
  first: Promise<CmdResult>,
  second: Promise<CmdResult>,
): Promise<[CmdResult, CmdResult]> {
  const done = await Promise.allSettled([first, second]);
  const report = done.map(outcome =>
    outcome.status === "rejected"
      ? String(outcome.reason)
      : `exit ${outcome.value.code}\n${outcome.value.stdout}\n${outcome.value.stderr}`
  );
  if (done.some(outcome => outcome.status === "rejected" || outcome.value.code !== 0)) {
    throw new Error(`${label} failed:\n${report.join("\n---\n")}`);
  }
  return done.map(outcome => (outcome as PromiseFulfilledResult<CmdResult>).value) as [CmdResult, CmdResult];
}

/**
 * Anchor seals in the group KEL with one real mixed interaction: the KERIpy
 * member proposes it with `kli multisig interact` and the Tufa member approves
 * it with `tufa multisig join`, the reciprocal direction proven by
 * `interop-mixed-group-cli`, whichever member authored the sealed events.
 */
async function anchorInGroup(group: MixedGroup, seals: Record<string, unknown>[]): Promise<void> {
  const { ctx } = group;
  const [approved] = await settled(
    "group anchor",
    runTufaWithTimeout(
      [
        ...["multisig", "join", ...group.tufaStore, "--group", "group", "--auto"],
        ...["--approval-timeout", "60", "--receipt-endpoint"],
      ],
      ctx.env,
      ctx.repoRoot,
      90_000,
    ),
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "multisig",
        "interact",
        ...group.kliStore,
        ...group.versions,
        "--alias",
        "group",
        "--data",
        JSON.stringify(seals),
      ],
      ctx.env,
      90_000,
    ),
  );
  assertEquals(results(approved.stdout).at(-1)!.accepted, true, approved.stdout);
}

/** Run the KERIpy fixture and return every JSON line it printed. */
async function peerLines(ctx: InteropContext, args: string[]): Promise<Record<string, unknown>[]> {
  const done = await requireSuccess(
    `registry root peer ${args[0]}`,
    runCmdWithTimeout(ctx.pythonCommand, [PEER, ...args, "--passcode", PASSCODE], ctx.env, 120_000),
  );
  return results(done.stdout);
}

/**
 * KERIpy holds the group registry root as DH custodian would: it authors the
 * group `rip` and root-blinded `bup`, both anchored through the mixed group KEL,
 * and retains the `bup` opening. The Tufa member accepts the public TEL only.
 */
async function keripyCustodian(group: MixedGroup) {
  const { ctx, kli } = group;
  const store = ["--name", kli.name, "--base", kli.base, "--alias", "group"];
  const staged = await peer(ctx, ["group-registry", ...store]);
  const registry = staged.registry as string;
  await anchorInGroup(group, [staged.seal as Record<string, unknown>]);
  const issued = await peer(ctx, ["group-issue", ...store, "--registry", registry, "--recipient", group.tsPre]);
  await anchorInGroup(group, [issued.seal as Record<string, unknown>]);
  const tel = `${group.headDirPath}/keripy-group-tel.json`;
  const published = await peer(ctx, [
    "group-publish",
    ...store,
    ...["--registry", registry, "--acdc", issued.acdc as string, "--event", issued.event as string, "--tel", tel],
  ]);
  assertEquals(published.gid, group.group);
  await withTufaStore(group.tufa, group.headDirPath, function*(hby, runtime) {
    for (const raw of JSON.parse(yield* call(() => Deno.readTextFile(tel))) as string[]) {
      yield* runtime.reactor.processBytes(new TextEncoder().encode(raw));
    }
    assertEquals(runtime.acdc!.store.headEvent(registry)?.said, issued.event);
    assertEquals(hby.mgr.getRegistryRoot(group.group, registry), null, "only the custodian holds the root");
  });
  return { registry, root: published.root as string };
}

/** Start a plain `tufa agent` and wait until `receive` reports the group root retained. */
async function tufaAgentRetains(group: MixedGroup, registry: string): Promise<Record<string, unknown>[]> {
  const { ctx } = group;
  const agentPort = randomPort();
  await writeAgentConfig(group.headDirPath, "tufa-agent", "tufa", agentPort);
  const agent = spawnChild(
    Deno.execPath(),
    [
      ...["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts", "agent", ...group.tufaStore],
      ...["--port", String(agentPort), "--config-dir", group.headDirPath, "--config-file", "tufa-agent"],
    ],
    ctx.env,
    workspaceRoot(),
  );
  let received: Record<string, unknown>[] = [];
  try {
    await waitForHealth(agentPort);
    const deadline = Date.now() + 60_000;
    while (true) {
      const drained = await runTufaWithTimeout(
        ["vc", "registry", "root", "receive", ...group.tufaStore, "--alias", "group", "--registry", registry],
        ctx.env,
        ctx.repoRoot,
        30_000,
      );
      received = results(drained.stdout);
      if (drained.code === 0 || Date.now() > deadline) break;
      await new Promise(resolve => setTimeout(resolve, 1_000));
    }
  } finally {
    const output = await stopChild(agent);
    if (!received.length) console.error(output);
  }
  return received;
}

Deno.test("Interop registry root: a KERIpy custodian's issuance-completion send reaches the Tufa member of a mixed group", () =>
  withMixedGroup(async group => {
    const { registry, root } = await keripyCustodian(group);
    // KERIpy's group issuance completion send, with its default recipients and derived hint.
    const sent = (await peerLines(group.ctx, [
      ...["replicate", "--name", group.kli.name, "--base", group.kli.base, "--alias", "group", "--registry", registry],
    ])).filter(line => line.phase === "root_copy");
    assertEquals(sent.map(item => [item.sender, item.recipient, item.gid, item.registry, item.transmitted]), [
      [group.kliPre, group.tsPre, group.group, registry, true],
    ]);
    // No receive command delivers it: the Tufa agent drains its mailbox and the handler retains the root.
    assertEquals(await tufaAgentRetains(group, registry), [{ gid: group.group, registry, retained: true }]);
    await withTufaStore(group.tufa, group.headDirPath, function*(hby) {
      assertEquals(hby.mgr.getRegistryRoot(group.group, registry)?.qb64, root);
    });
  }));

/**
 * Tufa holds the group registry root as DH custodian would: it authors the group
 * `rip` and root-blinded `bup`, both anchored through the mixed group KEL, and
 * retains the `bup` opening. The KERIpy member accepts the public TEL only.
 */
async function tufaCustodian(group: MixedGroup) {
  const rip = regcept(group.group);
  await anchorInGroup(group, [{ i: rip.said!, s: "0", d: rip.said! }]);
  const staged = await withTufaStore(group.tufa, group.headDirPath, function*(hby, runtime) {
    yield* runtime.reactor.processBytes(rip.raw);
    assertEquals(runtime.acdc!.store.headEvent(rip.said!)?.said, rip.said);
    const root = new Salter({ raw: crypto.getRandomValues(new Uint8Array(16)), code: MtrDex.Salt_128 });
    hby.mgr.putRegistryRoot(group.group, rip.said!, root);
    const acdc = acdcmap(group.group, {
      regid: rip.said!,
      attribute: { d: "", i: group.kliPre, role: "group reader" },
    });
    const opening = makeBlindState({ salt: root.qb64, sn: 1, acdc: acdc.said!, state: "issued" });
    return { root: root.qb64, opening, event: blindate(rip.said!, rip.said!, opening.d.nonce) };
  });
  await anchorInGroup(group, [{ i: rip.said!, s: "1", d: staged.event.said! }]);
  const tel = `${group.headDirPath}/tufa-group-tel.json`;
  await withTufaStore(group.tufa, group.headDirPath, function*(_hby, runtime) {
    yield* runtime.reactor.processBytes(staged.event.raw);
    assertEquals(runtime.acdc!.store.headEvent(rip.said!)?.said, staged.event.said);
    // The held opening is the custodian's hint evidence, as its own Grant would be.
    runtime.acdc!.store.retainOpening(staged.event, staged.opening);
    const raws = [rip, staged.event].map(node => new TextDecoder().decode(node.raw));
    yield* call(() => Deno.writeTextFile(tel, JSON.stringify(raws)));
  });
  const accepted = await peer(group.ctx, [
    ...["accept", "--name", group.kli.name, "--base", group.kli.base],
    ...["--issuer", group.group, "--registry", rip.said!, "--tel", tel],
  ]);
  assertEquals(accepted.head, staged.event.said);
  const held = await peer(group.ctx, [
    ...["root", "--name", group.kli.name, "--base", group.kli.base, "--gid", group.group, "--registry", rip.said!],
  ]);
  assertEquals(held.root, null, "only the custodian holds the root");
  return { registry: rip.said!, root: staged.root };
}

/** Drain the KERIpy member's credential mailbox with `receive --listen` and return the root it retained. */
async function kliListenRetains(group: MixedGroup, registry: string): Promise<string | null> {
  const { ctx } = group;
  const received = results(
    (await requireSuccess(
      "kli root receive --listen",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          ...["vc", "registry", "root", "receive", ...group.kliStore, "--alias", "group", ...group.versions],
          ...["--registry", registry, "--listen", "--timeout", "60"],
        ],
        ctx.env,
        90_000,
      ),
    )).stdout,
  ).at(-1)!;
  assertEquals(received, { gid: group.group, registry, retained: true });
  const retained = await peer(ctx, [
    ...["root", "--name", group.kli.name, "--base", group.kli.base, "--gid", group.group, "--registry", registry],
  ]);
  return retained.root as string | null;
}

Deno.test("Interop registry root: a Tufa custodian's issuance-completion send reaches the KERIpy member of a mixed group", () =>
  withMixedGroup(async group => {
    const { registry, root } = await tufaCustodian(group);
    // Tufa's group issuance completion send, with its default recipients and derived hint.
    const sent = await withTufaStore(group.tufa, group.headDirPath, function*(hby, runtime) {
      return yield* sendRootCopies(runtime, hby.habByName("group")!, [registry], { timeoutMs: 45_000 });
    });
    assertEquals(sent.map(item => [item.sender, item.recipient, item.gid, item.registry, item.transmitted]), [
      [group.tsPre, group.kliPre, group.group, registry, true],
    ]);
    assertEquals(await kliListenRetains(group, registry), root);
  }));

Deno.test("Interop registry root: a mixed group rotation rekeys the KERIpy member and the Tufa custodian re-seals the root to it", () =>
  withMixedGroup(async group => {
    const { ctx } = group;
    const { registry, root } = await tufaCustodian(group);
    // Each member first rotates its own key, so the group rotation changes both contributing keys.
    await requireSuccess(
      "kli rotates its member",
      runCmdWithTimeout(
        ctx.kliCommand,
        ["rotate", ...group.kliStore, ...group.versions, "--alias", "kli", "--receipt-endpoint"],
        ctx.env,
        30_000,
      ),
    );
    await requireSuccess(
      "tufa rotates its member",
      runTufaWithTimeout(
        ["rotate", ...group.tufaStore, "--alias", "tufa", "--receipt-endpoint", "--toad", "1"],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    await queryKliPrefix(ctx.kliCommand, ctx.env, group.kli.name, group.kli.base, "kli", group.tsPre);
    await requireSuccess(
      "tufa queries the rotated KERIpy member",
      runTufaWithTimeout(
        ["query", ...group.tufaStore, "--alias", "tufa", "--prefix", group.kliPre],
        ctx.env,
        ctx.repoRoot,
        30_000,
      ),
    );
    // The Tufa custodian proposes the v2 group rotation, as it proposed the inception; KERIpy approves it.
    const [rotated] = await settled(
      "group rotation",
      runTufaWithTimeout(
        [
          ...["multisig", "rotate", ...group.tufaStore, "--version", "2.0", "--alias", "group"],
          ...["--isith", "2", "--nsith", "2", "--receipt-endpoint"],
        ],
        ctx.env,
        ctx.repoRoot,
        120_000,
      ),
      runCmdWithTimeout(
        ctx.kliCommand,
        ["multisig", "join", ...group.kliStore, ...group.versions, "--group", "group", "--auto"],
        ctx.env,
        120_000,
      ),
    );
    const lines = results(rotated.stdout);
    assertEquals(lines.find(line => line.accepted !== undefined)?.accepted, true, rotated.stdout);
    // `tufa multisig rotate` re-seals automatically after acceptance, to the rekeyed KERIpy member only.
    const resealed = lines.filter(line => line.phase === "root_copy");
    assertEquals(resealed.map(item => [item.sender, item.recipient, item.gid, item.registry, item.transmitted]), [
      [group.tsPre, group.kliPre, group.group, registry, true],
    ]);
    assertEquals(await kliListenRetains(group, registry), root);
    await withTufaStore(group.tufa, group.headDirPath, function*(hby) {
      assertEquals(hby.db.getKever(group.group)?.sn, 3, "inception, two registry anchors, then the rotation");
    });
  }));
