import { run, type Operation } from "npm:effection@^3.6.0";
import {
  type AgentRuntime,
  createAgentRuntime,
  processRuntimeUntil,
} from "../../../src/app/agent-runtime.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import {
  extractLastNonEmptyLine,
  inspectCompatHabery,
  localKeriPySourceEnv,
  readChildOutput,
  requireSuccess,
  runCmd,
  runCmdWithTimeout,
  runTufa,
  runTufaWithTimeout,
  spawnChild,
  stopChild,
  type CmdResult,
  type InteropContext,
  type SpawnedChild,
} from "./interop-test-helpers.ts";

export const INTEROP_PASSCODE = "MyPasscodeARealSecret";
export const INTEROP_SALT = "0AAwMTIzNDU2Nzg5YWJjZGVm";

export interface TufaStoreRef {
  name: string;
  base: string;
  headDirPath: string;
  passcode: string;
  alias: string;
  pre: string;
}

export interface KliStoreRef {
  name: string;
  base: string;
  passcode: string;
  alias: string;
  pre: string;
}

export interface TufaMailboxProviderFixture extends TufaStoreRef {
  origin: string;
  controllerOobi: string;
  mailboxOobi: string;
  close(): Promise<void>;
}

export interface TufaRuntimeSnapshot {
  hby: Habery;
  runtime: AgentRuntime;
  hab?: Hab;
}

