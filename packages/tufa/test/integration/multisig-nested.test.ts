// @file-test-lane app-stateful-a

import { action, type Operation, run, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  createAgentRuntime,
  createHabery,
  EndpointRoles,
  generateDidWebsArtifacts,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
} from "keri-ts/runtime";
import { startServer } from "../../src/host/http-server.ts";
import {
  reserveTcpPort,
  runTufa,
  type SpawnedChild,
  spawnTufa,
  waitForServer,
  waitForTaskHalt,
} from "../test-helpers.ts";

interface StoreSpec {
  readonly name: string;
  readonly headDirPath: string;
  readonly alias: string;
  readonly pre: string;
}

interface CmdResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface MailboxProvider {
  readonly name: string;
  readonly headDirPath: string;
  readonly alias: string;
  readonly pre: string;
  readonly url: string;
  readonly loc: Uint8Array;
}

Deno.test("tufa/multisig - nested weighted group inception joins without the third member and projects DID Webs", async () => {
  const headRoot = await Deno.makeTempDir({ prefix: "tufa-nested-multisig-" });
  try {
    const providerPort = reserveTcpPort();
    const providerUrl = `http://127.0.0.1:${providerPort}`;
    const provider = await seedMailboxProvider(headRoot, providerUrl);
    const alice = await initAndInceptMember(headRoot, "alice");
    const bob = await initAndInceptMember(headRoot, "bob");
    const carol = await initAndInceptMember(headRoot, "carol");
    const stores = [alice, bob, carol];

    await seedMailboxAndPeerState(stores, provider);

    await run(function*(): Operation<void> {
      const providerHby = yield* createHabery({
        name: provider.name,
        headDirPath: provider.headDirPath,
        skipConfig: true,
      });
      const providerRuntime = yield* createAgentRuntime(providerHby, { mode: "indirect" });
      const providerHab = providerHby.habByName(provider.alias);
      const runtimeTask = yield* spawn(function*() {
        yield* runAgentRuntime(providerRuntime, { hab: providerHab ?? undefined });
      });
      const serverTask = yield* spawn(function*() {
        yield* startServer(providerPort, undefined, providerRuntime);
      });

      try {
        yield* waitForServer(providerPort);

        const groupConfig = `${headRoot}/group-incept.json`;
        yield* waitForPromise(writeJson(groupConfig, {
          aids: stores.map((store) => store.pre),
          rmids: stores.map((store) => store.pre),
          isith: [{ "1": ["1/2", "1/2"] }, "1"],
          nsith: [{ "1": ["1/2", "1/2"] }, "1"],
          toad: 0,
        }));

        const incept = yield* waitForPromise(runProposalWithJoin(
          [
            "multisig",
            "incept",
            "--name",
            alice.name,
            "--head-dir",
            alice.headDirPath,
            "--alias",
            alice.alias,
            "--group",
            "team",
            "--file",
            groupConfig,
            "--approval-timeout",
            "12",
          ],
          bob,
          "team",
        ));
        const inceptStatus = parseLastJson(incept.proposer.stdout);
        const groupPre = stringField(inceptStatus, "group");
        assertExists(groupPre);
        assertEquals(inceptStatus.accepted, true);
        assertEquals(parseLastJson(incept.joiner.stdout).accepted, true);

        const interact = yield* waitForPromise(runProposalWithJoin(
          [
            "multisig",
            "interact",
            "--name",
            alice.name,
            "--head-dir",
            alice.headDirPath,
            "--group",
            "team",
            "--data",
            "{\"nested\":\"ixn\"}",
          ],
          bob,
          "team",
        ));
        assertEquals(parseLastJson(interact.proposer.stdout).accepted, true);
        assertEquals(parseLastJson(interact.joiner.stdout).accepted, true);

        const rpy = yield* waitForPromise(runProposalWithJoin(
          [
            "multisig",
            "rpy",
            "--name",
            alice.name,
            "--head-dir",
            alice.headDirPath,
            "--group",
            "team",
            "--eid",
            provider.pre,
            "--role",
            "mailbox",
            "--approval-timeout",
            "12",
          ],
          bob,
          "team",
        ));
        assertEquals(parseLastJson(rpy.proposer.stdout).accepted, true);
        assertEquals(parseLastJson(rpy.joiner.stdout).accepted, true);

        const dwsPort = reserveTcpPort();
        const did = `did:webs:127.0.0.1%3A${dwsPort}:dws:${groupPre}`;
        const webRoot = `${headRoot}/web-root`;
        yield* waitForPromise(writeDidWebsArtifacts(alice, did, webRoot));
        const dwsHby = yield* createHabery({
          name: `dws-resolver-${crypto.randomUUID()}`,
          headDirPath: `${headRoot}/dws-resolver`,
          skipConfig: true,
        });
        const dwsRuntime = yield* createAgentRuntime(dwsHby, { mode: "local" });
        const dwsServerTask = yield* spawn(function*() {
          yield* startServer(dwsPort, undefined, dwsRuntime, {
            dwsStaticFilesDir: webRoot,
            dwsDidPath: "dws",
            dwsInsecureHttp: true,
          });
        });
        try {
          yield* waitForServer(dwsPort);
          const document = yield* fetchJson(`http://127.0.0.1:${dwsPort}/dws/${groupPre}/did.json`);
          assertNestedConditionalProof(document, groupPre);
        } finally {
          yield* waitForTaskHalt(dwsServerTask, 100);
          yield* dwsRuntime.close();
          yield* dwsHby.close(true);
        }
      } finally {
        yield* waitForTaskHalt(serverTask, 100);
        yield* waitForTaskHalt(runtimeTask, 100);
        yield* providerRuntime.close();
        yield* providerHby.close();
      }
    });
  } finally {
    await Deno.remove(headRoot, { recursive: true }).catch(() => undefined);
  }
});

