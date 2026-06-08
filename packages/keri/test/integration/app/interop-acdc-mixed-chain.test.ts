// @file-test-lane interop-parity

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  addKliMailbox,
  addTufaMailbox,
  generateKliMailboxOobi,
  generateTufaMailboxOobi,
  inceptKliAlias,
  inceptTufaAlias,
  initKliStore,
  initTufaStore,
  INTEROP_PASSCODE,
  INTEROP_SALT,
  resolveKliOobi,
  resolveTufaOobi,
  setupTufaMailboxProvider,
  startTufaAgentHost,
  type TufaMailboxProviderFixture,
} from "./interop-delegation-helpers.ts";
import {
  canRunLocalKeripy,
  createInteropContext,
  ensureInteropVerifierFixtureRoot,
  extractLastNonEmptyLine,
  type InteropContext,
  localKeripyRoot,
  randomPort,
  requireSuccess,
  resolveLocalKeripyKliCommand,
  runCmdWithTimeout,
  runTufa,
  runTufaWithTimeout,
  spawnChild,
  type SpawnedChild,
  stopChild,
  withStartedChild,
  workspaceRoot,
} from "./interop-test-helpers.ts";

interface TufaStore {
  name: string;
  base: string;
  headDirPath: string;
  passcode: string;
  alias: string;
  pre: string;
}

interface KliStore {
  name: string;
  base: string;
  passcode: string;
  alias: string;
  pre: string;
}

function schemaSed(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "",
    title: "MixedChainCredential",
    type: "object",
    required: ["v", "d", "i", "ri", "s", "a"],
    properties: {
      v: { type: "string" },
      d: { type: "string" },
      i: { type: "string" },
      ri: { type: "string" },
      s: { type: "string" },
      a: {
        type: "object",
        required: ["i", "role"],
        properties: {
          i: { type: "string" },
          role: { type: "string" },
        },
      },
      e: { type: "object" },
      r: { type: "object" },
    },
  };
}

function tufaStoreArgs(store: TufaStore): string[] {
  return [
    "--name",
    store.name,
    "--base",
    store.base,
    "--head-dir",
    store.headDirPath,
    "--passcode",
    store.passcode,
  ];
}

function kliStoreArgs(store: KliStore): string[] {
  return ["--name", store.name, "--base", store.base, "--passcode", store.passcode];
}

function pythonCommandForKli(kliCommand: string): string {
  const slash = kliCommand.lastIndexOf("/");
  if (slash === -1) {
    return "python";
  }
  return `${kliCommand.slice(0, slash)}/python`;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.stat(path);
    return true;
  } catch {
    return false;
  }
}

async function interopVerifierRoot(ctx: InteropContext): Promise<string> {
  const localRoot = `${ctx.repoRoot.replace(/\/$/, "")}/../../../verifier/apps/interop-verifier`;
  if (
    await pathExists(`${localRoot}/src/interop_verifier/app/cli.py`)
    && await pathExists(`${localRoot}/scripts/interop-verifier-incept-no-wits.json`)
  ) {
    return localRoot;
  }
  return await ensureInteropVerifierFixtureRoot();
}

function withPythonPath(
  env: Record<string, string>,
  path: string,
): Record<string, string> {
  const current = env.PYTHONPATH ?? "";
  return {
    ...env,
    PYTHONPATH: current ? `${path}:${current}` : path,
  };
}

async function startInteropVerifier(
  ctx: InteropContext,
  workDir: string,
  args: {
    name: string;
    alias: string;
    port: number;
    hook: string;
    schemas?: string[];
  },
): Promise<SpawnedChild> {
  const root = await interopVerifierRoot(ctx);
  const verifierArgs = [
    "-m",
    "interop_verifier.app.cli",
    "start",
    "--name",
    args.name,
    "--head-dir",
    `${workDir}/interop-verifier`,
    "--alias",
    args.alias,
    "--http",
    String(args.port),
    "--web-hook",
    args.hook,
    "--incept-file",
    `${root}/scripts/interop-verifier-incept-no-wits.json`,
  ];
  for (const schema of args.schemas ?? []) {
    verifierArgs.push("--schema", schema);
  }
  const env = withPythonPath(ctx.env, `${root}/src`);
  if (await canRunLocalKeripy(ctx.env)) {
    return spawnChild(
      "uv",
      [
        "run",
        "--project",
        localKeripyRoot(),
        "--with-editable",
        localKeripyRoot(),
        "python",
        ...verifierArgs,
      ],
      env,
      ctx.repoRoot,
    );
  }
  return spawnChild(
    pythonCommandForKli(ctx.kliCommand),
    verifierArgs,
    env,
    ctx.repoRoot,
  );
}

async function interopVerifierPre(port: number): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/health`);
  if (!response.ok) {
    throw new Error(`interop-verifier health failed: HTTP ${response.status}`);
  }
  const health = await response.json() as Record<string, unknown>;
  if (typeof health.pre !== "string" || health.pre.length === 0) {
    throw new Error(`interop-verifier health did not expose an AID: ${JSON.stringify(health)}`);
  }
  return health.pre;
}

async function waitForInteropVerifierPre(port: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return await interopVerifierPre(port);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  throw new Error(
    `interop-verifier did not become healthy: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

function parseJsonLine(output: string): Record<string, unknown> {
  const line = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .at(-1);
  if (!line) {
    throw new Error(`Unable to parse JSON line from output:\n${output}`);
  }
  return JSON.parse(line) as Record<string, unknown>;
}

