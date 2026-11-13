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
 * Six mixed-group stories follow, each over its own group of one KERIpy and
 * one Tufa member formed and anchored with the real multisig commands. In the
 * first two, the member holding the group root runs its implementation's
 * group issuance completion send (`rootreplicating.replicate`, Tufa
 * `sendRootCopies`) directly over store-set-up root, `bup` and opening, and the
 * other member retains the root from its mailbox. In the third, the Tufa
 * custodian's `tufa multisig rotate`, approved by `kli multisig join`, rekeys
 * the KERIpy member and re-seals the root to it automatically. In the fourth,
 * the mirror direction, the KERIpy custodian's v2 `kli multisig rotate`,
 * approved by `tufa multisig join`, rekeys the Tufa member and re-seals the root
 * to it.
 *
 * The last two drive a full group IPEX issuance with DH through the installed
 * CLIs only, once with each implementation as the elected DH custodian (the
 * member holding signing index 0 of the group inception, the coordinator). The
 * custodian's member proposes the group registry RIP and the other approves it
 * with `multisig join`; the custodian proposes the Grant with `ipex grant
 * --issue --proposal-output`, the other member approves that exact proposal and
 * contributes its DH query signature with its own `ipex grant`, then approves
 * the BUP with `multisig join`; an individual holder on the custodian's
 * implementation completes DH and admits. Issuance completion alone sends the
 * root copy, and the other member, on the other implementation, retains the
 * identical root from its mailbox.
 */
import { makeBlindState, MtrDex, parseBytes, Salter, SerderACDC, type SerderKERI, Vrsn_2_0 } from "cesr-ts";
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
      const acdc = acdcmap(hab.pre!, { regid: rip.said!, attribute: { i: kliPre, role: "reader" } });
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
  witness: KeriPyWitnessNode;
}

/**
 * Run one mixed-group story over its own witness, stores and temporary directory.
 * `first` names the member that holds signing index 0, so the group's DH
 * custodian election (lowest verified signing index) picks that member.
 */
async function withMixedGroup(
  story: (group: MixedGroup) => Promise<void>,
  first: "tufa" | "kli" = "tufa",
): Promise<void> {
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
        aids: first === "tufa" ? [tsPre, kliPre] : [kliPre, tsPre],
        rmids: first === "tufa" ? [tsPre, kliPre] : [kliPre, tsPre],
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
      witness,
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
      attribute: { i: group.kliPre, role: "group reader" },
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

Deno.test("Interop registry root: a KERIpy-proposed mixed group rotation rekeys the Tufa member and the KERIpy custodian re-seals the root to it", () =>
  withMixedGroup(async group => {
    const { ctx } = group;
    const { registry, root } = await keripyCustodian(group);
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
    // The KERIpy custodian proposes the v2 group rotation; the Tufa member approves it.
    const [rotated, approved] = await settled(
      "group rotation",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          ...["multisig", "rotate", ...group.kliStore, ...group.versions, "--alias", "group"],
          ...["--isith", "2", "--nsith", "2"],
        ],
        ctx.env,
        120_000,
      ),
      runTufaWithTimeout(
        [
          ...["multisig", "join", ...group.tufaStore, "--group", "group", "--auto"],
          ...["--approval-timeout", "60", "--receipt-endpoint"],
        ],
        ctx.env,
        ctx.repoRoot,
        120_000,
      ),
    );
    assertEquals(results(approved.stdout).at(-1)!.accepted, true, approved.stdout);
    // `kli multisig rotate` re-seals automatically after acceptance, to the rekeyed Tufa member only.
    const resealed = results(rotated.stdout).filter(line => line.phase === "root_copy");
    assertEquals(resealed.map(item => [item.sender, item.recipient, item.gid, item.registry, item.transmitted]), [
      [group.kliPre, group.tsPre, group.group, registry, true],
    ]);
    assertEquals(await tufaAgentRetains(group, registry), [{ gid: group.group, registry, retained: true }]);
    await withTufaStore(group.tufa, group.headDirPath, function*(hby) {
      assertEquals(hby.mgr.getRegistryRoot(group.group, registry)?.qb64, root);
      assertEquals(hby.db.getKever(group.group)?.sn, 3, "inception, two registry anchors, then the rotation");
    });
  }));