export async function initTufaStore(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    salt?: string;
  },
): Promise<void> {
  await requireSuccess(
    `${args.name} init`,
    runTufa(
      [
        "init",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        ...(args.salt ? ["--salt", args.salt] : []),
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
}

export async function inceptTufaAlias(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    alias: string;
    transferable?: boolean;
  },
): Promise<string> {
  const result = await requireSuccess(
    `${args.name} incept ${args.alias}`,
    runTufa(
      [
        "incept",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        ...(args.transferable === false
          ? []
          : [
            "--transferable",
            "--isith",
            "1",
            "--icount",
            "1",
            "--nsith",
            "1",
            "--ncount",
            "1",
            "--toad",
            "0",
          ]),
        ...(args.transferable === false
          ? [
            "--isith",
            "1",
            "--icount",
            "1",
          ]
          : []),
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  return extractPrefixLine(result.stdout);
}

export async function initKliStore(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    passcode: string;
    salt?: string;
  },
): Promise<void> {
  await waitForEventuallySuccess(
    `${args.name} init`,
    () =>
      runCmd(ctx.kliCommand, [
        "init",
        "--name",
        args.name,
        "--base",
        args.base,
        "--passcode",
        args.passcode,
        ...(args.salt ? ["--salt", args.salt] : []),
      ], ctx.env),
    {
      timeoutMs: 20_000,
      intervalMs: 500,
    },
  );
}

export async function inceptKliAlias(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    passcode: string;
    alias: string;
    transferable?: boolean;
    wits?: string[];
    toad?: number;
  },
): Promise<string> {
  const result = await requireSuccess(
    `${args.name} incept ${args.alias}`,
    runCmd(ctx.kliCommand, [
      "incept",
      "--name",
      args.name,
      "--base",
      args.base,
      "--passcode",
      args.passcode,
      "--alias",
      args.alias,
      ...(args.transferable === false
        ? [
          "--icount",
          "1",
          "--isith",
          "1",
          "--ncount",
          "1",
          "--nsith",
          "1",
          "--toad",
          String(args.toad ?? 0),
        ]
        : [
          "--transferable",
          "--isith",
          "1",
          "--icount",
          "1",
          "--nsith",
          "1",
          "--ncount",
          "1",
          "--toad",
          String(args.toad ?? 0),
        ]),
      ...(args.wits?.flatMap((wit) => ["--wits", wit]) ?? []),
    ], ctx.env),
  );
  return extractPrefixLine(result.stdout);
}

export async function addTufaHostedRoute(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    alias: string;
    url: string;
    eid: string;
    mailbox?: boolean;
  },
): Promise<void> {
  await requireSuccess(
    `${args.name} loc add ${args.alias}`,
    runTufa(
      [
        "loc",
        "add",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        "--url",
        args.url,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  await requireSuccess(
    `${args.name} controller end role ${args.alias}`,
    runTufa(
      [
        "ends",
        "add",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        "--role",
        "controller",
        "--eid",
        args.eid,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
  if (!args.mailbox) {
    return;
  }
  await requireSuccess(
    `${args.name} mailbox end role ${args.alias}`,
    runTufa(
      [
        "ends",
        "add",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        "--role",
        "mailbox",
        "--eid",
        args.eid,
      ],
      ctx.env,
      ctx.repoRoot,
    ),
  );
}

export async function addKliHostedRoute(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    passcode: string;
    alias: string;
    url: string;
    eid: string;
    mailbox?: boolean;
  },
): Promise<void> {
  await requireSuccess(
    `${args.name} location add ${args.alias}`,
    runCmd(ctx.kliCommand, [
      "location",
      "add",
      "--name",
      args.name,
      "--base",
      args.base,
      "--passcode",
      args.passcode,
      "--alias",
      args.alias,
      "--url",
      args.url,
    ], ctx.env),
  );
  await requireSuccess(
    `${args.name} controller end role ${args.alias}`,
    runCmd(ctx.kliCommand, [
      "ends",
      "add",
      "--name",
      args.name,
      "--base",
      args.base,
      "--passcode",
      args.passcode,
      "--alias",
      args.alias,
      "--role",
      "controller",
      "--eid",
      args.eid,
    ], ctx.env),
  );
  if (!args.mailbox) {
    return;
  }
  await requireSuccess(
    `${args.name} mailbox end role ${args.alias}`,
    runCmd(ctx.kliCommand, [
      "ends",
      "add",
      "--name",
      args.name,
      "--base",
      args.base,
      "--passcode",
      args.passcode,
      "--alias",
      args.alias,
      "--role",
      "mailbox",
      "--eid",
      args.eid,
    ], ctx.env),
  );
}

export async function resolveTufaOobi(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    url: string;
    alias: string;
  },
): Promise<void> {
  await requireSuccess(
    `${args.name} resolve ${args.alias}`,
    runTufaWithTimeout(
      [
        "oobi",
        "resolve",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--url",
        args.url,
        "--oobi-alias",
        args.alias,
      ],
      ctx.env,
      ctx.repoRoot,
      20_000,
    ),
  );
}

export async function resolveKliOobi(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    passcode: string;
    oobi: string;
    alias: string;
  },
): Promise<void> {
  await requireSuccess(
    `${args.name} resolve ${args.alias}`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "oobi",
        "resolve",
        "--name",
        args.name,
        "--base",
        args.base,
        "--passcode",
        args.passcode,
        "--oobi",
        args.oobi,
        "--oobi-alias",
        args.alias,
      ],
      ctx.env,
      20_000,
    ),
  );
}

export async function addTufaMailbox(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    alias: string;
    mailbox: string;
  },
): Promise<CmdResult> {
  return await requireSuccess(
    `${args.name} mailbox add ${args.alias}`,
    runTufaWithTimeout(
      [
        "mailbox",
        "add",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        "--mailbox",
        args.mailbox,
      ],
      ctx.env,
      ctx.repoRoot,
      20_000,
    ),
  );
}

export async function addKliMailbox(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    passcode: string;
    alias: string;
    mailbox: string;
  },
): Promise<CmdResult> {
  return await requireSuccess(
    `${args.name} mailbox add ${args.alias}`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "mailbox",
        "add",
        "--name",
        args.name,
        "--base",
        args.base,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        "--mailbox",
        args.mailbox,
      ],
      ctx.env,
      20_000,
    ),
  );
}