function grantSaidFromPoll(output: string): string | null {
  const parsed = parseJsonLine(output);
  const ipex = parsed.ipex;
  if (!Array.isArray(ipex)) {
    return null;
  }
  for (const entry of ipex) {
    if (
      isRecord(entry) && entry.route === "/ipex/grant"
      && typeof entry.said === "string"
    ) {
      return entry.said;
    }
  }
  return null;
}

function savedSaidFromPoll(output: string, expectedSaid: string): boolean {
  const parsed = parseJsonLine(output);
  const saved = parsed.saved;
  return Array.isArray(saved) && saved.includes(expectedSaid);
}

async function saidifySchema(
  env: Record<string, string>,
  schemaPath: string,
): Promise<string> {
  await Deno.writeTextFile(schemaPath, JSON.stringify(schemaSed()));
  await requireSuccess(
    "tufa schema saidify",
    runTufa(["saidify", "--file", schemaPath, "--label", "$id"], env, workspaceRoot()),
  );
  const schema = JSON.parse(await Deno.readTextFile(schemaPath)) as Record<string, unknown>;
  if (typeof schema.$id !== "string") {
    throw new Error(`Saidified schema did not carry a string $id: ${JSON.stringify(schema)}`);
  }
  return schema.$id;
}

async function createTufaStore(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    headDirPath: string;
    alias: string;
  },
): Promise<TufaStore> {
  const store = {
    ...args,
    passcode: INTEROP_PASSCODE,
    pre: "",
  };
  await initTufaStore(ctx, store);
  store.pre = await inceptTufaAlias(ctx, store);
  return store;
}

async function createKliStore(
  ctx: InteropContext,
  args: {
    name: string;
    base: string;
    alias: string;
  },
): Promise<KliStore> {
  const store = {
    ...args,
    passcode: INTEROP_PASSCODE,
    pre: "",
  };
  await initKliStore(ctx, store);
  store.pre = await inceptKliAlias(ctx, store);
  return store;
}

async function configureTufaMailbox(
  ctx: InteropContext,
  store: TufaStore,
  providerAlias: string,
  providerMailboxOobi: string,
): Promise<string> {
  await resolveTufaOobi(ctx, {
    ...store,
    url: providerMailboxOobi,
    alias: providerAlias,
  });
  await addTufaMailbox(ctx, { ...store, mailbox: providerAlias });
  return await generateTufaMailboxOobi(ctx, store);
}

async function configureKliMailbox(
  ctx: InteropContext,
  store: KliStore,
  providerAlias: string,
  providerMailboxOobi: string,
): Promise<string> {
  await resolveKliOobi(ctx, {
    ...store,
    oobi: providerMailboxOobi,
    alias: providerAlias,
  });
  await addKliMailbox(ctx, { ...store, mailbox: providerAlias });
  return await generateKliMailboxOobi(ctx, store);
}

async function dumpTufaBaser(
  ctx: InteropContext,
  store: TufaStore,
  target: string,
  prefix?: string,
): Promise<string> {
  const command = [
    "db",
    "dump",
    target,
    "--name",
    store.name,
    "--base",
    store.base,
    "--head-dir",
    store.headDirPath,
    "--limit",
    "20",
  ];
  if (prefix) {
    command.push("--prefix", prefix);
  }
  const result = await runTufaWithTimeout(command, ctx.env, ctx.repoRoot, 20_000);
  return `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`;
}

async function dumpTufaMailboxer(
  ctx: InteropContext,
  provider: TufaMailboxProviderFixture,
  target: string,
  prefix?: string,
): Promise<string> {
  const command = [
    "db",
    "dump",
    target,
    "--name",
    provider.name,
    "--base",
    provider.base,
    "--head-dir",
    provider.headDirPath,
    "--limit",
    "20",
  ];
  if (prefix) {
    command.push("--prefix", prefix);
  }
  const result = await runTufaWithTimeout(command, ctx.env, ctx.repoRoot, 20_000);
  return `${result.stdout}${result.stderr ? `\n${result.stderr}` : ""}`;
}

async function mixedChainDeliveryDiagnostics(
  ctx: InteropContext,
  args: {
    recipient: TufaStore;
    provider: TufaMailboxProviderFixture;
  },
): Promise<string> {
  const [recipientEnds, recipientLocs, recipientTops, recipientExns, recipientEpath, providerTopics] = await Promise
    .all([
      dumpTufaBaser(ctx, args.recipient, "baser.ends", args.recipient.pre),
      dumpTufaBaser(ctx, args.recipient, "baser.locs", args.provider.pre),
      dumpTufaBaser(ctx, args.recipient, "baser.tops", args.recipient.pre),
      dumpTufaBaser(ctx, args.recipient, "baser.exns"),
      dumpTufaBaser(ctx, args.recipient, "baser.epath"),
      dumpTufaMailboxer(ctx, args.provider, "mailboxer.tpcs"),
    ]);
  return [
    "Tufa recipient baser.ends for itself:",
    recipientEnds,
    "Tufa recipient baser.locs for mailbox provider:",
    recipientLocs,
    "Tufa recipient baser.tops for itself:",
    recipientTops,
    "Tufa recipient baser.exns:",
    recipientExns,
    "Tufa recipient baser.epath:",
    recipientEpath,
    "Tufa provider mailboxer.tpcs:",
    providerTopics,
  ].join("\n");
}

