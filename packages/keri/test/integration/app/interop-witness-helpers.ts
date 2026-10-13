/**
 * Shared setup/assertions for the live witness matrix and six-witness qualification.
 *
 * These scenarios prove witness behavior against explicit KERIpy witnesses
 * instead of relying on all-Tufa witness topologies.
 */
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { run } from "npm:effection@^3.6.0";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import {
  createInteropContext,
  extractPrefix,
  inspectCompatHabery,
  requireSuccess,
  runCmd,
  runCmdWithTimeout,
  runTufaWithTimeout,
  startKeriPyWitnessHarness,
  startTufaWitnessHarness,
  type TufaWitnessHarness,
} from "./interop-test-helpers.ts";

/** Stable test-only controller passcode. */
export const PASSCODE = "MyPasscodeARealSecret";
/** Stable test-only inception salt. */
export const SALT = "0AAwMTIzNDU2Nzg5YWJjZGVm";

/** Initialize one unencrypted Tufa controller store. */
export async function initTufaStore(
  name: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
): Promise<void> {
  await requireSuccess(
    `${name} init`,
    runTufaWithTimeout(
      [
        "init",
        "--name",
        name,
        "--head-dir",
        headDirPath,
        "--nopasscode",
      ],
      env,
      repoRoot,
      20_000,
    ),
  );
}

/** Require the latest establishment event to carry every expected witness receipt. */
export function assertFullyWitnessed(
  hby: Habery,
  pre: string,
  sn: number,
  expectedWitnessCount: number,
): string {
  const said = hby.db.kels.getLast(pre, sn);
  assertExists(said);
  assertEquals(hby.db.wigs.get(dgKey(pre, said)).length, expectedWitnessCount);
  return said;
}

/** Verify that one witness serves KEL replay for the controller at or beyond `sn`. */
export async function assertWitnessKelVisible(
  origin: string,
  pre: string,
  sn: number,
  said: string,
): Promise<void> {
  const url = new URL("/query", origin);
  url.searchParams.set("typ", "kel");
  url.searchParams.set("pre", pre);
  url.searchParams.set("sn", String(sn));

  const response = await fetch(url);
  const body = await response.text();
  assertEquals(
    response.status,
    200,
    `Expected witness KEL replay from ${url}, got ${response.status}: ${body}`,
  );
  assertStringIncludes(body, `"i":"${pre}"`);
  assertStringIncludes(body, said);
}

/** Verify that one witness serves stored receipts for the controller event. */
export async function assertWitnessReceiptVisible(
  origin: string,
  pre: string,
  said: string,
  sn: number,
): Promise<void> {
  const bySn = new URL("/receipts", origin);
  bySn.searchParams.set("pre", pre);
  bySn.searchParams.set("sn", String(sn));

  const bySaid = new URL("/receipts", origin);
  bySaid.searchParams.set("pre", pre);
  bySaid.searchParams.set("said", said);

  for (const url of [bySn, bySaid]) {
    const response = await fetch(url);
    const body = await response.text();
    assertEquals(
      response.status,
      200,
      `Expected witness receipt from ${url}, got ${response.status}: ${body}`,
    );
    assertStringIncludes(body, `"i":"${pre}"`);
    assertStringIncludes(body, `"d":"${said}"`);
  }
}

/** Resolve witness OOBIs into a Tufa controller store. */
export async function resolveWitnessesForTufa(
  controllerName: string,
  headDirPath: string,
  env: Record<string, string>,
  repoRoot: string,
  witnesses: readonly {
    alias: string;
    controllerOobi?: string;
    witnessOobi?: string;
  }[],
): Promise<void> {
  for (const witness of witnesses) {
    const urls = [witness.controllerOobi, witness.witnessOobi].filter(
      (url, index, all): url is string => typeof url === "string" && all.indexOf(url) === index,
    );
    for (const url of urls) {
      await requireSuccess(
        `tufa resolve ${witness.alias} ${url}`,
        runTufaWithTimeout(
          [
            "oobi",
            "resolve",
            "--name",
            controllerName,
            "--head-dir",
            headDirPath,
            "--url",
            url,
            "--oobi-alias",
            witness.alias,
          ],
          env,
          repoRoot,
          20_000,
        ),
      );
    }
  }
}

/** Resolve witness OOBIs into a KLI controller store. */
export async function resolveWitnessesForKli(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  base: string,
  witnesses: readonly {
    alias: string;
    controllerOobi?: string;
    witnessOobi?: string;
  }[],
): Promise<void> {
  for (const witness of witnesses) {
    const urls = [witness.controllerOobi, witness.witnessOobi].filter(
      (url, index, all): url is string => typeof url === "string" && all.indexOf(url) === index,
    );
    for (const url of urls) {
      await requireSuccess(
        `kli resolve ${witness.alias} ${url}`,
        runCmdWithTimeout(
          kliCommand,
          [
            "oobi",
            "resolve",
            "--name",
            name,
            "--base",
            base,
            "--passcode",
            PASSCODE,
            "--oobi",
            url,
            "--oobi-alias",
            witness.alias,
          ],
          env,
          20_000,
        ),
      );
    }
  }
}

/** Submit the current KLI controller event to witnesses until the store converges. */
export async function submitKliWitnessReceipts(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  base: string,
  alias: string,
): Promise<void> {
  await requireSuccess(
    `kli witness submit ${alias}`,
    runCmdWithTimeout(
      kliCommand,
      [
        "witness",
        "submit",
        "--name",
        name,
        "--base",
        base,
        "--passcode",
        PASSCODE,
        "--alias",
        alias,
        "--receipt-endpoint",
      ],
      env,
      30_000,
    ),
  );
}

