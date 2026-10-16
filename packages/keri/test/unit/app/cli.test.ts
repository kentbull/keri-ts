import { type Operation, run } from "effection";
import { assertEquals, assertExists, assertRejects, assertStringIncludes, assertThrows } from "jsr:@std/assert";
import {
  concatBytes,
  Counter,
  CtrDexV1,
  Prefixer,
  SerderACDC,
  SerderKERI,
  ShortageError,
  Texter,
  Vrsn_1_0,
  Vrsn_2_0,
  WireParseError,
} from "../../../../cesr/mod.ts";
import { tufa } from "../../../../tufa/src/cli/cli.ts";
import { setupHby } from "../../../src/app/cli/common/existing.ts";
import { delegateConfirmCommand } from "../../../src/app/cli/delegate.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import { inceptCommand } from "../../../src/app/cli/incept.ts";
import { initCommand } from "../../../src/app/cli/init.ts";
import { interactCommand } from "../../../src/app/cli/interact.ts";
import { ipexAdmitCommand, ipexGrantCommand, ipexJoinCommand, ipexPollCommand } from "../../../src/app/cli/ipex.ts";
import { multisigInceptCommand, multisigJoinCommand, multisigRpyCommand } from "../../../src/app/cli/multisig.ts";
import { rotateCommand } from "../../../src/app/cli/rotate.ts";
import { signCommand } from "../../../src/app/cli/sign.ts";
import { verifyCommand } from "../../../src/app/cli/verify.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { ipexGrantExn } from "../../../src/app/ipexing.ts";
import { parseGvrsn } from "../../../src/core/attachment-countering.ts";
import { delcept } from "../../../src/core/protocol-eventing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { assertOperationThrows, CLITestHarness, createMockArgs } from "../../../test/utils.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function extractPrefixLine(output: string): string {
  const line = output.split(/\r?\n/).find((line) => line.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  return line.trim().split(/\s+/).at(-1) ?? "";
}

function extractRawSignature(output: string): string {
  const line = output.split(/\r?\n/).find((line) => /^\d+\.\s+/.test(line.trim()));
  if (!line) {
    throw new Error(`Unable to parse signature output:\n${output}`);
  }
  return line.trim().replace(/^\d+\.\s+/, "");
}

async function runTufa(args: string[]): Promise<CmdResult> {
  const repoRoot = new URL("../../../../../", import.meta.url);
  const out = await new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "packages/tufa/mod.ts",
      ...args,
    ],
    cwd: repoRoot,
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

function runTufaInit(args: string[]): Promise<CmdResult> {
  return runTufa(["init", ...args]);
}

function runTufaIncept(args: string[]): Promise<CmdResult> {
  return runTufa(["incept", ...args]);
}

async function captureCommand(operation: Operation<void>): Promise<CmdResult> {
  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() => operation);
    return {
      code: 0,
      stdout: harness.getOutput().join("\n"),
      stderr: harness.getErrors().join("\n"),
    };
  } finally {
    harness.restoreOutput();
  }
}

Deno.test("CLI - init command with valid arguments", async () => {
  await run(() =>
    initCommand({
      name: `testkeystore-${crypto.randomUUID()}`,
      temp: true,
      nopasscode: true,
    })
  );
});