async function importSchemaToTufa(
  ctx: InteropContext,
  store: TufaStore,
  schemaPath: string,
): Promise<void> {
  await requireSuccess(
    `${store.name} schema import`,
    runTufaWithTimeout(
      ["vc", "schema", "import", ...tufaStoreArgs(store), "--schema", schemaPath],
      ctx.env,
      ctx.repoRoot,
      30_000,
    ),
  );
}

async function importSchemaToKli(
  ctx: InteropContext,
  store: KliStore,
  schemaPath: string,
): Promise<void> {
  await requireSuccess(
    `${store.name} schema import`,
    runCmdWithTimeout(
      ctx.kliCommand,
      ["vc", "schema", "import_", ...kliStoreArgs(store), "--schema", schemaPath],
      ctx.env,
      30_000,
    ),
  );
}

async function inceptTufaRegistry(
  ctx: InteropContext,
  store: TufaStore,
  registryName: string,
): Promise<void> {
  await requireSuccess(
    `${store.name} registry incept`,
    runTufaWithTimeout(
      [
        "vc",
        "registry",
        "incept",
        ...tufaStoreArgs(store),
        "--alias",
        store.alias,
        "--registry-name",
        registryName,
      ],
      ctx.env,
      ctx.repoRoot,
      30_000,
    ),
  );
}

async function inceptKliRegistry(
  ctx: InteropContext,
  store: KliStore,
  registryName: string,
): Promise<void> {
  await requireSuccess(
    `${store.name} registry incept`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "vc",
        "registry",
        "incept",
        ...kliStoreArgs(store),
        "--alias",
        store.alias,
        "--registry-name",
        registryName,
        "--no-backers",
        "true",
      ],
      ctx.env,
      30_000,
    ),
  );
}

async function createKliCredential(
  ctx: InteropContext,
  store: KliStore,
  args: {
    registryName: string;
    schemaSaid: string;
    recipient: string;
    role: string;
    edges?: Record<string, unknown>;
  },
): Promise<string> {
  const command = [
    "vc",
    "create",
    ...kliStoreArgs(store),
    "--alias",
    store.alias,
    "--registry-name",
    args.registryName,
    "--schema",
    args.schemaSaid,
    "--recipient",
    args.recipient,
    "--data",
    JSON.stringify({ role: args.role }),
  ];
  if (args.edges) {
    command.push("--edges", JSON.stringify(args.edges));
  }
  const created = await requireSuccess(
    `${store.name} credential create`,
    runCmdWithTimeout(ctx.kliCommand, command, ctx.env, 45_000),
  );
  assertStringIncludes(created.stdout, "has been created");

  const issued = await requireSuccess(
    `${store.name} issued credential list`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "vc",
        "list",
        ...kliStoreArgs(store),
        "--alias",
        store.alias,
        "--issued",
        "--schema",
        args.schemaSaid,
        "--said",
      ],
      ctx.env,
      30_000,
    ),
  );
  return extractLastNonEmptyLine(issued.stdout);
}

async function createTufaCredential(
  ctx: InteropContext,
  store: TufaStore,
  args: {
    registryName: string;
    schemaSaid: string;
    recipient: string;
    role: string;
    edges?: Record<string, unknown>;
  },
): Promise<string> {
  const command = [
    "vc",
    "create",
    ...tufaStoreArgs(store),
    "--alias",
    store.alias,
    "--registry-name",
    args.registryName,
    "--schema",
    args.schemaSaid,
    "--recipient",
    args.recipient,
    "--data",
    JSON.stringify({ role: args.role }),
  ];
  if (args.edges) {
    command.push("--edges", JSON.stringify(args.edges));
  }
  const created = await requireSuccess(
    `${store.name} credential create`,
    runTufaWithTimeout(command, ctx.env, ctx.repoRoot, 45_000),
  );
  const parsed = parseJsonLine(created.stdout);
  assertEquals(parsed.status, "accept");
  if (typeof parsed.said !== "string") {
    throw new Error(`Tufa credential create did not emit SAID:\n${created.stdout}`);
  }
  return parsed.said;
}

async function grantFromKli(
  ctx: InteropContext,
  workDir: string,
  store: KliStore,
  recipient: string,
  credentialSaid: string,
  message: string,
): Promise<string> {
  const timestamp = nowKliTimestamp();
  const alignedMessage = await alignedKliIpexMessage(ctx, workDir, store, {
    mode: "grant",
    said: credentialSaid,
    recipient,
    message,
    timestamp,
  });
  const grant = await requireSuccess(
    `${store.name} ipex grant`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "ipex",
        "grant",
        ...kliStoreArgs(store),
        "--alias",
        store.alias,
        "--recipient",
        recipient,
        "--said",
        credentialSaid,
        "--message",
        alignedMessage,
        "--time",
        timestamp,
      ],
      ctx.env,
      60_000,
    ),
  );
  assertStringIncludes(grant.stdout, "grant message sent");
  return grant.stdout;
}

async function grantFromTufa(
  ctx: InteropContext,
  store: TufaStore,
  recipient: string,
  credentialSaid: string,
  message: string,
): Promise<void> {
  const grant = await requireSuccess(
    `${store.name} ipex grant`,
    runTufaWithTimeout(
      [
        "ipex",
        "grant",
        ...tufaStoreArgs(store),
        "--alias",
        store.alias,
        "--recipient",
        recipient,
        "--said",
        credentialSaid,
        "--message",
        message,
      ],
      ctx.env,
      ctx.repoRoot,
      60_000,
    ),
  );
  assertStringIncludes(grant.stdout, credentialSaid);
}