export async function generateTufaMailboxOobi(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    alias: string;
  },
): Promise<string> {
  const result = await requireSuccess(
    `${args.name} mailbox oobi ${args.alias}`,
    runTufaWithTimeout(
      [
        "oobi",
        "generate",
        "--name",
        args.name,
        "--base",
        args.base,
        "--head-dir",
        args.headDirPath,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        "--role",
        "mailbox",
      ],
      ctx.env,
      ctx.repoRoot,
      20_000,
    ),
  );
  return extractLastNonEmptyLine(result.stdout);
}

export async function generateKliMailboxOobi(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    passcode: string;
    alias: string;
  },
): Promise<string> {
  const result = await requireSuccess(
    `${args.name} mailbox oobi ${args.alias}`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "oobi",
        "generate",
        "--name",
        args.name,
        "--base",
        args.base,
        "--passcode",
        args.passcode,
        "--alias",
        args.alias,
        "--role",
        "mailbox",
      ],
      ctx.env,
      20_000,
    ),
  );
  return extractLastNonEmptyLine(result.stdout);
}

export async function startTufaAgentHost(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    port: number;
  },
): Promise<SpawnedChild> {
  const child = spawnChild(
    "deno",
    [
      "run",
      "--allow-all",
      "--unstable-ffi",
      "mod.ts",
      "agent",
      "--name",
      args.name,
      "--base",
      args.base,
      "--head-dir",
      args.headDirPath,
      "--passcode",
      args.passcode,
      "--port",
      String(args.port),
    ],
    ctx.env,
    ctx.repoRoot,
  );
  try {
    await waitForChildHealth(child, args.port);
  } catch (error) {
    const details = await stopChild(child);
    throw new Error(
      `Failed to start Tufa agent host on ${args.port}: ${
        error instanceof Error ? error.message : String(error)
      }\n${details}`,
    );
  }
  return child;
}

export async function startKliMailboxHost(
  ctx: InteropContext,
  args: {
    pythonCommand: string;
    name: string;
    base: string;
    passcode: string;
    alias: string;
    port: number;
  },
): Promise<SpawnedChild> {
  const child = spawnChild(
    args.pythonCommand,
    [
      "-m",
      "keri.cli.kli",
      "mailbox",
      "start",
      "--name",
      args.name,
      "--base",
      args.base,
      "--passcode",
      args.passcode,
      "--alias",
      args.alias,
      "--http",
      String(args.port),
    ],
    localKeriPySourceEnv(ctx.env),
  );
  try {
    await waitForChildHealth(child, args.port);
  } catch (error) {
    const details = await stopChild(child);
    throw new Error(
      `Failed to start KLI mailbox host on ${args.port}: ${
        error instanceof Error ? error.message : String(error)
      }\n${details}`,
    );
  }
  return child;
}

export async function setupTufaMailboxProvider(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    salt: string;
    alias?: string;
    port: number;
  },
): Promise<TufaMailboxProviderFixture> {
  const alias = args.alias ?? "relay";
  await initTufaStore(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: args.passcode,
    salt: args.salt,
  });
  const pre = await inceptTufaAlias(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: args.passcode,
    alias,
    transferable: false,
  });
  const origin = `http://127.0.0.1:${args.port}`;
  await addTufaHostedRoute(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: args.passcode,
    alias,
    url: origin,
    eid: pre,
    mailbox: true,
  });
  const child = await startTufaAgentHost(ctx, {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: args.passcode,
    port: args.port,
  });
  return {
    name: args.name,
    base: args.base,
    headDirPath: args.headDirPath,
    passcode: args.passcode,
    alias,
    pre,
    origin,
    controllerOobi: `${origin}/oobi/${pre}/controller`,
    mailboxOobi: `${origin}/oobi/${pre}/mailbox/${pre}`,
    close: async () => {
      await stopChild(child);
    },
  };
}