Deno.test("CLI - IPEX runtime knobs validate before runtime startup", async () => {
  await assertOperationThrows(
    ipexGrantCommand({ said: "Ecredential", approvalTimeoutSeconds: -1 }),
    "approval timeout seconds must be a finite nonnegative number",
  );
  await assertOperationThrows(
    ipexGrantCommand({ said: "Ecredential", approvalTimeoutSeconds: Number.NaN }),
    "approval timeout seconds must be a finite nonnegative number",
  );
  await assertOperationThrows(
    ipexGrantCommand({ approvalTimeoutSeconds: 0 }),
    "Credential SAID is required and cannot be empty",
  );
  await assertOperationThrows(
    ipexPollCommand({ pollTurns: 0 }),
    "poll turns must be a positive integer",
  );
  await assertOperationThrows(
    ipexPollCommand({ pollTurns: 1.5 }),
    "poll turns must be a positive integer",
  );
  await assertOperationThrows(
    ipexPollCommand({ pollTurns: Number.NaN }),
    "poll turns must be a positive integer",
  );
  await assertOperationThrows(
    ipexPollCommand({ pollBudgetMs: 0 }),
    "poll budget milliseconds must be a positive integer",
  );
  await assertOperationThrows(
    ipexPollCommand({ pollBudgetMs: -1 }),
    "poll budget milliseconds must be a positive integer",
  );
  await assertOperationThrows(
    ipexPollCommand({ pollBudgetMs: 1.5 }),
    "poll budget milliseconds must be a positive integer",
  );
  await assertOperationThrows(
    ipexJoinCommand({ pollTurns: -1 }),
    "poll turns must be a positive integer",
  );
});

Deno.test("CLI - multisig approval deadlines validate before runtime startup", async () => {
  await assertOperationThrows(
    multisigInceptCommand({ approvalTimeoutSeconds: -1 }),
    "approval timeout seconds must be a finite nonnegative number",
  );
  await assertOperationThrows(
    multisigInceptCommand({ approvalTimeoutSeconds: Number.NaN }),
    "approval timeout seconds must be a finite nonnegative number",
  );
  await assertOperationThrows(
    multisigRpyCommand({ approvalTimeoutSeconds: 0 }),
    "Name is required and cannot be empty",
  );
  await assertOperationThrows(
    multisigJoinCommand({ name: "store", approvalTimeoutSeconds: -1 }),
    "approval timeout seconds must be a finite nonnegative number",
  );
  await assertOperationThrows(
    multisigJoinCommand({ name: "store", approvalTimeoutSeconds: Number.NaN }),
    "approval timeout seconds must be a finite nonnegative number",
  );
});

Deno.test("CLI - multisig approval deadline joins workers before reopening accepted group state", async () => {
  const name = `multisig-deadline-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  let groupPre = "";
  await run(() => initCommand({ name, headDirPath, nopasscode: true }));
  await run(function*() {
    const hby = yield* setupHby(name, "", undefined, false, headDirPath, { skipConfig: true });
    try {
      const member = hby.makeHab("member", undefined, {});
      const group = hby.makeGroupHab("group", member, [member.pre], [member.pre], undefined, {
        isith: "1",
        nsith: "1",
        toad: 0,
      });
      groupPre = group.hab.pre;
      assertEquals(hby.db.getKever(groupPre)?.sn, 0);
    } finally {
      yield* hby.close();
    }
  });

  const started = Date.now();
  const result = await captureCommand(multisigJoinCommand({
    name,
    headDirPath,
    group: "group",
    auto: true,
    approvalTimeoutSeconds: 0.05,
  }));
  assertStringIncludes(result.stdout, "\"accepted\":true");
  assertEquals(Date.now() - started < 3_000, true, "An empty proposal wait must obey its elapsed deadline.");
  await run(function*() {
    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.db.getKever(groupPre)?.sn, 0);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("CLI - endpoint role multisig mode validates before runtime startup", async () => {
  await assertOperationThrows(
    endsAddCommand({
      name: "store",
      alias: "group",
      role: "mailbox",
      eid: "Eendpoint",
      multisigMode: "invalid",
    }),
    "--multisig-mode must be propose or complete",
  );
});

Deno.test("CLI - init command requires name", async () => {
  const args = createMockArgs({
    name: "",
    nopasscode: true,
  });

  await assertOperationThrows(
    initCommand(args),
    "Name is required and cannot be empty",
  );
});

Deno.test("CLI - init command with missing name", async () => {
  const args = createMockArgs({
    name: undefined,
    nopasscode: true,
  });

  await assertOperationThrows(
    initCommand(args),
    "Name is required and cannot be empty",
  );
});

Deno.test("CLI - init command with help flag", async () => {
  // Help is parsed by commander; command handlers should not be invoked directly for help tests.
  await run(() => tufa(["init", "--help"]));
});

Deno.test("CLI - init command with all options", async () => {
  const configDir = `/tmp/tufa-config-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name: `fulltest-${crypto.randomUUID()}`,
      base: "/custom/base",
      temp: true,
      salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      configDir,
      configFile: "custom.json",
      passcode: "testpasscode123456789012",
      nopasscode: true,
    })
  );
});

