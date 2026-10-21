/** Real mixed-language group approval through a pinned witness's ordinary mailbox. */
import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import {
  createInteropContext,
  extractPrefix,
  requireSuccess,
  runCmdWithTimeout,
  runTufaWithTimeout,
  startKeriPyWitnessHarness,
} from "./interop-test-helpers.ts";
import { keripyProtocolVersionArgs } from "./keripy-runtime.ts";

/** Select the final structured Tufa result after its owned stores close. */
function result(stdout: string): Record<string, unknown> {
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}

/** Keep the same real command topology; the optional third member goes offline after inception. */
async function reciprocalApproval(weighted: boolean): Promise<void> {
  const ctx = await createInteropContext();
  ctx.env.PYTHONUNBUFFERED = "1";
  const witnesses = await startKeriPyWitnessHarness(ctx, { aliases: ["wan"] });
  try {
    const witness = witnesses.node("wan");
    const head = `${ctx.home}/tufa`, name = `member-${crypto.randomUUID()}`;
    const pyName = `python-${crypto.randomUUID()}`;
    const versions = keripyProtocolVersionArgs(ctx.env, "1.0");
    /** Run a finite public command with a diagnostic deadline, without modifying the peer. */
    const tufa = (label: string, args: string[]) =>
      requireSuccess(
        label,
        runTufaWithTimeout([...args, "--name", name, "--head-dir", head], ctx.env, ctx.repoRoot, 90_000),
      );
    const kli = (label: string, args: string[], store = pyName) =>
      requireSuccess(label, runCmdWithTimeout(ctx.kliCommand, [...args, "--name", store], ctx.env, 90_000));
    await tufa("initialize Tufa member", ["init", "--nopasscode"]);
    await kli("initialize Python member", ["init", ...versions, "--nopasscode"]);
    await tufa("resolve witness for Tufa member", ["oobi", "resolve", "--url", witness.controllerOobi]);
    await kli("resolve witness for Python member", ["oobi", "resolve", ...versions, "--oobi", witness.controllerOobi]);
    const config = `${ctx.home}/member.json`;
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
    const tsPre = extractPrefix(
      (await tufa("incept Tufa member", [
        "incept",
        "--alias",
        "member",
        "--transferable",
        "--icount",
        "1",
        "--ncount",
        "1",
        "--toad",
        "1",
        "--wits",
        witness.pre,
        "--receipt-endpoint",
      ])).stdout,
    );
    const pyPre = extractPrefix(
      (await kli("incept Python member", [
        "incept",
        ...versions,
        "--alias",
        "member",
        "--file",
        config,
        "--receipt-endpoint",
      ])).stdout,
    );
    await tufa("introduce Python member", [
      "oobi",
      "resolve",
      "--url",
      `${witness.httpOrigin}/oobi/${pyPre}/witness/${witness.pre}`,
      "--oobi-alias",
      "python",
    ]);
    await kli("introduce Tufa member", [
      "oobi",
      "resolve",
      ...versions,
      "--oobi",
      `${witness.httpOrigin}/oobi/${tsPre}/witness/${witness.pre}`,
      "--oobi-alias",
      "tufa",
    ]);
    const mids = [tsPre, pyPre];
    if (weighted) {
      // The witness retains this member's public KEL/mailbox. Its controller
      // exits here and supplies no group contribution in either subsequent turn.
      const inactive = `offline-${crypto.randomUUID()}`;
      await kli("initialize offline member", ["init", ...versions, "--nopasscode"], inactive);
      await kli(
        "resolve offline member witness",
        ["oobi", "resolve", ...versions, "--oobi", witness.controllerOobi],
        inactive,
      );
      const offline = extractPrefix(
        (await kli("incept offline member", [
          "incept",
          ...versions,
          "--alias",
          "member",
          "--file",
          config,
          "--receipt-endpoint",
        ], inactive)).stdout,
      );
      const oobi = `${witness.httpOrigin}/oobi/${offline}/witness/${witness.pre}`;
      await tufa("introduce offline member to Tufa", ["oobi", "resolve", "--url", oobi, "--oobi-alias", "offline"]);
      await kli("introduce offline member to Python", [
        "oobi",
        "resolve",
        ...versions,
        "--oobi",
        oobi,
        "--oobi-alias",
        "offline",
      ]);
      mids.push(offline);
    }
    const threshold = weighted ? ["1/2", "1/2", "1/2"] : "2";
    const groupConfig = `${ctx.home}/group.json`;
    await Deno.writeTextFile(
      groupConfig,
      JSON.stringify({
        aids: mids,
        rmids: mids,
        isith: threshold,
        nsith: threshold,
        toad: 1,
        wits: [witness.pre],
      }),
    );
    // Both real commands must progress: the Python member waits for the elected
    // Tufa member to collect the group receipt and propagate accepted evidence.
    const [proposed, joined] = await Promise.allSettled([
      tufa("Tufa proposes witnessed group", [
        "multisig",
        "incept",
        "--alias",
        "member",
        "--group",
        "group",
        "--file",
        groupConfig,
        "--approval-timeout",
        "60",
        "--receipt-endpoint",
      ]),
      kli("Python approves witnessed group", ["multisig", "join", ...versions, "--group", "group", "--auto"]),
    ]);
    if (proposed.status === "rejected" || joined.status === "rejected") {
      throw new AggregateError(
        [proposed, joined].filter(x => x.status === "rejected").map(x => x.reason),
        "group inception commands failed",
      );
    }
    const group = result(proposed.value.stdout);
    assertEquals(group.accepted, true);
    assertEquals(joined.value.stdout.includes(String(group.group)), true, joined.value.stdout);
    const [approved, interacted] = await Promise.allSettled([
      tufa("Tufa approves Python group interaction", [
        "multisig",
        "join",
        "--group",
        "group",
        "--auto",
        "--approval-timeout",
        "60",
        "--receipt-endpoint",
      ]),
      kli("Python proposes group interaction", [
        "multisig",
        "interact",
        ...versions,
        "--alias",
        "group",
        "--data",
        "[{\"purpose\":\"reciprocal-approval\"}]",
      ]),
    ]);
    if (approved.status === "rejected" || interacted.status === "rejected") {
      throw new AggregateError(
        [approved, interacted].filter(x => x.status === "rejected").map(x => x.reason),
        "reciprocal group commands failed",
      );
    }
    const approval = result(approved.value.stdout);
    assertEquals(approval.accepted, true, approved.value.stdout);
    assertEquals(interacted.value.stdout.includes(String(group.group)), true, interacted.value.stdout);
    // Reopen each implementation's own store after its command exits. Matching
    // accepted coordinates are stronger evidence than a successful transport.
    const local = await run(function*() {
      const hby = yield* createHabery({ name, headDirPath: head, skipConfig: true, skipSignator: true });
      try {
        const kever = hby.db.getKever(String(group.group))!;
        if (weighted) {
          const indices = hby.db.sigs.get(dgKey(kever.pre, kever.said)).map(signature => signature.index).sort();
          assertEquals(indices, [0, 1], "two active half-weight contributions satisfy the three-member group");
        }
        return { sn: kever.sn, said: kever.said };
      } finally {
        yield* hby.close();
      }
    });
    const python = await requireSuccess(
      "read accepted Python group state",
      runCmdWithTimeout(
        ctx.pythonCommand,
        [
          "scripts/ci/read-query-state.py",
          "--name",
          pyName,
          "--prefix",
          String(group.group),
          ...(versions.length ? [] : ["--legacy"]),
        ],
        ctx.env,
        20_000,
        ctx.repoRoot,
      ),
    );
    assertEquals(local.sn, 1);
    assertEquals(JSON.parse(python.stdout), local);
  } finally {
    await witnesses.close();
    await Deno.remove(ctx.home, { recursive: true });
  }
}

Deno.test("selected Python and Tufa CLI members complete reciprocal witnessed group approval", () =>
  reciprocalApproval(false));
Deno.test("selected Python and Tufa weighted CLI group completes while a non-required member stays offline", () =>
  reciprocalApproval(true));
