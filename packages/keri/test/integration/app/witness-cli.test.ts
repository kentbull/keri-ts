// @file-test-lane interop-witness

import { run } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { createHabery } from "../../../src/app/habbing.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

type SpawnedChild = Deno.ChildProcess;

function packageRoot(): string {
  return new URL("../../../../../", import.meta.url).pathname;
}

function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
}

function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  return line.trim().split(/\s+/).at(-1) ?? "";
}

async function runCmd(
  command: string,
  args: string[],
  cwd: string,
): Promise<CmdResult> {
  const out = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

function spawnChild(
  command: string,
  args: string[],
  cwd: string,
): SpawnedChild {
  return new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

async function runTufa(args: string[]): Promise<CmdResult> {
  return await runCmd(
    Deno.execPath(),
    ["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
    packageRoot(),
  );
}

async function requireSuccess(
  label: string,
  resultPromise: Promise<CmdResult>,
): Promise<CmdResult> {
  const result = await resultPromise;
  if (result.code !== 0) {
    throw new Error(
      `${label} failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return result;
}

async function waitForHealth(port: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = "health check did not return 200";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      try {
        if (response.ok) {
          return;
        }
        lastError = `health returned HTTP ${response.status}`;
      } finally {
        await response.body?.cancel().catch(() => undefined);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(lastError);
}

async function readChildOutput(child: SpawnedChild): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  return `${stdout}\n${stderr}`.trim();
}

async function stopChild(child: SpawnedChild): Promise<string> {
  try {
    child.kill("SIGTERM");
  } catch {
    // Child may already be gone.
  }
  await child.status.catch(() => undefined);
  return await readChildOutput(child);
}

async function createWitnessIdentity(
  name: string,
  alias: string,
  headDirPath: string,
): Promise<string> {
  await requireSuccess(
    `${name} init`,
    runTufa([
      "init",
      "--name",
      name,
      "--head-dir",
      headDirPath,
      "--nopasscode",
    ]),
  );
  const incepted = await requireSuccess(
    `${name} incept`,
    runTufa([
      "incept",
      "--name",
      name,
      "--head-dir",
      headDirPath,
      "--alias",
      alias,
      "--icount",
      "1",
      "--isith",
      "1",
      "--toad",
      "0",
    ]),
  );
  return extractPrefix(incepted.stdout);
}

function startWitnessHost(
  name: string,
  alias: string,
  headDirPath: string,
  httpPort: number,
  tcpPort: number,
): SpawnedChild {
  return spawnChild(
    Deno.execPath(),
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "packages/tufa/mod.ts",
      "witness",
      "start",
      "--name",
      name,
      "--head-dir",
      headDirPath,
      "--alias",
      alias,
      "--url",
      `http://127.0.0.1:${httpPort}`,
      "--tcp-url",
      `tcp://127.0.0.1:${tcpPort}`,
      "--listen-host",
      "127.0.0.1",
    ],
    packageRoot(),
  );
}

async function resolveOobi(
  name: string,
  headDirPath: string,
  url: string,
): Promise<void> {
  const resolved = await requireSuccess(
    `resolve ${url}`,
    runTufa([
      "oobi",
      "resolve",
      "--name",
      name,
      "--head-dir",
      headDirPath,
      "--url",
      url,
    ]),
  );
  assertStringIncludes(resolved.stdout, url);
}

async function initController(
  name: string,
  headDirPath: string,
): Promise<void> {
  await requireSuccess(
    `${name} init`,
    runTufa([
      "init",
      "--name",
      name,
      "--head-dir",
      headDirPath,
      "--nopasscode",
    ]),
  );
}

Deno.test("CLI integration - deployable witness start supports receipt-endpoint inception and combined mailbox hosting", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-witness-cli-" });
  const witness1Name = `wit1-${crypto.randomUUID()}`;
  const witness2Name = `wit2-${crypto.randomUUID()}`;
  const controllerName = `ctrl-${crypto.randomUUID()}`;
  const witness1Alias = "wit1";
  const witness2Alias = "wit2";
  const controllerAlias = "controller";
  const witness1Port = randomPort();
  const witness2Port = randomPort();
  const witness1TcpPort = randomPort();
  const witness2TcpPort = randomPort();

  const witness1Pre = await createWitnessIdentity(
    witness1Name,
    witness1Alias,
    headDirPath,
  );
  const witness2Pre = await createWitnessIdentity(
    witness2Name,
    witness2Alias,
    headDirPath,
  );
  await initController(controllerName, headDirPath);

  const witness1 = startWitnessHost(
    witness1Name,
    witness1Alias,
    headDirPath,
    witness1Port,
    witness1TcpPort,
  );
  const witness2 = startWitnessHost(
    witness2Name,
    witness2Alias,
    headDirPath,
    witness2Port,
    witness2TcpPort,
  );

  try {
    await waitForHealth(witness1Port);
    await waitForHealth(witness2Port);

    const witness1WitnessOobi = `http://127.0.0.1:${witness1Port}/oobi/${witness1Pre}/witness/${witness1Pre}`;
    const witness2WitnessOobi = `http://127.0.0.1:${witness2Port}/oobi/${witness2Pre}/witness/${witness2Pre}`;
    const witness1MailboxOobi = `http://127.0.0.1:${witness1Port}/oobi/${witness1Pre}/mailbox/${witness1Pre}`;

    const mailboxOobiResponse = await fetch(witness1MailboxOobi);
    try {
      assertEquals(mailboxOobiResponse.status, 200);
    } finally {
      await mailboxOobiResponse.body?.cancel().catch(() => undefined);
    }

    await resolveOobi(controllerName, headDirPath, witness1WitnessOobi);
    await resolveOobi(controllerName, headDirPath, witness2WitnessOobi);
    await resolveOobi(controllerName, headDirPath, witness1MailboxOobi);

    const incepted = await requireSuccess(
      "controller incept",
      runTufa([
        "incept",
        "--name",
        controllerName,
        "--head-dir",
        headDirPath,
        "--alias",
        controllerAlias,
        "--transferable",
        "--icount",
        "1",
        "--isith",
        "1",
        "--ncount",
        "1",
        "--nsith",
        "1",
        "--wits",
        witness1Pre,
        "--wits",
        witness2Pre,
        "--toad",
        "2",
        "--receipt-endpoint",
      ]),
    );
    const controllerPre = extractPrefix(incepted.stdout);

    await requireSuccess(
      "controller witness submit",
      runTufa([
        "witness",
        "submit",
        "--name",
        controllerName,
        "--head-dir",
        headDirPath,
        "--alias",
        controllerAlias,
        "--receipt-endpoint",
      ]),
    );

    const mailboxAdded = await requireSuccess(
      "controller mailbox add",
      runTufa([
        "mailbox",
        "add",
        "--name",
        controllerName,
        "--head-dir",
        headDirPath,
        "--alias",
        controllerAlias,
        "--mailbox",
        witness1Pre,
      ]),
    );
    assertStringIncludes(mailboxAdded.stdout, `added ${witness1Pre}`);

    const mailboxListed = await requireSuccess(
      "controller mailbox list",
      runTufa([
        "mailbox",
        "list",
        "--name",
        controllerName,
        "--head-dir",
        headDirPath,
        "--alias",
        controllerAlias,
      ]),
    );
    assertStringIncludes(mailboxListed.stdout, witness1Pre);

    await run(function*() {
      const controllerHby = yield* createHabery({
        name: controllerName,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      const witness1Hby = yield* createHabery({
        name: witness1Name,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      const witness2Hby = yield* createHabery({
        name: witness2Name,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        const inceptionSaid = controllerHby.db.kels.getLast(controllerPre, 0);
        assertExists(inceptionSaid);
        assertEquals(
          controllerHby.db.wigs.get(dgKey(controllerPre, inceptionSaid)).length,
          2,
        );
        assertEquals(witness1Hby.db.getKever(controllerPre)?.sn, 0);
        assertEquals(witness2Hby.db.getKever(controllerPre)?.sn, 0);
        assertEquals(
          witness1Hby.db.ends.get([
            controllerPre,
            EndpointRoles.mailbox,
            witness1Pre,
          ])?.allowed,
          true,
        );
      } finally {
        yield* witness2Hby.close();
        yield* witness1Hby.close();
        yield* controllerHby.close();
      }
    });
  } finally {
    await Promise.all([stopChild(witness1), stopChild(witness2)]);
  }
});

Deno.test("CLI integration - receipt-endpoint rotation and interaction converge receipts across all witnesses", async () => {
  const headDirPath = await Deno.makeTempDir({
    prefix: "tufa-witness-rotate-",
  });
  const witness1Name = `wit1-${crypto.randomUUID()}`;
  const witness2Name = `wit2-${crypto.randomUUID()}`;
  const witness3Name = `wit3-${crypto.randomUUID()}`;
  const controllerName = `ctrl-${crypto.randomUUID()}`;
  const controllerAlias = "controller";

  const witness1Pre = await createWitnessIdentity(
    witness1Name,
    "wit1",
    headDirPath,
  );
  const witness2Pre = await createWitnessIdentity(
    witness2Name,
    "wit2",
    headDirPath,
  );
  const witness3Pre = await createWitnessIdentity(
    witness3Name,
    "wit3",
    headDirPath,
  );
  await initController(controllerName, headDirPath);

  const ports = [
    { http: randomPort(), tcp: randomPort() },
    { http: randomPort(), tcp: randomPort() },
    { http: randomPort(), tcp: randomPort() },
  ];
  const children = [
    startWitnessHost(
      witness1Name,
      "wit1",
      headDirPath,
      ports[0]!.http,
      ports[0]!.tcp,
    ),
    startWitnessHost(
      witness2Name,
      "wit2",
      headDirPath,
      ports[1]!.http,
      ports[1]!.tcp,
    ),
    startWitnessHost(
      witness3Name,
      "wit3",
      headDirPath,
      ports[2]!.http,
      ports[2]!.tcp,
    ),
  ];

  try {
    await Promise.all(ports.map(({ http }) => waitForHealth(http)));

    await resolveOobi(
      controllerName,
      headDirPath,
      `http://127.0.0.1:${ports[0]!.http}/oobi/${witness1Pre}/witness/${witness1Pre}`,
    );
    await resolveOobi(
      controllerName,
      headDirPath,
      `http://127.0.0.1:${ports[1]!.http}/oobi/${witness2Pre}/witness/${witness2Pre}`,
    );
    await resolveOobi(
      controllerName,
      headDirPath,
      `http://127.0.0.1:${ports[2]!.http}/oobi/${witness3Pre}/witness/${witness3Pre}`,
    );

    const incepted = await requireSuccess(
      "controller incept",
      runTufa([
        "incept",
        "--name",
        controllerName,
        "--head-dir",
        headDirPath,
        "--alias",
        controllerAlias,
        "--transferable",
        "--icount",
        "1",
        "--isith",
        "1",
        "--ncount",
        "1",
        "--nsith",
        "1",
        "--wits",
        witness1Pre,
        "--wits",
        witness2Pre,
        "--toad",
        "2",
        "--receipt-endpoint",
      ]),
    );
    const controllerPre = extractPrefix(incepted.stdout);

    await requireSuccess(
      "controller rotate add witness3",
      runTufa([
        "rotate",
        "--name",
        controllerName,
        "--head-dir",
        headDirPath,
        "--alias",
        controllerAlias,
        "--receipt-endpoint",
        "--witness-add",
        witness3Pre,
        "--toad",
        "3",
      ]),
    );

    await requireSuccess(
      "controller interact after witness expansion",
      runTufa([
        "interact",
        "--name",
        controllerName,
        "--head-dir",
        headDirPath,
        "--alias",
        controllerAlias,
        "--receipt-endpoint",
        "--data",
        "{\"anchor\":\"acdc\"}",
      ]),
    );

    await run(function*() {
      const controllerHby = yield* createHabery({
        name: controllerName,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      const witness1Hby = yield* createHabery({
        name: witness1Name,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      const witness2Hby = yield* createHabery({
        name: witness2Name,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      const witness3Hby = yield* createHabery({
        name: witness3Name,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        const rotationSaid = controllerHby.db.kels.getLast(controllerPre, 1);
        const interactionSaid = controllerHby.db.kels.getLast(controllerPre, 2);
        assertExists(rotationSaid);
        assertExists(interactionSaid);
        assertEquals(
          controllerHby.db.wigs.get(dgKey(controllerPre, rotationSaid)).length,
          3,
        );
        assertEquals(
          controllerHby.db.wigs.get(dgKey(controllerPre, interactionSaid))
            .length,
          3,
        );
        for (const hby of [witness1Hby, witness2Hby, witness3Hby]) {
          assertEquals(hby.db.getKever(controllerPre)?.sn, 2);
          assertEquals(
            hby.db.wigs.get(dgKey(controllerPre, rotationSaid)).length,
            3,
          );
          assertEquals(
            hby.db.wigs.get(dgKey(controllerPre, interactionSaid)).length,
            3,
          );
        }
      } finally {
        yield* witness3Hby.close();
        yield* witness2Hby.close();
        yield* witness1Hby.close();
        yield* controllerHby.close();
      }
    });
  } finally {
    await Promise.all(children.map((child) => stopChild(child)));
  }
});

Deno.test("CLI integration - successive rotate and interact events stay fully witnessed across three witnesses", async () => {
  const headDirPath = await Deno.makeTempDir({
    prefix: "tufa-witness-long-chain-",
  });
  const witness1Name = `wit1-${crypto.randomUUID()}`;
  const witness2Name = `wit2-${crypto.randomUUID()}`;
  const witness3Name = `wit3-${crypto.randomUUID()}`;
  const controllerName = `ctrl-${crypto.randomUUID()}`;
  const controllerAlias = "controller";

  const witness1Pre = await createWitnessIdentity(
    witness1Name,
    "wit1",
    headDirPath,
  );
  const witness2Pre = await createWitnessIdentity(
    witness2Name,
    "wit2",
    headDirPath,
  );
  const witness3Pre = await createWitnessIdentity(
    witness3Name,
    "wit3",
    headDirPath,
  );
  await initController(controllerName, headDirPath);

  const ports = [
    { http: randomPort(), tcp: randomPort() },
    { http: randomPort(), tcp: randomPort() },
    { http: randomPort(), tcp: randomPort() },
  ];
  const children = [
    startWitnessHost(
      witness1Name,
      "wit1",
      headDirPath,
      ports[0]!.http,
      ports[0]!.tcp,
    ),
    startWitnessHost(
      witness2Name,
      "wit2",
      headDirPath,
      ports[1]!.http,
      ports[1]!.tcp,
    ),
    startWitnessHost(
      witness3Name,
      "wit3",
      headDirPath,
      ports[2]!.http,
      ports[2]!.tcp,
    ),
  ];

  try {
    await Promise.all(ports.map(({ http }) => waitForHealth(http)));

    await resolveOobi(
      controllerName,
      headDirPath,
      `http://127.0.0.1:${ports[0]!.http}/oobi/${witness1Pre}/witness/${witness1Pre}`,
    );
    await resolveOobi(
      controllerName,
      headDirPath,
      `http://127.0.0.1:${ports[1]!.http}/oobi/${witness2Pre}/witness/${witness2Pre}`,
    );
    await resolveOobi(
      controllerName,
      headDirPath,
      `http://127.0.0.1:${ports[2]!.http}/oobi/${witness3Pre}/witness/${witness3Pre}`,
    );

    const incepted = await requireSuccess(
      "controller incept with three witnesses",
      runTufa([
        "incept",
        "--name",
        controllerName,
        "--head-dir",
        headDirPath,
        "--alias",
        controllerAlias,
        "--transferable",
        "--icount",
        "1",
        "--isith",
        "1",
        "--ncount",
        "1",
        "--nsith",
        "1",
        "--wits",
        witness1Pre,
        "--wits",
        witness2Pre,
        "--wits",
        witness3Pre,
        "--toad",
        "2",
        "--receipt-endpoint",
      ]),
    );
    const controllerPre = extractPrefix(incepted.stdout);

    const steps = [
      {
        kind: "rotate",
        label: "controller rotate step 1",
        expectedSn: 1,
        args: ["--receipt-endpoint", "--toad", "2"],
      },
      {
        kind: "interact",
        label: "controller interact step 1",
        expectedSn: 2,
        args: [
          "--receipt-endpoint",
          "--data",
          "{\"anchor\":\"step-1\"}",
        ],
      },
      {
        kind: "rotate",
        label: "controller rotate step 2",
        expectedSn: 3,
        args: ["--receipt-endpoint", "--toad", "2"],
      },
      {
        kind: "interact",
        label: "controller interact step 2",
        expectedSn: 4,
        args: [
          "--receipt-endpoint",
          "--data",
          "{\"anchor\":\"step-2\"}",
        ],
      },
      {
        kind: "rotate",
        label: "controller rotate step 3",
        expectedSn: 5,
        args: ["--receipt-endpoint", "--toad", "2"],
      },
      {
        kind: "interact",
        label: "controller interact step 3",
        expectedSn: 6,
        args: [
          "--receipt-endpoint",
          "--data",
          "{\"anchor\":\"step-3\"}",
        ],
      },
    ] as const;

    for (const step of steps) {
      const result = await requireSuccess(
        step.label,
        runTufa([
          step.kind,
          "--name",
          controllerName,
          "--head-dir",
          headDirPath,
          "--alias",
          controllerAlias,
          ...step.args,
        ]),
      );
      assertStringIncludes(
        result.stdout,
        `New Sequence No.  ${step.expectedSn}`,
      );
    }

    await run(function*() {
      const controllerHby = yield* createHabery({
        name: controllerName,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      const witness1Hby = yield* createHabery({
        name: witness1Name,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      const witness2Hby = yield* createHabery({
        name: witness2Name,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      const witness3Hby = yield* createHabery({
        name: witness3Name,
        headDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        const witnessHbys = [witness1Hby, witness2Hby, witness3Hby];
        const expectedSaids: string[] = [];

        const assertFullyWitnessedEverywhere = (sn: number): string => {
          const controllerSaid = controllerHby.db.kels.getLast(
            controllerPre,
            sn,
          );
          assertExists(controllerSaid);
          assertEquals(
            controllerHby.db.getFel(controllerPre, sn),
            controllerSaid,
          );
          assertEquals(
            controllerHby.db.wigs.get(dgKey(controllerPre, controllerSaid))
              .length,
            3,
          );

          for (const hby of witnessHbys) {
            assertEquals(
              hby.db.kels.getLast(controllerPre, sn),
              controllerSaid,
            );
            assertEquals(hby.db.getFel(controllerPre, sn), controllerSaid);
            assertEquals(
              hby.db.wigs.get(dgKey(controllerPre, controllerSaid)).length,
              3,
            );
          }

          return controllerSaid;
        };

        const finalState = controllerHby.db.getState(controllerPre);
        assertEquals(finalState?.s, "6");
        assertEquals(finalState?.bt, "2");
        assertEquals(finalState?.b, [witness1Pre, witness2Pre, witness3Pre]);
        assertEquals(controllerHby.db.getKever(controllerPre)?.sn, 6);
        for (const hby of witnessHbys) {
          assertEquals(hby.db.getKever(controllerPre)?.sn, 6);
        }

        for (let sn = 0; sn <= 6; sn += 1) {
          expectedSaids.push(assertFullyWitnessedEverywhere(sn));
        }

        const ilks = expectedSaids.map((said) => {
          const event = controllerHby.db.getEvtSerder(controllerPre, said);
          assertExists(event);
          return event.ked?.["t"];
        });
        assertEquals(ilks, ["icp", "rot", "ixn", "rot", "ixn", "rot", "ixn"]);

        for (
          const [sn, anchor] of [
            [2, "step-1"],
            [4, "step-2"],
            [6, "step-3"],
          ] as const
        ) {
          const said = expectedSaids[sn];
          assertExists(said);
          const event = controllerHby.db.getEvtSerder(controllerPre, said);
          assertExists(event);
          assertEquals(event.ked?.["a"], [{ anchor }]);
        }
      } finally {
        yield* witness3Hby.close();
        yield* witness2Hby.close();
        yield* witness1Hby.close();
        yield* controllerHby.close();
      }
    });
  } finally {
    await Promise.all(children.map((child) => stopChild(child)));
  }
});