Deno.test("CLI - init command with custom salt", async () => {
  await run(() =>
    initCommand({
      name: `salttest-${crypto.randomUUID()}`,
      temp: true,
      salt: "0AAwMTIzNDU2Nzg5YWJjZGVm",
      nopasscode: true,
    })
  );
});

Deno.test("CLI - init command with config overrides", async () => {
  const configDir = `/tmp/tufa-config-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name: `configtest-${crypto.randomUUID()}`,
      temp: true,
      configDir,
      configFile: "custom-config.json",
      nopasscode: true,
    })
  );
});

Deno.test("CLI - init command honors custom head directory", async () => {
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const name = `headtest-${crypto.randomUUID()}`;

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  assertExists(Deno.statSync(`${headDirPath}/keri/ks/${name}`));
  assertExists(Deno.statSync(`${headDirPath}/keri/db/${name}`));
});

Deno.test("CLI - init stores the configured CESR body mode", async () => {
  const name = `cesr-mode-init-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
      cesrBodyMode: "body",
    })
  );

  await run(function*() {
    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.cesrBodyMode, "body");
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("CLI - setupHby defaults CESR body mode to header when no mode is configured", async () => {
  const name = `cesr-mode-default-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  await run(function*() {
    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.cesrBodyMode, "header");
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("CLI - delegate confirm auto approves multiple unwitnessed events and closes its workers", async () => {
  const name = `delegate-confirm-auto-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const delegated: { pre: string; said: string }[] = [];
  await run(() => initCommand({ name, headDirPath, nopasscode: true }));
  await run(function*() {
    const hby = yield* setupHby(name, "", undefined, false, headDirPath, { skipConfig: true });
    const templateHby = yield* createHabery({
      name: `delegate-templates-${crypto.randomUUID()}`,
      temp: true,
      skipConfig: true,
    });
    try {
      const delegator = hby.makeHab("delegator", undefined, {});
      for (let index = 0; index < 2; index++) {
        const template = templateHby.makeHab(`template-${index}`, undefined, {});
        const dip = delcept([template.kever!.verfers[0]!.qb64], delegator.pre, {
          ndigs: [template.kever!.ndigers[0]!.qb64],
        });
        assertExists(dip.pre);
        assertExists(dip.said);
        hby.db.putEvtSerder(dip.pre, dip.said, dip.raw);
        hby.db.sigs.put(dgKey(dip.pre, dip.said), template.sign(dip.raw, true));
        hby.db.delegables.add([dip.pre], dip.said);
        delegated.push({ pre: dip.pre, said: dip.said });
      }
    } finally {
      yield* templateHby.close(true);
      yield* hby.close();
    }
  });

  const result = await captureCommand(delegateConfirmCommand(createMockArgs({
    name,
    headDirPath,
    alias: "delegator",
    auto: true,
    interact: true,
  })));
  assertEquals(result.stdout.match(/Approved delegated dip/g)?.length, 2);

  // Reopen after command teardown: both accepted events and their distinct
  // authorizer seals must survive the command's joined worker lifetime.
  await run(function*() {
    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      assertEquals(hby.habByName("delegator")!.kever!.sn, 2);
      const anchorSequences = [];
      for (const { pre, said } of delegated) {
        assertEquals(hby.db.kels.getLast(pre, 0), said);
        assertEquals(hby.db.delegables.get([pre]), []);
        const approval = hby.db.aess.get(dgKey(pre, said));
        assertExists(approval);
        anchorSequences.push(approval[0].num);
      }
      assertEquals(anchorSequences.sort(), [1n, 2n]);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("CLI - delegate confirm does not pin aess or accept the delegate before replay-backed commitment", async () => {
  const name = `delegate-confirm-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const witnessPort = 9300 + Math.floor(Math.random() * 1000);
  const controller = new AbortController();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: witnessPort,
    signal: controller.signal,
  }, () => new Response(null, { status: 204 }));

  let delegatePre = "";
  let delegateSaid = "";

  try {
    await run(() =>
      initCommand({
        name,
        headDirPath,
        nopasscode: true,
      })
    );

    await run(function*() {
      const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
        skipConfig: true,
      });
      const templateHby = yield* createHabery({
        name: `delegate-confirm-template-${crypto.randomUUID()}`,
        temp: true,
        skipConfig: true,
      });

      try {
        const witness = hby.makeHab("witness", undefined, {
          transferable: false,
          icount: 1,
          isith: "1",
          toad: 0,
        });
        hby.db.locs.pin([witness.pre, "http"], {
          url: `http://127.0.0.1:${witnessPort}`,
        });
        const delegator = hby.makeHab("delegator", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });

        const template = templateHby.makeHab("template", undefined, {
          transferable: true,
          icount: 1,
          isith: "1",
          ncount: 1,
          nsith: "1",
          toad: 0,
        });
        const dip = delcept(
          [template.kever!.verfers[0]!.qb64],
          delegator.pre,
          {
            ndigs: [template.kever!.ndigers[0]!.qb64],
            wits: [witness.pre],
            toad: 1,
          },
        );
        if (!dip.pre || !dip.said) {
          throw new Error(
            "Expected delegated inception serder to include pre and said.",
          );
        }
        delegatePre = dip.pre;
        delegateSaid = dip.said;
        hby.db.putEvtSerder(dip.pre, dip.said, dip.raw);
        hby.db.sigs.put(dgKey(dip.pre, dip.said), template.sign(dip.raw, true));
        hby.db.wigs.put(dgKey(dip.pre, dip.said), witness.sign(dip.raw, true));
        hby.db.wits.put(dgKey(dip.pre, dip.said), [
          new Prefixer({ qb64: witness.pre }),
        ]);
        hby.db.delegables.add([dip.pre], dip.said);
      } finally {
        yield* templateHby.close(true);
        yield* hby.close();
      }
    });

    await assertOperationThrows(
      delegateConfirmCommand(createMockArgs({
        name,
        headDirPath,
        alias: "delegator",
      })),
      "Runtime did not converge within 30000ms.",
    );

    await run(function*() {
      const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
        readonly: true,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertEquals(Boolean(hby.db.getKever(delegatePre)), false);
        assertEquals(
          Boolean(hby.db.aess.get(dgKey(delegatePre, delegateSaid))),
          false,
        );
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    controller.abort();
    await server.finished;
  }
});