async function pollTufaGrant(
  ctx: InteropContext,
  store: TufaStore,
  expectedCredentialSaid?: string,
): Promise<string> {
  const attempts: string[] = [];
  let grantSaid: string | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const poll = await requireSuccess(
      `${store.name} ipex poll`,
      runTufaWithTimeout(
        [
          "ipex",
          "poll",
          ...tufaStoreArgs(store),
          "--alias",
          store.alias,
          "--poll-turns",
          "3",
          "--poll-budget-ms",
          "1000",
        ],
        ctx.env,
        ctx.repoRoot,
        20_000,
      ),
    );
    attempts.push(poll.stdout);
    grantSaid ??= grantSaidFromPoll(poll.stdout);
    const credentialSaved = expectedCredentialSaid ? savedSaidFromPoll(poll.stdout, expectedCredentialSaid) : true;
    if (grantSaid && credentialSaved) {
      return grantSaid;
    }
  }
  const expectation = expectedCredentialSaid ? ` and save credential ${expectedCredentialSaid}` : "";
  throw new Error(`Tufa poll did not receive an IPEX grant${expectation}:\n${attempts.join("\n")}`);
}

async function pollKliGrant(
  ctx: InteropContext,
  store: KliStore,
): Promise<string> {
  const grant = await requireSuccess(
    `${store.name} ipex grant poll`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "ipex",
        "list",
        ...kliStoreArgs(store),
        "--alias",
        store.alias,
        "--poll",
        "--type",
        "grant",
        "--said",
      ],
      ctx.env,
      45_000,
    ),
  );
  return extractLastNonEmptyLine(grant.stdout);
}

async function admitTufaGrant(
  ctx: InteropContext,
  store: TufaStore,
  grantSaid: string,
  message: string,
): Promise<void> {
  const admitted = await requireSuccess(
    `${store.name} ipex admit`,
    runTufaWithTimeout(
      [
        "ipex",
        "admit",
        ...tufaStoreArgs(store),
        "--alias",
        store.alias,
        "--said",
        grantSaid,
        "--message",
        message,
      ],
      ctx.env,
      ctx.repoRoot,
      60_000,
    ),
  );
  assertStringIncludes(admitted.stdout, grantSaid);
}

async function admitKliGrant(
  ctx: InteropContext,
  workDir: string,
  store: KliStore,
  grantSaid: string,
  message: string,
): Promise<void> {
  const timestamp = nowKliTimestamp();
  const alignedMessage = await alignedKliIpexMessage(ctx, workDir, store, {
    mode: "admit",
    said: grantSaid,
    message,
    timestamp,
  });
  const admitted = await requireSuccess(
    `${store.name} ipex admit`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "ipex",
        "admit",
        ...kliStoreArgs(store),
        "--alias",
        store.alias,
        "--said",
        grantSaid,
        "--message",
        alignedMessage,
        "--time",
        timestamp,
      ],
      ctx.env,
      60_000,
    ),
  );
  assertStringIncludes(admitted.stdout, "admit message sent");
}

async function assertKliCredentialListed(
  ctx: InteropContext,
  store: KliStore,
  schemaSaid: string,
  credentialSaid: string,
): Promise<void> {
  const listed = await requireSuccess(
    `${store.name} credential list`,
    runCmdWithTimeout(
      ctx.kliCommand,
      [
        "vc",
        "list",
        ...kliStoreArgs(store),
        "--alias",
        store.alias,
        "--schema",
        schemaSaid,
        "--said",
      ],
      ctx.env,
      30_000,
    ),
  );
  const saids = listed.stdout.split(/\r?\n/).map((line) => line.trim());
  if (!saids.includes(credentialSaid)) {
    throw new Error(`KLI store ${store.name} did not list credential ${credentialSaid}:\n${listed.stdout}`);
  }
}