/** KRAM windows long enough for a live multi-process group exchange, as KERIpy's group issuance CLI tests use. */
const LIVE_KRAM_CACHES = [1000, 60000, 60000, 300000, 60000, 60000, 300000];

/** An individual Issuee on one implementation, witnessed by the group's witness. */
interface Holder {
  pre: string;
  name: string;
  base: string;
  store: string[];
}

/** Run one KERIpy command for a story, failing with its output. */
function kliRun(group: MixedGroup, label: string, args: string[], timeoutMs = 60_000): Promise<CmdResult> {
  return requireSuccess(label, runCmdWithTimeout(group.ctx.kliCommand, args, group.ctx.env, timeoutMs));
}

/** Run one Tufa command for a story, failing with its output. */
function tufaRun(group: MixedGroup, label: string, args: string[], timeoutMs = 60_000): Promise<CmdResult> {
  return requireSuccess(label, runTufaWithTimeout(args, group.ctx.env, group.ctx.repoRoot, timeoutMs));
}

/** Enable live KRAM on both members, as an operator does before the first v2 IPEX Grant. */
async function enableLiveKram(group: MixedGroup): Promise<void> {
  await peer(group.ctx, [
    ...["kram", "--name", group.kli.name, "--base", group.kli.base, "--caches", JSON.stringify(LIVE_KRAM_CACHES)],
  ]);
  await withTufaStore(group.tufa, group.headDirPath, function*(hby) {
    hby.cf!.put({ ...hby.cf!.get(), kram: { enabled: true, denials: [], caches: { "~": LIVE_KRAM_CACHES } } });
  });
}

/**
 * Create a witnessed individual holder with live KRAM, and introduce it and the
 * group to each other by witness OOBI, after the group registry is anchored.
 */
async function makeHolder(group: MixedGroup, kind: "tufa" | "kli"): Promise<Holder> {
  const { ctx, witness } = group;
  const id = crypto.randomUUID().slice(0, 8);
  let holder: Holder;
  if (kind === "tufa") {
    const name = `tufa-holder-${id}`;
    const store = ["--name", name, "--head-dir", group.headDirPath, "--passcode", PASSCODE];
    await tufaRun(group, "tufa holder init", ["init", ...store]);
    await tufaRun(group, "tufa holder resolves witness", [
      "oobi",
      "resolve",
      ...store,
      "--url",
      witness.controllerOobi,
    ]);
    const pre = extractPrefix(
      (await tufaRun(group, "tufa holder incept", [
        ...["incept", ...store, "--version", "2.0", "--alias", "holder", "--transferable"],
        ...["--icount", "1", "--ncount", "1", "--toad", "1", "--wits", witness.pre, "--receipt-endpoint"],
      ])).stdout,
    );
    await withTufaStore(name, group.headDirPath, function*(hby) {
      hby.cf!.put({ ...hby.cf!.get(), kram: { enabled: true, denials: [], caches: { "~": LIVE_KRAM_CACHES } } });
    });
    await tufaRun(group, "tufa holder resolves the group", [
      ...["oobi", "resolve", ...store, "--url", witnessOobi(witness, group.group), "--oobi-alias", "group"],
    ]);
    holder = { pre, name, base: "", store };
  } else {
    const name = `kli-holder-${id}`, base = `holder-${id}`;
    const store = ["--name", name, "--base", base, "--passcode", PASSCODE];
    await kliRun(group, "kli holder init", ["init", ...store]);
    await kliRun(group, "kli holder resolves witness", [
      ...["oobi", "resolve", ...store, ...group.versions, "--oobi", witness.controllerOobi],
    ]);
    const pre = extractPrefix(
      (await kliRun(group, "kli holder incept", [
        ...["incept", ...store, ...group.versions, "--alias", "holder"],
        ...["--file", `${group.headDirPath}/member.json`, "--receipt-endpoint"],
      ])).stdout,
    );
    await peer(ctx, ["kram", "--name", name, "--base", base, "--caches", JSON.stringify(LIVE_KRAM_CACHES)]);
    await kliRun(group, "kli holder resolves the group", [
      ...["oobi", "resolve", ...store, ...group.versions, "--oobi", witnessOobi(witness, group.group)],
      ...["--oobi-alias", "group"],
    ]);
    holder = { pre, name, base, store };
  }
  await kliRun(group, "kli member resolves the holder", [
    ...["oobi", "resolve", ...group.kliStore, ...group.versions, "--oobi", witnessOobi(witness, holder.pre)],
    ...["--oobi-alias", "holder"],
  ]);
  await tufaRun(group, "tufa member resolves the holder", [
    ...["oobi", "resolve", ...group.tufaStore, "--url", witnessOobi(witness, holder.pre), "--oobi-alias", "holder"],
  ]);
  return holder;
}