Deno.test("CLI - default loglevel suppresses debug LMDB traces", async () => {
  const res = await runTufaInit([
    "--name",
    `quiettest-${crypto.randomUUID()}`,
    "--temp",
    "--nopasscode",
  ]);

  const combined = `${res.stdout}\n${res.stderr}`;
  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertEquals(combined.includes("Opening LMDB at:"), false);
  assertEquals(combined.includes("Creating directory at"), false);
});

Deno.test("CLI - --loglevel debug enables debug LMDB traces", async () => {
  const res = await runTufaInit([
    "--loglevel",
    "debug",
    "--name",
    `debugtest-${crypto.randomUUID()}`,
    "--temp",
    "--nopasscode",
  ]);

  const combined = `${res.stdout}\n${res.stderr}`;
  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(combined, "Opening LMDB at:");
});

Deno.test("CLI - incept command accepts explicit config-dir and config-file overrides", async () => {
  const name = `incept-config-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-head-${crypto.randomUUID()}`;
  const configDir = `/tmp/tufa-config-${crypto.randomUUID()}`;
  Deno.mkdirSync(configDir, { recursive: true });
  Deno.writeTextFileSync(`${configDir}/bootstrap.json`, "{}\n");

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  const incept = await captureCommand(
    inceptCommand({
      name,
      headDirPath,
      configDir,
      configFile: "bootstrap",
      alias: "alice",
      transferable: true,
    }),
  );
  assertEquals(
    incept.code,
    0,
    `stdout:\n${incept.stdout}\nstderr:\n${incept.stderr}`,
  );
  assertStringIncludes(incept.stdout, "Prefix");
});