/** Query KEL updates for one prefix into a KLI controller store. */
export async function queryKliPrefix(
  kliCommand: string,
  env: Record<string, string>,
  name: string,
  base: string,
  alias: string,
  prefix: string,
): Promise<void> {
  await requireSuccess(
    `kli query ${alias}`,
    runCmdWithTimeout(
      kliCommand,
      [
        "query",
        "--name",
        name,
        "--base",
        base,
        "--passcode",
        PASSCODE,
        "--alias",
        alias,
        "--prefix",
        prefix,
      ],
      env,
      20_000,
    ),
  );
}

/** Dump targeted DB state via `tufa db dump` for interop debugging. */
export async function dumpTufaDbTargets(
  {
    name,
    headDirPath,
    base,
    compat = false,
  }: {
    name: string;
    headDirPath?: string;
    base?: string;
    compat?: boolean;
  },
  env: Record<string, string>,
  repoRoot: string,
  prefix?: string,
): Promise<string> {
  const targets = [
    "baser.kels",
    "baser.wigs",
    "baser.states",
    "baser.locs",
    "baser.ends",
  ];
  const sections: string[] = [];
  for (const target of targets) {
    const args = [
      "db",
      "dump",
      target,
      "--name",
      name,
      ...(base ? ["--base", base] : []),
      ...(headDirPath ? ["--head-dir", headDirPath] : []),
      ...(compat ? ["--compat"] : []),
      ...(prefix ? ["--prefix", prefix] : []),
      "--limit",
      "20",
    ];
    const result = await runTufaWithTimeout(args, env, repoRoot, 20_000);
    sections.push(
      `## ${target}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  return sections.join("\n\n");
}

/** Assert KERIpy witness stores converged on the controller event and receipts. */
export async function assertKeriPyWitnessStores(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  harness: Awaited<ReturnType<typeof startKeriPyWitnessHarness>>,
  activeAliases: readonly string[],
  controllerPre: string,
  sn: number,
  expectedWitnessCount: number,
): Promise<void> {
  const compatCtx = { ...ctx, home: harness.home, env: harness.env };
  for (const alias of activeAliases) {
    const node = harness.node(alias);
    await run(() =>
      inspectCompatHabery(
        compatCtx,
        {
          name: node.name,
          base: harness.base,
          compat: true,
          readonly: true,
          skipConfig: true,
          skipSignator: true,
        },
        (hby) => {
          const latestSn = hby.db.getKever(controllerPre)?.sn;
          assertExists(latestSn);
          assertEquals(latestSn >= sn, true);
          assertFullyWitnessed(hby, controllerPre, sn, expectedWitnessCount);
        },
      )
    );
  }
}

/** Assert Tufa witness stores converged on the controller event and receipts. */
export async function assertTufaWitnessStores(
  headDirPath: string,
  activeWitnesses: readonly { name: string }[],
  controllerPre: string,
  sn: number,
  expectedWitnessCount: number,
): Promise<void> {
  await run(function*() {
    const stores = [];
    for (const witness of activeWitnesses) {
      stores.push(
        yield* createHabery({
          name: witness.name,
          headDirPath,
          skipConfig: true,
          skipSignator: true,
        }),
      );
    }

    try {
      for (const hby of stores) {
        const latestSn = hby.db.getKever(controllerPre)?.sn;
        assertExists(latestSn);
        assertEquals(latestSn >= sn, true);
        assertFullyWitnessed(hby, controllerPre, sn, expectedWitnessCount);
      }
    } finally {
      for (const hby of [...stores].reverse()) {
        yield* hby.close();
      }
    }
  });
}

/** Assert one KLI controller store converged on the controller event and receipts. */
export async function assertKliControllerStore(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  name: string,
  base: string,
  controllerPre: string,
  sn: number,
  expectedWitnessCount: number,
): Promise<string> {
  let said = "";
  await run(() =>
    inspectCompatHabery(
      ctx,
      {
        name,
        base,
        compat: true,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
        bran: PASSCODE,
      },
      (hby) => {
        said = assertFullyWitnessed(
          hby,
          controllerPre,
          sn,
          expectedWitnessCount,
        );
      },
    )
  );
  return said;
}

/** Drive a KLI controller store to full witness convergence for one event. */
export async function convergeKliControllerStore(
  ctx: Awaited<ReturnType<typeof createInteropContext>>,
  {
    name,
    base,
    alias,
    controllerPre,
    sn,
    expectedWitnessCount,
    allowQuery = false,
    attempts = 4,
  }: {
    name: string;
    base: string;
    alias: string;
    controllerPre: string;
    sn: number;
    expectedWitnessCount: number;
    allowQuery?: boolean;
    attempts?: number;
  },
): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await submitKliWitnessReceipts(
      ctx.kliCommand,
      ctx.env,
      name,
      base,
      alias,
    );
    if (allowQuery) {
      await queryKliPrefix(
        ctx.kliCommand,
        ctx.env,
        name,
        base,
        alias,
        controllerPre,
      );
    }
    try {
      return await assertKliControllerStore(
        ctx,
        name,
        base,
        controllerPre,
        sn,
        expectedWitnessCount,
      );
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
}