async function seedMailboxProvider(headRoot: string, url: string): Promise<MailboxProvider> {
  const name = `mailbox-provider-${crypto.randomUUID()}`;
  const headDirPath = `${headRoot}/provider`;
  const alias = "mailbox";
  let pre = "";
  let loc = new Uint8Array();

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({ name, headDirPath, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      pre = hab.pre;
      loc = new Uint8Array(hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(runtime, loc);
      ingestKeriBytes(runtime, hab.makeEndRole(hab.pre, EndpointRoles.controller, true));
      ingestKeriBytes(runtime, hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true));
      yield* processRuntimeTurn(runtime, { hab, pollMailbox: false });
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });

  return { name, headDirPath, alias, pre, url, loc };
}

async function initAndInceptMember(headRoot: string, alias: string): Promise<StoreSpec> {
  const name = `member-${alias}-${crypto.randomUUID()}`;
  const headDirPath = `${headRoot}/${alias}`;
  const init = await runTufa([
    "init",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--nopasscode",
  ]);
  assertCommandOk(init, `init ${alias}`);

  const incept = await runTufa([
    "incept",
    "--name",
    name,
    "--head-dir",
    headDirPath,
    "--alias",
    alias,
    "--transferable",
    "--icount",
    "1",
    "--isith",
    "1",
    "--ncount",
    "1",
    "--nsith",
    "1",
    "--toad",
    "0",
  ]);
  assertCommandOk(incept, `incept ${alias}`);

  return { name, headDirPath, alias, pre: extractPrefix(incept.stdout) };
}

async function seedMailboxAndPeerState(
  stores: readonly StoreSpec[],
  provider: MailboxProvider,
): Promise<void> {
  const providerKel = await clonePreMessages(provider.name, provider.headDirPath, provider.pre);
  const memberKels = await Promise.all(
    stores.map((store) => clonePreMessages(store.name, store.headDirPath, store.pre)),
  );
  const mailboxReplies = await Promise.all(
    stores.map((store) => issueMailboxRole(store, provider, providerKel)),
  );
  const shared = [
    ...providerKel,
    provider.loc,
    ...memberKels.flat(),
    ...mailboxReplies,
  ];
  await Promise.all([
    ...stores.map((store) => ingestSharedState(store.name, store.headDirPath, store.alias, shared)),
    ingestSharedState(provider.name, provider.headDirPath, provider.alias, shared),
  ]);
}

async function clonePreMessages(
  name: string,
  headDirPath: string,
  pre: string,
): Promise<Uint8Array[]> {
  const messages: Uint8Array[] = [];
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({ name, headDirPath, skipConfig: true });
    try {
      messages.push(...hby.db.clonePreIter(pre));
    } finally {
      yield* hby.close();
    }
  });
  return messages;
}

async function issueMailboxRole(
  store: StoreSpec,
  provider: MailboxProvider,
  providerKel: readonly Uint8Array[],
): Promise<Uint8Array> {
  let reply = new Uint8Array();
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: store.name,
      headDirPath: store.headDirPath,
      skipConfig: true,
    });
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    try {
      for (const message of providerKel) {
        ingestKeriBytes(runtime, message);
      }
      ingestKeriBytes(runtime, provider.loc);
      yield* processRuntimeTurn(runtime, { pollMailbox: false });
      const hab = hby.habByName(store.alias);
      assertExists(hab);
      reply = new Uint8Array(hab.makeEndRole(provider.pre, EndpointRoles.mailbox, true));
      ingestKeriBytes(runtime, reply);
      yield* processRuntimeTurn(runtime, { hab, pollMailbox: false });
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });
  return reply;
}