export async function waitForEventuallySuccess(
  label: string,
  action: () => Promise<CmdResult>,
  options: {
    timeoutMs?: number;
    intervalMs?: number;
  } = {},
): Promise<CmdResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const intervalMs = options.intervalMs ?? 250;
  const deadline = Date.now() + timeoutMs;
  let lastResult: CmdResult | null = null;

  while (Date.now() < deadline) {
    const result = await action();
    if (result.code === 0) {
      return result;
    }
    lastResult = result;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `${label} did not succeed within ${timeoutMs}ms.\n${
      lastResult
        ? `stdout:\n${lastResult.stdout}\nstderr:\n${lastResult.stderr}`
        : "No command result captured."
    }`,
  );
}

export async function waitForChildSuccess(
  label: string,
  child: SpawnedChild,
  timeoutMs = 30_000,
): Promise<string> {
  const timedOut = Symbol("timedOut");
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const winner = await Promise.race([
    child.status,
    new Promise<symbol>((resolve) => {
      timeoutId = setTimeout(() => resolve(timedOut), timeoutMs);
    }),
  ]);
  if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
  }

  if (winner === timedOut) {
    const details = await stopChild(child);
    throw new Error(
      `${label} timed out after ${timeoutMs}ms.\n${details}`,
    );
  }

  const status = winner as Deno.CommandStatus;
  const output = await readChildOutput(child);
  if (status.code !== 0) {
    throw new Error(`${label} failed.\n${output}`);
  }
  return output;
}

export async function pumpTufaRuntimeUntil(
  store: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
    alias?: string;
  },
  done: (snapshot: TufaRuntimeSnapshot) => boolean,
  options: {
    maxTurns?: number;
    pollMailbox?: boolean;
  } = {},
): Promise<void> {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: store.name,
      base: store.base,
      headDirPath: store.headDirPath,
      bran: store.passcode,
      skipConfig: true,
      skipSignator: false,
    });
    try {
      const hab = store.alias ? hby.habByName(store.alias) ?? undefined : undefined;
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      try {
        yield* processRuntimeUntil(
          runtime,
          () => done({ hby, runtime, hab }),
          {
            hab,
            maxTurns: options.maxTurns ?? 128,
            pollMailbox: options.pollMailbox ?? true,
          },
        );
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close();
    }
  });
}

export async function inspectTufaHabery<T>(
  store: {
    name: string;
    base: string;
    headDirPath: string;
    passcode: string;
  },
  inspect: (hby: Habery) => T,
): Promise<T> {
  let value!: T;
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: store.name,
      base: store.base,
      headDirPath: store.headDirPath,
      readonly: true,
      bran: store.passcode,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      value = inspect(hby);
    } finally {
      yield* hby.close();
    }
  });
  return value;
}

export async function inspectCompatKeverSn(
  ctx: InteropContext,
  store: {
    name: string;
    base: string;
    passcode: string;
  },
  pre: string,
): Promise<number | null> {
  let sn: number | null = null;
  await run(() =>
    inspectCompatHabery(
      ctx,
      {
        name: store.name,
        base: store.base,
        compat: true,
        readonly: true,
        skipConfig: true,
        skipSignator: true,
        bran: store.passcode,
      },
      (hby) => {
        sn = hby.db.getKever(pre)?.sn ?? null;
      },
    )
  );
  return sn;
}

function extractPrefixLine(output: string): string {
  const line = output.split(/\r?\n/).find((entry) =>
    entry.trim().startsWith("Prefix")
  );
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  const parts = line.trim().split(/\s+/);
  return parts[parts.length - 1]!;
}

async function waitForChildHealth(
  child: SpawnedChild,
  port: number,
): Promise<void> {
  const deadline = Date.now() + 15_000;
  let lastError = `health check did not return 200 for ${port}`;
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
    const status = await Promise.race([
      child.status.then((value) => value.code),
      new Promise<number | null>((resolve) =>
        setTimeout(() => resolve(null), 150)
      ),
    ]);
    if (typeof status === "number") {
      throw new Error(
        `process exited before becoming healthy (exit ${status}).`,
      );
    }
  }
  throw new Error(lastError);
}