Deno.test("CLI - exchange send help exposes KERIpy-style EXN flags", async () => {
  const res = await runTufa(["exchange", "send", "--help"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, "--sender <alias>");
  assertStringIncludes(res.stdout, "--recipient <recipient>");
  assertStringIncludes(res.stdout, "--topic <topic>");
  assertStringIncludes(res.stdout, "--data <item>");
  assertEquals(res.stdout.includes("--alias <alias>"), false);
  assertEquals(res.stdout.includes("--payload <json>"), false);
  assertEquals(res.stdout.includes("--transport <transport>"), false);
});

Deno.test("CLI - exn send help mirrors exchange send help", async () => {
  const res = await runTufa(["exn", "send", "--help"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, "--sender <alias>");
  assertStringIncludes(res.stdout, "--recipient <recipient>");
  assertStringIncludes(res.stdout, "--data <item>");
});

Deno.test("CLI - ipex grant help exposes gvrsn attachment counter option", async () => {
  const res = await runTufa(["ipex", "grant", "--help"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, "--gvrsn <version>");
});

Deno.test("CLI - gvrsn parser accepts numeric KERI versions and rejects malformed versions", () => {
  assertEquals(parseGvrsn("2.0"), Vrsn_2_0);
  assertEquals(parseGvrsn("2"), Vrsn_2_0);
  assertThrows(() => parseGvrsn("2.x"));
  assertThrows(() => parseGvrsn("2.0.0"));
});

Deno.test("CLI - sign, verify, rotate, and interact commands work for one persistent single-sig store", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-cli-sign-" });
  const name = `cli-sign-${crypto.randomUUID()}`;
  const alias = "alice";
  const message = "cli sign verify rotate";

  await run(() =>
    initCommand({
      name,
      headDirPath,
      nopasscode: true,
    })
  );

  const incept = await captureCommand(
    inceptCommand({
      name,
      headDirPath,
      alias,
      transferable: true,
      isith: "1",
      icount: 1,
      nsith: "1",
      ncount: 1,
      toad: 0,
    }),
  );
  assertEquals(
    incept.code,
    0,
    `stdout:\n${incept.stdout}\nstderr:\n${incept.stderr}`,
  );
  const prefix = extractPrefixLine(incept.stdout);

  const sign = await captureCommand(signCommand({
    name,
    headDirPath,
    alias,
    text: message,
  }));
  assertEquals(
    sign.code,
    0,
    `stdout:\n${sign.stdout}\nstderr:\n${sign.stderr}`,
  );
  const signature = extractRawSignature(sign.stdout);

  const verify = await captureCommand(verifyCommand({
    name,
    headDirPath,
    prefix,
    text: message,
    signature: [signature],
  }));
  assertEquals(
    verify.code,
    0,
    `stdout:\n${verify.stdout}\nstderr:\n${verify.stderr}`,
  );
  assertStringIncludes(verify.stdout, "Signature 1 is valid.");

  const rotate = await captureCommand(rotateCommand({
    name,
    headDirPath,
    alias,
  }));
  assertEquals(
    rotate.code,
    0,
    `stdout:\n${rotate.stdout}\nstderr:\n${rotate.stderr}`,
  );
  assertStringIncludes(rotate.stdout, `Prefix  ${prefix}`);
  assertStringIncludes(rotate.stdout, "New Sequence No.  1");
  assertStringIncludes(rotate.stdout, "Public key 1");

  const interact = await captureCommand(interactCommand({
    name,
    headDirPath,
    alias,
    data: ["{\"anchor\":\"acdc\"}"],
  }));
  assertEquals(
    interact.code,
    0,
    `stdout:\n${interact.stdout}\nstderr:\n${interact.stderr}`,
  );
  assertStringIncludes(interact.stdout, `Prefix  ${prefix}`);
  assertStringIncludes(interact.stdout, "New Sequence No.  2");
  assertStringIncludes(interact.stdout, "Public key 1");

  const rotatedSign = await captureCommand(signCommand({
    name,
    headDirPath,
    alias,
    text: message,
  }));
  assertEquals(
    rotatedSign.code,
    0,
    `stdout:\n${rotatedSign.stdout}\nstderr:\n${rotatedSign.stderr}`,
  );
  assertEquals(rotatedSign.stdout !== sign.stdout, true);
});

Deno.test("CLI - query help exposes KLI-compatible core flags", async () => {
  const res = await runTufa(["query", "--help"]);

  assertEquals(res.code, 0, `stdout:\n${res.stdout}\nstderr:\n${res.stderr}`);
  assertStringIncludes(res.stdout, "--alias <alias>");
  assertStringIncludes(res.stdout, "--prefix <prefix>");
  assertStringIncludes(res.stdout, "--anchor <file>");
});

Deno.test("CLI - grant-file admission requires valid EOF and keeps the selected body independently of attachments", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "ipex-grant-file-" });
  const name = "grant-file";
  const grantFile = `${headDirPath}/grant.cesr`;
  const out = `${headDirPath}/admit.cesr`;
  let wire: Uint8Array = new Uint8Array();
  let said = "";
  try {
    await run(function*() {
      const hby = yield* createHabery({ name, headDirPath, temp: false, skipConfig: true });
      try {
        const hab = hby.makeHab("holder");
        // A real ACDC embed exercises body hydration without requiring a registry admission in this CLI test.
        const acdc = new SerderACDC({
          sad: { v: "ACDC10JSON000000_", d: "", i: hab.pre, s: hab.pre, a: { i: hab.pre } },
          makify: true,
        });
        const [grant] = ipexGrantExn(hab, hab.pre, "file grant", acdc);
        said = grant.said!;
        wire = concatBytes(
          hab.endorse(grant, { pipelined: false }),
          new Counter({ code: CtrDexV1.ESSRPayloadGroup, count: 1, version: Vrsn_1_0 }).qb64b,
          new Texter({ raw: new TextEncoder().encode("discarded attachment"), code: "4B" }).qb64b,
        );
      } finally {
        yield* hby.close();
      }
    });
    const args = { name, headDirPath, alias: "holder", grantFile, out, noWait: true };
    // Seeing a grant before a malformed tail must not produce an admit file.
    await Deno.writeFile(grantFile, concatBytes(wire, new TextEncoder().encode("-A")));
    const error = await assertRejects(() => run(() => ipexAdmitCommand(args)), WireParseError);
    assertEquals(error.cause instanceof ShortageError, true);
    await assertRejects(() => Deno.stat(out), Deno.errors.NotFound);
    await Deno.writeFile(grantFile, wire);
    const result = await captureCommand(ipexAdmitCommand(args));
    assertEquals(result.code, 0);
    const admit = new SerderKERI({ raw: await Deno.readFile(out) });
    assertEquals(admit.route, "/ipex/admit");
    assertEquals(admit.ked?.p, said);
    assertStringIncludes(result.stdout, said);
  } finally {
    await Deno.remove(headDirPath, { recursive: true });
  }
});