async function ingestSharedState(
  name: string,
  headDirPath: string,
  alias: string,
  messages: readonly Uint8Array[],
): Promise<void> {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({ name, headDirPath, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    try {
      const hab = hby.habByName(alias);
      for (const message of messages) {
        ingestKeriBytes(runtime, message);
      }
      yield* processRuntimeTurn(runtime, { hab: hab ?? undefined, pollMailbox: false });
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });
}

async function runProposalWithJoin(
  proposerArgs: string[],
  joiner: StoreSpec,
  group: string,
): Promise<{ proposer: CmdResult; joiner: CmdResult }> {
  const child = spawnTufa(proposerArgs);
  await delay(750);
  const joined = await runTufa([
    "multisig",
    "join",
    "--name",
    joiner.name,
    "--head-dir",
    joiner.headDirPath,
    "--group",
    group,
    "--auto",
    "--poll-turns",
    "32",
    "--poll-budget-ms",
    "500",
  ]);
  assertCommandOk(joined, `join ${group}`);
  const proposed = await waitForChild(child, 20_000);
  assertCommandOk(proposed, proposerArgs.join(" "));
  return { proposer: proposed, joiner: joined };
}

async function writeDidWebsArtifacts(
  store: StoreSpec,
  did: string,
  outputDir: string,
): Promise<void> {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({
      name: store.name,
      headDirPath: store.headDirPath,
      skipConfig: true,
    });
    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
    try {
      const artifacts = generateDidWebsArtifacts(runtime, {
        alias: "team",
        did,
      });
      const artifactDir = `${outputDir}/dws/${did.split(":").at(-1)}`;
      Deno.mkdirSync(artifactDir, { recursive: true });
      Deno.writeFileSync(`${artifactDir}/did.json`, artifacts.didJson);
      Deno.writeFileSync(`${artifactDir}/keri.cesr`, artifacts.keriCesr);
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });
}

function assertNestedConditionalProof(document: unknown, groupPre: string): void {
  if (!document || typeof document !== "object") {
    throw new Error("Expected DID document object.");
  }
  const methods = (document as { verificationMethod?: unknown }).verificationMethod;
  if (!Array.isArray(methods)) {
    throw new Error("Expected DID verificationMethod array.");
  }
  const byId = new Map(methods.map((method) => {
    if (!method || typeof method !== "object" || typeof (method as { id?: unknown }).id !== "string") {
      throw new Error("Expected verification method id.");
    }
    return [(method as { id: string }).id, method as Record<string, unknown>];
  }));
  const root = byId.get(`#${groupPre}`);
  const child = byId.get(`#${groupPre}-kt-c0-g0`);
  assertExists(root);
  assertExists(child);
  assertEquals(root.type, "ConditionalProof2022");
  assertEquals(root.threshold, 1);
  assertEquals(root.conditionWeightedThreshold, [
    { condition: `#${groupPre}-kt-c0-g0`, weight: 1 },
    { condition: rootKeyAt(methods, 2), weight: 1 },
  ]);
  assertEquals("path" in root, false);
  assertEquals(child.type, "ConditionalProof2022");
  assertEquals(child.threshold, 2);
  assertEquals("path" in child, false);
}

function rootKeyAt(methods: readonly unknown[], index: number): string {
  const keys = methods
    .filter((method): method is { id: string; type?: string } =>
      !!method && typeof method === "object" && typeof (method as { id?: unknown }).id === "string"
    )
    .filter((method) => method.type === "JsonWebKey")
    .map((method) => method.id);
  const key = keys[index];
  if (!key) {
    throw new Error(`Expected key method at index ${index}.`);
  }
  return key;
}

async function waitForChild(child: SpawnedChild, timeoutMs: number): Promise<CmdResult> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const status = await Promise.race([
      child.status,
      new Promise<Deno.CommandStatus>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error("command timed out")), timeoutMs);
      }),
    ]);
    const [stdout, stderr] = await Promise.all([
      child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
      child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
    ]);
    return { code: status.code, stdout, stderr };
  } catch (error) {
    try {
      child.kill("SIGTERM");
    } catch {
      // It may have exited between the timeout and kill.
    }
    throw error;
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function assertCommandOk(result: CmdResult, label: string): void {
  assertEquals(result.code, 0, `${label}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
}

function parseLastJson(output: string): Record<string, unknown> {
  const line = output.trim().split(/\r?\n/).reverse().find((candidate) => candidate.trim().startsWith("{"));
  if (!line) {
    throw new Error(`No JSON line in output:\n${output}`);
  }
  return JSON.parse(line) as Record<string, unknown>;
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected string field ${key}.`);
  }
  return value;
}

function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((candidate) => candidate.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  return line.trim().split(/\s+/).at(-1) ?? "";
}

function writeJson(path: string, value: unknown): Promise<void> {
  return Deno.writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function* waitForPromise<T>(promise: Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve, reject);
    return () => {};
  });
}

function* fetchJson(url: string): Operation<unknown> {
  const response = yield* waitForPromise(fetch(url));
  assertEquals(response.status, 200);
  return yield* waitForPromise(response.json());
}