async function assertTufaHookPresentation(
  hookOrigin: string,
  holderPre: string,
  expected: {
    credential: string;
    issuer: string;
    schema: string;
  },
): Promise<void> {
  const response = await fetch(`${hookOrigin}/?holder=${holderPre}`);
  try {
    assertEquals(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assertEquals(body.credential, expected.credential);
    assertEquals(body.issuer, expected.issuer);
    assertEquals(body.holder, holderPre);
    assertEquals(body.schema, expected.schema);
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

async function waitForTufaHookPresentation(
  hookOrigin: string,
  holderPre: string,
  expected: {
    credential: string;
    issuer: string;
    schema: string;
  },
): Promise<void> {
  const deadline = Date.now() + 30_000;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      await assertTufaHookPresentation(hookOrigin, holderPre, expected);
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(
    `Timed out waiting for hook presentation from ${holderPre}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function chainEdge(
  sourceSaid: string,
  schemaSaid: string,
  operator: "I2I" | "NI2I",
): Record<string, unknown> {
  return {
    source: {
      n: sourceSaid,
      o: operator,
      s: schemaSaid,
    },
  };
}

function nowKliTimestamp(): string {
  return new Date().toISOString().replace("Z", "000+00:00");
}

async function writeKliIpexAlignmentScript(workDir: string): Promise<string> {
  const path = `${workDir}/kli-ipex-align.py`;
  await Deno.writeTextFile(
    path,
    String.raw`import argparse
import json

from keri.app import Organizer, serialize
from keri.cli.common import existing
from keri.core import coring, serdering
from keri.peer import cloneMessage
from keri.vc import ipexAdmitExn, ipexGrantExn
from keri.vdr import credentialing


def resolve_recipient(hby, recp):
    if recp in hby.kevers:
        return recp
    org = Organizer(hby=hby)
    contacts = org.findExact("alias", recp)
    if len(contacts) != 1:
        raise ValueError(f"expected one contact for alias {recp!r}, got {len(contacts)}")
    return contacts[0]["id"]


def grant_candidate(hby, rgy, args, message):
    hab = hby.habByName(args.alias)
    creder, prefixer, seqner, saider = rgy.reger.cloneCred(said=args.said)
    if creder is None:
        raise ValueError(f"invalid credential SAID to grant={args.said}")
    recp = resolve_recipient(hby, args.recipient)
    acdc = serialize(creder, prefixer, seqner, saider)
    iss = rgy.reger.cloneTvtAt(creder.said)
    iserder = serdering.SerderKERI(raw=bytes(iss))
    seqner = coring.Seqner(sn=iserder.sn)
    serder = hby.db.fetchLastSealingEventByEventSeal(
        creder.sad["i"],
        seal=dict(i=iserder.pre, s=seqner.snh, d=iserder.said),
    )
    anc = hby.db.cloneEvtMsg(pre=serder.pre, fn=0, dig=serder.said)
    return ipexGrantExn(
        hab=hab,
        recp=recp,
        message=message,
        acdc=acdc,
        iss=iss,
        anc=anc,
        dt=args.timestamp,
    )


def admit_candidate(hby, args, message):
    hab = hby.habByName(args.alias)
    grant, _ = cloneMessage(hby, args.said)
    if grant is None:
        raise ValueError(f"invalid grant SAID to admit={args.said}")
    return ipexAdmitExn(hab=hab, message=message, grant=grant, dt=args.timestamp)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["grant", "admit"], required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--base", default="")
    parser.add_argument("--passcode", required=True)
    parser.add_argument("--alias", required=True)
    parser.add_argument("--said", required=True)
    parser.add_argument("--message", required=True)
    parser.add_argument("--timestamp", required=True)
    parser.add_argument("--recipient", default="")
    args = parser.parse_args()

    hby = existing.setupHby(name=args.name, base=args.base, bran=args.passcode)
    rgy = credentialing.Regery(hby=hby, name=args.name, base=args.base) if args.mode == "grant" else None
    try:
        for pad in range(16):
            message = args.message + ("." * pad)
            exn, atc = (
                grant_candidate(hby, rgy, args, message)
                if args.mode == "grant"
                else admit_candidate(hby, args, message)
            )
            if (len(exn.raw) + len(atc)) % 4 == 0:
                print(json.dumps({"message": message, "pad": pad}))
                return
    finally:
        hby.close()

    raise ValueError("unable to find quadlet-aligned KLI IPEX message padding")


if __name__ == "__main__":
    main()
`,
  );
  return path;
}

async function alignedKliIpexMessage(
  ctx: InteropContext,
  workDir: string,
  store: KliStore,
  args: {
    mode: "grant" | "admit";
    said: string;
    message: string;
    timestamp: string;
    recipient?: string;
  },
): Promise<string> {
  const script = await writeKliIpexAlignmentScript(workDir);
  const scriptArgs = [
    script,
    "--mode",
    args.mode,
    "--name",
    store.name,
    "--base",
    store.base,
    "--passcode",
    store.passcode,
    "--alias",
    store.alias,
    "--said",
    args.said,
    "--message",
    args.message,
    "--timestamp",
    args.timestamp,
    ...(args.recipient ? ["--recipient", args.recipient] : []),
  ];
  const useLocalKeripy = await canRunLocalKeripy(ctx.env);
  const result = await requireSuccess(
    `${store.name} KLI IPEX alignment preflight`,
    useLocalKeripy
      ? runCmdWithTimeout(
        "uv",
        [
          "run",
          "--project",
          localKeripyRoot(),
          "--with-editable",
          localKeripyRoot(),
          "python",
          ...scriptArgs,
        ],
        ctx.env,
        30_000,
        ctx.repoRoot,
      )
      : runCmdWithTimeout(
        pythonCommandForKli(ctx.kliCommand),
        scriptArgs,
        ctx.env,
        30_000,
        ctx.repoRoot,
      ),
  );
  const parsed = parseJsonLine(result.stdout);
  if (typeof parsed.message !== "string") {
    throw new Error(`KLI IPEX alignment preflight did not emit a message:\n${result.stdout}`);
  }
  return parsed.message;
}

Deno.test("Interop: mixed KLI/Tufa four-deep I2I chain presents to interop and Tufa verifiers", async () => {
  const baseCtx = await createInteropContext();
  const workDir = await Deno.makeTempDir({ prefix: "mixed-chain-i2i-" });
  const ctx: InteropContext = {
    ...baseCtx,
    kliCommand: await resolveLocalKeripyKliCommand(workDir, baseCtx.kliCommand, baseCtx.env),
    env: {
      ...baseCtx.env,
      KERI_LMDB_MAP_SIZE: "134217728",
    },
  };
  const tufaHeadDir = `${workDir}/tufa`;
  const schemaPath = `${workDir}/schema.json`;
  const base = "";
  const providerPort = randomPort();
  const interopVerifierPort = randomPort();
  const tufaVerifierPort = randomPort();
  const hookPort = randomPort();
  const hookOrigin = `http://127.0.0.1:${hookPort}`;
  const unique = crypto.randomUUID().slice(0, 8);

  try {
    const schemaSaid = await saidifySchema(ctx.env, schemaPath);
    const hookChild = spawnChild(
      Deno.execPath(),
      [
        "run",
        "--allow-all",
        "--unstable-ffi",
        "packages/tufa/mod.ts",
        "hook",
        "demo",
        "--http",
        String(hookPort),
      ],
      ctx.env,
      ctx.repoRoot,
    );

    await withStartedChild(hookChild, hookPort, async () => {
      const provider = await setupTufaMailboxProvider(ctx, {
        name: `chain-provider-${unique}`,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        salt: INTEROP_SALT,
        alias: "provider",
        port: providerPort,
      });
      try {
        const issuerA = await createKliStore(ctx, {
          name: `chain-kli-a-${unique}`,
          base,
          alias: "issuer-a",
        });
        const issuerB = await createTufaStore(ctx, {
          name: `chain-tufa-b-${unique}`,
          base,
          headDirPath: tufaHeadDir,
          alias: "issuer-b",
        });
        const issuerC = await createKliStore(ctx, {
          name: `chain-kli-c-${unique}`,
          base,
          alias: "issuer-c",
        });
        const issuerD = await createTufaStore(ctx, {
          name: `chain-tufa-d-${unique}`,
          base,
          headDirPath: tufaHeadDir,
          alias: "issuer-d",
        });
        const holder = await createKliStore(ctx, {
          name: `chain-holder-${unique}`,
          base,
          alias: "holder",
        });
        const tufaVerifier = await createTufaStore(ctx, {
          name: `chain-tufa-verifier-${unique}`,
          base,
          headDirPath: tufaHeadDir,
          alias: "tufa-verifier",
        });

        for (const store of [issuerA, issuerC, holder]) {
          await importSchemaToKli(ctx, store, schemaPath);
        }
        for (const store of [issuerB, issuerD, tufaVerifier]) {
          await importSchemaToTufa(ctx, store, schemaPath);
        }

        await inceptKliRegistry(ctx, issuerA, "reg-a");
        await inceptTufaRegistry(ctx, issuerB, "reg-b");
        await inceptKliRegistry(ctx, issuerC, "reg-c");
        await inceptTufaRegistry(ctx, issuerD, "reg-d");

        const issuerAMailbox = await configureKliMailbox(ctx, issuerA, "provider", provider.mailboxOobi);
        const issuerBMailbox = await configureTufaMailbox(ctx, issuerB, "provider", provider.mailboxOobi);
        const issuerCMailbox = await configureKliMailbox(ctx, issuerC, "provider", provider.mailboxOobi);
        const issuerDMailbox = await configureTufaMailbox(ctx, issuerD, "provider", provider.mailboxOobi);
        const holderMailbox = await configureKliMailbox(ctx, holder, "provider", provider.mailboxOobi);

        await resolveKliOobi(ctx, { ...issuerA, oobi: issuerBMailbox, alias: "issuer-b" });
        await resolveTufaOobi(ctx, { ...issuerB, url: issuerAMailbox, alias: "issuer-a" });
        await resolveTufaOobi(ctx, { ...issuerB, url: issuerCMailbox, alias: "issuer-c" });
        await resolveKliOobi(ctx, { ...issuerC, oobi: issuerBMailbox, alias: "issuer-b" });
        await resolveKliOobi(ctx, { ...issuerC, oobi: issuerDMailbox, alias: "issuer-d" });
        await resolveTufaOobi(ctx, { ...issuerD, url: issuerCMailbox, alias: "issuer-c" });
        await resolveTufaOobi(ctx, { ...issuerD, url: holderMailbox, alias: "holder" });
        await resolveKliOobi(ctx, { ...holder, oobi: issuerDMailbox, alias: "issuer-d" });

        const credentialA = await createKliCredential(ctx, issuerA, {
          registryName: "reg-a",
          schemaSaid,
          recipient: "issuer-b",
          role: "A",
        });
        await grantFromKli(ctx, workDir, issuerA, "issuer-b", credentialA, "issuance ok");
        const grantA = await pollTufaGrant(ctx, issuerB, credentialA).catch(async (error) => {
          const diagnostics = await mixedChainDeliveryDiagnostics(ctx, {
            recipient: issuerB,
            provider,
          });
          throw new Error(`${error instanceof Error ? error.message : String(error)}\n\n${diagnostics}`);
        });
        await admitTufaGrant(ctx, issuerB, grantA, "accepted ok");

        const credentialB = await createTufaCredential(ctx, issuerB, {
          registryName: "reg-b",
          schemaSaid,
          recipient: issuerC.pre,
          role: "B",
          edges: chainEdge(credentialA, schemaSaid, "I2I"),
        });
        await grantFromTufa(ctx, issuerB, issuerC.pre, credentialB, "issuance ok");
        const grantB = await pollKliGrant(ctx, issuerC);
        await admitKliGrant(ctx, workDir, issuerC, grantB, "accepted ok");

        const credentialC = await createKliCredential(ctx, issuerC, {
          registryName: "reg-c",
          schemaSaid,
          recipient: "issuer-d",
          role: "C",
          edges: chainEdge(credentialB, schemaSaid, "I2I"),
        });
        await grantFromKli(ctx, workDir, issuerC, "issuer-d", credentialC, "issuance ok");
        const grantC = await pollTufaGrant(ctx, issuerD, credentialC);
        await admitTufaGrant(ctx, issuerD, grantC, "accepted ok");

        const credentialD = await createTufaCredential(ctx, issuerD, {
          registryName: "reg-d",
          schemaSaid,
          recipient: holder.pre,
          role: "D",
          edges: chainEdge(credentialC, schemaSaid, "I2I"),
        });
        await grantFromTufa(ctx, issuerD, holder.pre, credentialD, "issuance ok");
        const grantD = await pollKliGrant(ctx, holder);
        await admitKliGrant(ctx, workDir, holder, grantD, "accepted ok");
        await assertKliCredentialListed(ctx, holder, schemaSaid, credentialD);

        const interopVerifier = await startInteropVerifier(ctx, workDir, {
          name: `chain-interop-verifier-${unique}`,
          alias: "interop-verifier",
          port: interopVerifierPort,
          hook: `${hookOrigin}/`,
          schemas: [schemaPath],
        });
        let interopVerifierStopped = false;
        try {
          const verifierPre = await waitForInteropVerifierPre(interopVerifierPort);
          const verifierOobi = `http://127.0.0.1:${interopVerifierPort}/oobi/${verifierPre}/controller`;
          await resolveKliOobi(ctx, {
            ...holder,
            oobi: verifierOobi,
            alias: "interop-verifier",
          });
          await grantFromKli(ctx, workDir, holder, "interop-verifier", credentialD, "presentation ok");
          await waitForTufaHookPresentation(hookOrigin, holder.pre, {
            credential: credentialD,
            issuer: issuerD.pre,
            schema: schemaSaid,
          }).catch(async (error) => {
            const health = await fetch(`http://127.0.0.1:${interopVerifierPort}/health`)
              .then((response) => response.text())
              .catch((healthError) => String(healthError));
            throw new Error(
              `${error instanceof Error ? error.message : String(error)}\n\ninterop-verifier health:\n${health}`,
            );
          });
        } catch (error) {
          const output = await stopChild(interopVerifier);
          interopVerifierStopped = true;
          throw new Error(
            `${error instanceof Error ? error.message : String(error)}\n\ninterop-verifier output:\n${output}`,
          );
        } finally {
          if (!interopVerifierStopped) {
            await stopChild(interopVerifier);
          }
        }

        const tufaVerifierAgent = await startTufaAgentHost(ctx, {
          ...tufaVerifier,
          port: tufaVerifierPort,
        });
        try {
          const verifierOobi = `http://127.0.0.1:${tufaVerifierPort}/oobi/${tufaVerifier.pre}/controller`;
          await resolveKliOobi(ctx, {
            ...holder,
            oobi: verifierOobi,
            alias: "tufa-verifier",
          });
          await grantFromKli(ctx, workDir, holder, "tufa-verifier", credentialD, "presentation ok");
        } finally {
          await stopChild(tufaVerifierAgent);
        }

        const verifierRun = await requireSuccess(
          "tufa verifier issuance run",
          runTufaWithTimeout(
            [
              "verifier",
              "run",
              ...tufaStoreArgs(tufaVerifier),
              "--hook",
              `${hookOrigin}/`,
              "--once",
            ],
            ctx.env,
            ctx.repoRoot,
            60_000,
          ),
        );
        const verifierResult = parseJsonLine(verifierRun.stdout).result as Record<string, unknown>;
        assertEquals(verifierResult.webhooksSent, 1);
        await assertTufaHookPresentation(hookOrigin, holder.pre, {
          credential: credentialD,
          issuer: issuerD.pre,
          schema: schemaSaid,
        });
      } finally {
        await provider.close();
      }
    });
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => undefined);
    await Deno.remove(baseCtx.home, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("Interop: Tufa NI2I edge verifies when source subject is not the Tufa issuer", async () => {
  const baseCtx = await createInteropContext();
  const workDir = await Deno.makeTempDir({ prefix: "mixed-chain-ni2i-" });
  const ctx: InteropContext = {
    ...baseCtx,
    kliCommand: await resolveLocalKeripyKliCommand(workDir, baseCtx.kliCommand, baseCtx.env),
    env: {
      ...baseCtx.env,
      KERI_LMDB_MAP_SIZE: "134217728",
    },
  };
  const tufaHeadDir = `${workDir}/tufa`;
  const schemaPath = `${workDir}/schema.json`;
  const base = "";
  const providerPort = randomPort();
  const verifierPort = randomPort();
  const hookPort = randomPort();
  const hookOrigin = `http://127.0.0.1:${hookPort}`;
  const unique = crypto.randomUUID().slice(0, 8);

  try {
    const schemaSaid = await saidifySchema(ctx.env, schemaPath);
    const hookChild = spawnChild(
      Deno.execPath(),
      [
        "run",
        "--allow-all",
        "--unstable-ffi",
        "packages/tufa/mod.ts",
        "hook",
        "demo",
        "--http",
        String(hookPort),
      ],
      ctx.env,
      ctx.repoRoot,
    );

    await withStartedChild(hookChild, hookPort, async () => {
      const provider = await setupTufaMailboxProvider(ctx, {
        name: `ni2i-provider-${unique}`,
        base,
        headDirPath: tufaHeadDir,
        passcode: INTEROP_PASSCODE,
        salt: INTEROP_SALT,
        alias: "provider",
        port: providerPort,
      });
      try {
        const sourceIssuer = await createKliStore(ctx, {
          name: `ni2i-kli-source-issuer-${unique}`,
          base,
          alias: "source-issuer",
        });
        const sourceHolder = await createKliStore(ctx, {
          name: `ni2i-kli-source-holder-${unique}`,
          base,
          alias: "source-holder",
        });
        const tufaIssuer = await createTufaStore(ctx, {
          name: `ni2i-tufa-issuer-${unique}`,
          base,
          headDirPath: tufaHeadDir,
          alias: "tufa-issuer",
        });
        const finalHolder = await createKliStore(ctx, {
          name: `ni2i-final-holder-${unique}`,
          base,
          alias: "final-holder",
        });
        const tufaVerifier = await createTufaStore(ctx, {
          name: `ni2i-tufa-verifier-${unique}`,
          base,
          headDirPath: tufaHeadDir,
          alias: "tufa-verifier",
        });

        for (const store of [sourceIssuer, sourceHolder, finalHolder]) {
          await importSchemaToKli(ctx, store, schemaPath);
        }
        for (const store of [tufaIssuer, tufaVerifier]) {
          await importSchemaToTufa(ctx, store, schemaPath);
        }

        await inceptKliRegistry(ctx, sourceIssuer, "source-reg");
        await inceptTufaRegistry(ctx, tufaIssuer, "ni2i-reg");

        const sourceIssuerMailbox = await configureKliMailbox(ctx, sourceIssuer, "provider", provider.mailboxOobi);
        const sourceHolderMailbox = await configureKliMailbox(ctx, sourceHolder, "provider", provider.mailboxOobi);
        const tufaIssuerMailbox = await configureTufaMailbox(ctx, tufaIssuer, "provider", provider.mailboxOobi);
        const finalHolderMailbox = await configureKliMailbox(ctx, finalHolder, "provider", provider.mailboxOobi);

        await resolveKliOobi(ctx, { ...sourceIssuer, oobi: sourceHolderMailbox, alias: "source-holder" });
        await resolveKliOobi(ctx, { ...sourceHolder, oobi: sourceIssuerMailbox, alias: "source-issuer" });
        await resolveKliOobi(ctx, { ...sourceHolder, oobi: tufaIssuerMailbox, alias: "tufa-issuer" });
        await resolveTufaOobi(ctx, { ...tufaIssuer, url: sourceHolderMailbox, alias: "source-holder" });
        await resolveTufaOobi(ctx, { ...tufaIssuer, url: finalHolderMailbox, alias: "final-holder" });
        await resolveKliOobi(ctx, { ...finalHolder, oobi: tufaIssuerMailbox, alias: "tufa-issuer" });

        const credentialA = await createKliCredential(ctx, sourceIssuer, {
          registryName: "source-reg",
          schemaSaid,
          recipient: "source-holder",
          role: "source",
        });
        await grantFromKli(ctx, workDir, sourceIssuer, "source-holder", credentialA, "issuance ok");
        const sourceGrant = await pollKliGrant(ctx, sourceHolder);
        await admitKliGrant(ctx, workDir, sourceHolder, sourceGrant, "accepted ok");
        await assertKliCredentialListed(ctx, sourceHolder, schemaSaid, credentialA);

        await grantFromKli(ctx, workDir, sourceHolder, "tufa-issuer", credentialA, "presentation ok");
        const presentedSourceGrant = await pollTufaGrant(ctx, tufaIssuer, credentialA);
        await admitTufaGrant(ctx, tufaIssuer, presentedSourceGrant, "accepted ok");

        const credentialB = await createTufaCredential(ctx, tufaIssuer, {
          registryName: "ni2i-reg",
          schemaSaid,
          recipient: finalHolder.pre,
          role: "derived",
          edges: chainEdge(credentialA, schemaSaid, "NI2I"),
        });
        await grantFromTufa(ctx, tufaIssuer, finalHolder.pre, credentialB, "issuance ok");
        const finalGrant = await pollKliGrant(ctx, finalHolder);
        await admitKliGrant(ctx, workDir, finalHolder, finalGrant, "accepted ok");
        await assertKliCredentialListed(ctx, finalHolder, schemaSaid, credentialB);

        const verifierAgent = await startTufaAgentHost(ctx, {
          ...tufaVerifier,
          port: verifierPort,
        });
        try {
          const verifierOobi = `http://127.0.0.1:${verifierPort}/oobi/${tufaVerifier.pre}/controller`;
          await resolveKliOobi(ctx, {
            ...finalHolder,
            oobi: verifierOobi,
            alias: "tufa-verifier",
          });
          await grantFromKli(ctx, workDir, finalHolder, "tufa-verifier", credentialB, "presentation ok");
        } finally {
          await stopChild(verifierAgent);
        }

        const verifierRun = await requireSuccess(
          "tufa verifier ni2i run",
          runTufaWithTimeout(
            [
              "verifier",
              "run",
              ...tufaStoreArgs(tufaVerifier),
              "--hook",
              `${hookOrigin}/`,
              "--once",
            ],
            ctx.env,
            ctx.repoRoot,
            60_000,
          ),
        );
        const verifierResult = parseJsonLine(verifierRun.stdout).result as Record<string, unknown>;
        assertEquals(verifierResult.webhooksSent, 1);
        await assertTufaHookPresentation(hookOrigin, finalHolder.pre, {
          credential: credentialB,
          issuer: tufaIssuer.pre,
          schema: schemaSaid,
        });
      } finally {
        await provider.close();
      }
    });
  } finally {
    await Deno.remove(workDir, { recursive: true }).catch(() => undefined);
    await Deno.remove(baseCtx.home, { recursive: true }).catch(() => undefined);
  }
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