/** A command started in the background whose failure is reported, never swallowed. */
interface Started {
  label: string;
  settled: boolean;
  result: Promise<CmdResult>;
}

function start(label: string, command: Promise<CmdResult>): Started {
  const started: Started = { label, settled: false, result: command };
  command.then(() => started.settled = true, () => started.settled = true);
  return started;
}

/** Wait for every started command and fail with all their output if any failed. */
async function finish(label: string, commands: Started[]): Promise<CmdResult[]> {
  const done = await Promise.allSettled(commands.map(command => command.result));
  const report = done.map((outcome, index) =>
    `--- ${commands[index].label}: ${
      outcome.status === "rejected"
        ? String(outcome.reason)
        : `exit ${outcome.value.code}\n${outcome.value.stdout}\n${outcome.value.stderr}`
    }`
  );
  if (done.some(outcome => outcome.status === "rejected" || outcome.value.code !== 0)) {
    throw new Error(`${label} failed:\n${report.join("\n")}`);
  }
  return done.map(outcome => (outcome as PromiseFulfilledResult<CmdResult>).value);
}

/** Wait for a file a running command writes, failing early if that command has already exited. */
async function written(path: string, writer: Started, others: Started[] = []): Promise<Uint8Array> {
  const deadline = Date.now() + 90_000;
  while (true) {
    const bytes = await Deno.readFile(path).catch(() => undefined);
    if (bytes?.length) {
      await new Promise(resolve => setTimeout(resolve, 250));
      return await Deno.readFile(path);
    }
    if (writer.settled || Date.now() > deadline) {
      await finish(`waiting for ${path}`, [writer, ...others]);
      throw new Error(`${writer.label} exited without writing ${path}`);
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

/** The group KEL inception: both members signed it, so the lowest signing index elects the custodian. */
async function coordinatorEvent(group: MixedGroup): Promise<string> {
  return await withTufaStore(group.tufa, group.headDirPath, function*(hby) {
    const said = hby.db.kels.getLast(group.group, 0);
    assertExists(said);
    return said;
  });
}

/** The exact Grant SAID nested in a `/multisig/exn` proposal file. */
function proposedGrant(proposal: Uint8Array): string {
  const wrapper = parseBytes(proposal)[0];
  assertEquals((wrapper.body as SerderKERI).route, "/multisig/exn");
  return (wrapper.nests![0].body as SerderKERI).said!;
}

function rootCopies(output: string) {
  return results(output).filter(line => line.phase === "root_copy").map(item => [
    item.sender,
    item.recipient,
    item.gid,
    item.registry,
    item.transmitted,
  ]);
}

Deno.test("Interop registry root: a mixed group issues with DH through the CLIs and the Tufa custodian's root copy reaches the KERIpy member", () =>
  withMixedGroup(async group => {
    const { headDirPath } = group;
    await enableLiveKram(group);
    // Group registry: the Tufa member proposes the RIP, the KERIpy member approves its exact anchor.
    await finish("group registry inception", [
      start(
        "tufa vc registry incept",
        runTufaWithTimeout(
          [
            ...["vc", "registry", "incept", "--acdc-v2", ...group.tufaStore, "--alias", "group"],
            ...["--registry-name", "issuer-fresh", "--usage", "group reader", "--timeout", "90"],
          ],
          group.ctx.env,
          group.ctx.repoRoot,
          120_000,
        ),
      ),
      start(
        "kli multisig join (RIP)",
        runCmdWithTimeout(
          group.ctx.kliCommand,
          ["multisig", "join", ...group.kliStore, ...group.versions, "--group", "group", "--auto"],
          group.ctx.env,
          120_000,
        ),
      ),
    ]);
    const holder = await makeHolder(group, "tufa");
    const bodyFile = `${headDirPath}/body.cesr`;
    await tufaRun(group, "tufa vc create --prepare", [
      ...["vc", "create", "--acdc-v2", "--prepare", ...group.tufaStore, "--alias", "group"],
      ...[
        "--registry-name",
        "issuer-fresh",
        "--recipient",
        holder.pre,
        "--data",
        "{\"role\":\"group reader\"}",
      ],
      ...["--out", bodyFile],
    ]);
    const body = new SerderACDC({ raw: await Deno.readFile(bodyFile) });
    const registry = body.regid!;
    const coordinator = await coordinatorEvent(group);
    const selection = ["--recipient", holder.pre, "--coordinator", coordinator, "--custodian", group.tsPre];
    const proposal = `${headDirPath}/proposal.cesr`;

    // The elected Tufa custodian proposes the Grant; the KERIpy member approves it and contributes to DH.
    const lead = start(
      "tufa ipex grant --issue (custodian)",
      runTufaWithTimeout(
        [
          ...["ipex", "grant", "--issue", ...group.tufaStore, "--alias", "group", "--credential", bodyFile],
          ...selection,
          ...["--proposal-output", proposal, "--timeout", "240"],
        ],
        group.ctx.env,
        group.ctx.repoRoot,
        260_000,
      ),
    );
    const grant = proposedGrant(await written(proposal, lead));
    const contributor = start(
      "kli ipex grant --proposal (contributor)",
      runCmdWithTimeout(
        group.ctx.kliCommand,
        [
          ...["ipex", "grant", ...group.kliStore, ...group.versions, "--alias", "group", "--credential", bodyFile],
          ...selection,
          ...["--issue", "--deliver", "--proposal", proposal, "--consent-lifetime", "120", "--timeout", "90"],
        ],
        group.ctx.env,
        120_000,
      ),
    );
    await finish("KERIpy contribution", [contributor]).catch(async error => {
      await finish("Tufa custodian", [lead]).catch(lead => console.error(String(lead)));
      throw error;
    });
    const contributed = results((await contributor.result).stdout);
    assertEquals(contributed.some(line => line.phase === "contributed"), true, JSON.stringify(contributed));

    // The Issuee drains the delivered Grant, then explicitly approves DH; the KERIpy member separately approves the BUP.
    await tufaRun(group, "tufa holder poll", ["ipex", "poll", ...holder.store, "--alias", "holder", "--timeout", "8"]);
    const setup = start(
      "tufa ipex setup (holder)",
      runTufaWithTimeout(
        ["ipex", "setup", ...holder.store, "--alias", "holder", "--said", grant, "--timeout", "150"],
        group.ctx.env,
        group.ctx.repoRoot,
        170_000,
      ),
    );
    const bup = start(
      "kli multisig join (BUP)",
      runCmdWithTimeout(
        group.ctx.kliCommand,
        ["multisig", "join", ...group.kliStore, ...group.versions, "--group", "group", "--auto"],
        group.ctx.env,
        170_000,
      ),
    );
    const [issued, approved] = await finish("group DH issuance", [lead, bup, setup]);
    assertEquals(approved.stdout.includes("Approve exact BUP anchor") || approved.stdout.includes(registry), true);
    const outcome = results(issued.stdout).find(line => line.contributed === true)!;
    assertEquals([outcome.grant, outcome.registry, outcome.registryIssued], [grant, registry, true], issued.stdout);
    // Issuance completion sent the root to the KERIpy member, which has not yet drained its mailbox.
    assertEquals(rootCopies(issued.stdout), [[group.tsPre, group.kliPre, group.group, registry, true]]);
    const held = await peer(group.ctx, [
      ...["root", "--name", group.kli.name, "--base", group.kli.base, "--gid", group.group, "--registry", registry],
    ]);
    assertEquals(held.root, null, "the KERIpy member holds no root before it drains its mailbox");

    // The Issuee admits the issued credential.
    const admitted = results(
      (await tufaRun(group, "tufa ipex admit (holder)", [
        ...["ipex", "admit", "--acdc-v2", "--consent", ...holder.store, "--alias", "holder", "--said", grant],
      ], 90_000)).stdout,
    ).at(-1)!;
    assertExists(admitted);

    const root = await withTufaStore(group.tufa, group.headDirPath, function*(hby) {
      return hby.mgr.getRegistryRoot(group.group, registry)?.qb64;
    });
    assertExists(root);
    assertEquals(await kliListenRetains(group, registry), root);
  }));

Deno.test("Interop registry root: a mixed group issues with DH through the CLIs and the KERIpy custodian's root copy reaches the Tufa member", () =>
  withMixedGroup(async group => {
    const { headDirPath } = group;
    await enableLiveKram(group);
    // Group registry: the KERIpy member proposes the RIP, the Tufa member approves its exact anchor.
    const [, ripJoined] = await finish("group registry inception", [
      start(
        "kli vc registry incept",
        runCmdWithTimeout(
          group.ctx.kliCommand,
          [
            ...["vc", "registry", "incept", ...group.kliStore, ...group.versions, "--alias", "group"],
            ...["--registry-name", "issuer-fresh", "--usage", "group reader"],
          ],
          group.ctx.env,
          120_000,
        ),
      ),
      start(
        "tufa multisig join (RIP)",
        runTufaWithTimeout(
          [
            ...["multisig", "join", ...group.tufaStore, "--group", "group", "--auto", "--kind", "rip"],
            ...["--approval-timeout", "90", "--receipt-endpoint"],
          ],
          group.ctx.env,
          group.ctx.repoRoot,
          120_000,
        ),
      ),
    ]);
    // The join converged the RIP anchor's witness receipts, so the Tufa member's own TEL accepted the RIP.
    assertEquals(results(ripJoined.stdout).at(-1)!.accepted, true, ripJoined.stdout);
    const holder = await makeHolder(group, "kli");
    const bodyFile = `${headDirPath}/body.cesr`;
    await kliRun(group, "kli vc create --output", [
      ...["vc", "create", ...group.kliStore, ...group.versions, "--alias", "group", "--registry-name", "issuer-fresh"],
      ...["--recipient", holder.pre, "--data", "{\"role\":\"group reader\"}", "--output", bodyFile],
    ]);
    const body = new SerderACDC({ raw: await Deno.readFile(bodyFile) });
    const registry = body.regid!;
    const coordinator = await coordinatorEvent(group);
    const selection = ["--recipient", holder.pre, "--coordinator", coordinator, "--custodian", group.kliPre];
    const proposal = `${headDirPath}/proposal.cesr`, grantFile = `${headDirPath}/grant.cesr`;

    // The elected KERIpy custodian proposes the Grant; the Tufa member approves it and contributes to DH.
    const lead = start(
      "kli ipex grant --issue (custodian)",
      runCmdWithTimeout(
        group.ctx.kliCommand,
        [
          ...["ipex", "grant", ...group.kliStore, ...group.versions, "--alias", "group", "--credential", bodyFile],
          ...selection,
          ...["--issue", "--deliver", "--proposal-output", proposal, "--output", grantFile],
          ...["--consent-lifetime", "120", "--timeout", "240"],
        ],
        group.ctx.env,
        260_000,
      ),
    );
    const grant = proposedGrant(await written(proposal, lead));
    const contributor = start(
      "tufa ipex grant --resume (contributor)",
      runTufaWithTimeout(
        [
          ...["ipex", "grant", "--issue", ...group.tufaStore, "--alias", "group", ...selection],
          ...["--resume", grant, "--proposal", proposal, "--timeout", "90"],
        ],
        group.ctx.env,
        group.ctx.repoRoot,
        120_000,
      ),
    );
    await finish("Tufa contribution", [contributor]).catch(async error => {
      await finish("KERIpy custodian", [lead]).catch(lead => console.error(String(lead)));
      throw error;
    });
    const contributed = results((await contributor.result).stdout).at(-1)!;
    assertEquals([contributed.grant, contributed.contributed, contributed.registryIssued], [grant, true, false]);

    // The KERIpy Issuee approves DH and admits in one invocation; the Tufa member separately approves the BUP.
    await written(grantFile, lead);
    const admit = start(
      "kli ipex admit (holder)",
      runCmdWithTimeout(
        group.ctx.kliCommand,
        [
          ...["ipex", "admit", ...holder.store, ...group.versions, "--alias", "holder", "--said", grant],
          ...["--input", grantFile, "--deliver", "--timeout", "150"],
        ],
        group.ctx.env,
        170_000,
      ),
    );
    const bup = start(
      "tufa multisig join (BUP)",
      runTufaWithTimeout(
        [
          ...["multisig", "join", ...group.tufaStore, "--group", "group", "--auto", "--kind", "bup"],
          ...["--approval-timeout", "150", "--receipt-endpoint"],
        ],
        group.ctx.env,
        group.ctx.repoRoot,
        170_000,
      ),
    );
    const [issued, approved, holderDone] = await finish("group DH issuance", [lead, bup, admit]);
    // The Tufa member's join converged the BUP anchor's witness receipts, so its own TEL accepted the BUP.
    assertEquals(
      [results(approved.stdout).at(-1)!.route, results(approved.stdout).at(-1)!.accepted],
      ["/multisig/bup", true],
      approved.stdout,
    );
    const outcome = results(issued.stdout).find(line => line.admitted !== undefined)!;
    assertEquals([outcome.grant, outcome.registry_issued, outcome.admitted], [grant, true, true], issued.stdout);
    assertEquals(results(holderDone.stdout).at(-1)!.admit, outcome.admit, holderDone.stdout);
    // Issuance completion sent the root to the Tufa member, which has not yet drained its mailbox.
    assertEquals(rootCopies(issued.stdout), [[group.kliPre, group.tsPre, group.group, registry, true]]);
    await withTufaStore(group.tufa, group.headDirPath, function*(hby) {
      assertEquals(hby.mgr.getRegistryRoot(group.group, registry), null, "no root before the mailbox drains");
    });
    const root = (await peer(group.ctx, [
      ...["root", "--name", group.kli.name, "--base", group.kli.base, "--gid", group.group, "--registry", registry],
    ])).root as string;
    assertExists(root);
    assertEquals(await tufaAgentRetains(group, registry), [{ gid: group.group, registry, retained: true }]);
    await withTufaStore(group.tufa, group.headDirPath, function*(hby) {
      assertEquals(hby.mgr.getRegistryRoot(group.group, registry)?.qb64, root);
    });
  }, "kli"));
