import { systemClock } from "../../../keri/src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../keri/src/app/transport/http-client.ts";
// @file-test-lane app-stateful-a

import { startServer } from "@keri-ts/hosting";
import { createProtocolHandler } from "@keri-ts/hosting";
import { action, type Operation, run, spawn } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import {
  createAgentRuntime,
  createHabery,
  EndpointRoles,
  generateDidWebsArtifacts,
  runAgentRuntime,
  Schemer,
  settleRuntimeIngress,
} from "keri-ts/runtime";
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
      const providerRuntime = yield* createAgentRuntime(
        providerHby,
        new FetchHttpClient(),
        systemClock,
        { enableMailboxStore: true },
      );
      const providerHab = providerHby.habByName(provider.alias);
      // The provider is also a pollable local AID: acquire its listener before consumers.
      const serverTask = yield* spawn(function*() {
        yield* startServer(providerPort, undefined, providerRuntime);
      });
      yield* waitForServer(providerPort);
      const runtimeTask = yield* spawn(function*() {
        yield* runAgentRuntime(providerRuntime, { hab: providerHab ?? undefined });
      });

      try {
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
        yield* waitForPromise(assertGroupCommandBoundaries(bob, alice.pre, groupPre));

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
        const interactStatus = parseLastJson(interact.proposer.stdout);
        assertEquals(interactStatus.accepted, true);
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
        const rpyStatus = parseLastJson(rpy.proposer.stdout);
        assertEquals(rpyStatus.accepted, true);
        assertEquals(parseLastJson(rpy.joiner.stdout).accepted, true);

        yield* waitForPromise(
          assertStoredMessageIdentities(alice, [inceptStatus, interactStatus, rpyStatus], [bob.pre, carol.pre]),
        );

        // Each original joiner process has exited and consumed its notification.
        // Resume exact historical EXNs through fresh public CLI invocations.
        for (
          const [proposed, joined] of [
            [inceptStatus, parseLastJson(incept.joiner.stdout)],
            [interactStatus, parseLastJson(interact.joiner.stdout)],
            [rpyStatus, parseLastJson(rpy.joiner.stdout)],
          ]
        ) {
          const messages = proposed.messages;
          if (!Array.isArray(messages)) throw new Error("Missing proposal messages");
          const selected = messages.find(message => message.recipient === bob.pre);
          assertExists(selected);
          const resumed = yield* waitForPromise(runTufa([
            "multisig",
            "join",
            "--name",
            bob.name,
            "--head-dir",
            bob.headDirPath,
            "--group",
            "team",
            "--said",
            selected.exnSaid,
            "--auto",
            "--approval-timeout",
            "5",
          ]));
          assertCommandOk(resumed, "resume stored multisig approval");
          const report = parseLastJson(resumed.stdout);
          assertEquals(report.accepted, true);
          assertEquals(report.said, selected.exnSaid);
          assertEquals(report.embedded, joined.embedded);
          assertEquals(report.messages, joined.messages);
        }

        yield* waitForPromise(assertGroupCredentialCommands(alice, bob, groupPre, headRoot));

        const dwsPort = reserveTcpPort();
        const did = `did:webs:127.0.0.1%3A${dwsPort}:dws:${groupPre}`;
        const webRoot = `${headRoot}/web-root`;
        yield* waitForPromise(writeDidWebsArtifacts(alice, did, webRoot));
        const dwsHby = yield* createHabery({
          name: `dws-resolver-${crypto.randomUUID()}`,
          headDirPath: `${headRoot}/dws-resolver`,
          skipConfig: true,
        });
        const dwsRuntime = yield* createAgentRuntime(
          dwsHby,
          new FetchHttpClient(),
          systemClock,
        );
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
        // Stop loopback polling before closing the listener it still needs.
        yield* waitForTaskHalt(runtimeTask, 100);
        yield* waitForTaskHalt(serverTask, 100);
        yield* providerRuntime.close();
        yield* providerHby.close();
      }
    });
  } finally {
    await Deno.remove(headRoot, { recursive: true }).catch(() => undefined);
  }
});

Deno.test("tufa/multisig - witnessed group credential publication resumes the original VCP after receipt failure", async () => {
  const headRoot = await Deno.makeTempDir({ prefix: "tufa-witnessed-credentials-" });
  try {
    const port = reserveTcpPort();
    const provider = await seedMailboxProvider(headRoot, `http://127.0.0.1:${port}`);
    const alice = await initAndInceptMember(headRoot, "alice");
    const bob = await initAndInceptMember(headRoot, "bob");
    const carol = await initAndInceptMember(headRoot, "carol");
    const stores = [alice, bob, carol];
    await seedMailboxAndPeerState(stores, provider);
    await run(function*() {
      const hby = yield* createHabery({ name: provider.name, headDirPath: provider.headDirPath, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
      const witness = hby.habByName(provider.alias)!;
      const handler = createProtocolHandler(runtime, {
        hostedPrefixes: [witness.pre],
        serviceHab: witness,
        witnessHab: witness,
      });
      let withhold = false;
      const server = Deno.serve({ hostname: "127.0.0.1", port, onListen() {} }, request => {
        if (withhold && new URL(request.url).pathname === "/receipts") {
          return new Response("withheld receipt", { status: 403 });
        }
        return handler(request);
      });
      const worker = yield* spawn(() => runAgentRuntime(runtime, { hab: witness }));
      try {
        const config = `${headRoot}/group.json`;
        yield* waitForPromise(writeJson(config, {
          aids: stores.map(store => store.pre),
          rmids: stores.map(store => store.pre),
          isith: [{ "1": ["1/2", "1/2"] }, "1"],
          nsith: [{ "1": ["1/2", "1/2"] }, "1"],
          wits: [witness.pre],
          toad: 1,
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
            config,
            "--approval-timeout",
            "12",
          ],
          bob,
          "team",
        ));
        const group = stringField(parseLastJson(incept.proposer.stdout), "group");
        assertEquals(hby.db.getKever(group)?.sn, 0);
        const proposed = yield* waitForPromise(runTufa([
          "vc",
          "registry",
          "incept",
          "--name",
          alice.name,
          "--head-dir",
          alice.headDirPath,
          "--alias",
          "team",
          "--registry-name",
          "credentials",
          "--timeout",
          "0",
        ]));
        assertCommandOk(proposed, "propose witnessed group registry");
        const report = parseLastJson(proposed.stdout);
        const regk = stringField(report, "registry");
        assertEquals(report.publicationComplete, false);
        const messages = report.messages;
        if (!Array.isArray(messages)) throw new Error("Missing registry proposal messages");
        const selected = messages.find(message => message.recipient === bob.pre);
        assertExists(selected);
        const join = (member: StoreSpec) => [
          "multisig",
          "join",
          "--name",
          member.name,
          "--head-dir",
          member.headDirPath,
          "--group",
          "team",
          "--said",
          selected.exnSaid,
          "--auto",
          "--approval-timeout",
          "8",
        ];
        withhold = true;
        const failed = yield* waitForPromise(runTufa(join(bob)));
        assertEquals(failed.code === 0, false);
        assertStringIncludes(failed.stderr, "failed to receipt");
        assertEquals(runtime.vdr!.tvy.tevers.has(regk), false);
        let anchor = "";
        yield* waitForPromise(run(function*() {
          const memberHby = yield* createHabery({ name: bob.name, headDirPath: bob.headDirPath, skipConfig: true });
          const memberRuntime = yield* createAgentRuntime(memberHby, new FetchHttpClient(), systemClock);
          try {
            anchor = memberHby.db.kels.getLast(group, 1)!;
            assertExists(anchor);
            assertEquals(memberRuntime.vdr!.publication.complete(regk), false);
            assertEquals(
              memberRuntime.vdr!.publication.pendingReceipts().some(target =>
                target.pre === regk && target.anchorSaid === anchor
              ),
              true,
            );
          } finally {
            yield* memberRuntime.close();
            yield* memberHby.close();
          }
        }));
        withhold = false;
        for (const member of [bob, alice]) {
          const resumed = yield* waitForPromise(runTufa(join(member)));
          assertCommandOk(resumed, "resume original witnessed VCP");
          const completed = parseLastJson(resumed.stdout);
          assertEquals(completed.accepted, true);
          assertEquals(completed.tel, { pre: regk, sn: 0, publicationComplete: true });
          yield* waitForPromise(run(function*() {
            const memberHby = yield* createHabery({
              name: member.name,
              headDirPath: member.headDirPath,
              skipConfig: true,
            });
            const memberRuntime = yield* createAgentRuntime(memberHby, new FetchHttpClient(), systemClock);
            try {
              assertEquals(memberHby.db.kels.getLast(group, 1), anchor);
              assertEquals(memberRuntime.vdr!.reger.ancs.get([regk, regk])?.[1].qb64, anchor);
              assertEquals(memberRuntime.vdr!.publication.complete(regk), true);
            } finally {
              yield* memberRuntime.close();
              yield* memberHby.close();
            }
          }));
        }
        assertEquals(runtime.vdr!.tvy.tevers.get(regk)?.serder.said, regk);
        const schema = yield* waitForPromise(importCredentialSchema([alice, bob], headRoot));
        const issued = yield* waitForPromise(assertGroupIssuanceCommands(alice, bob, group, regk, schema));
        assertEquals(runtime.vdr!.tvy.tevers.get(regk)?.vcState(issued.credential)?.et, "iss");
        assertEquals(runtime.vdr!.reger.tels.getOn(issued.credential, 0)?.qb64, issued.tel);
        assertEquals(hby.db.getKever(group)?.sn, 2);
      } finally {
        yield* waitForTaskHalt(worker, 100);
        yield* waitForPromise(server.shutdown());
        handler.close?.();
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(headRoot, { recursive: true });
  }
});

/** Exercise weighted VCP/ISS approval through fresh CLI processes, keeping the third member absent. */
async function assertGroupCredentialCommands(
  alice: StoreSpec,
  bob: StoreSpec,
  group: string,
  headRoot: string,
): Promise<void> {
  const location = (store: StoreSpec) => ["--name", store.name, "--head-dir", store.headDirPath];
  const schema = await importCredentialSchema([alice, bob], headRoot);
  const registry = await runProposalWithJoin(
    [
      "vc",
      "registry",
      "incept",
      ...location(alice),
      "--alias",
      "team",
      "--registry-name",
      "credentials",
      "--timeout",
      "12",
    ],
    bob,
    "team",
  );
  const registryStatus = parseLastJson(registry.proposer.stdout);
  const joinedRegistry = parseLastJson(registry.joiner.stdout);
  const regk = stringField(registryStatus, "registry");
  assertEquals(registryStatus.accepted, true, JSON.stringify({ registryStatus, joinedRegistry }));
  assertEquals(registryStatus.publicationComplete, true);
  assertEquals(registryStatus.status, "accept");
  assertEquals(joinedRegistry.accepted, true);
  assertEquals(joinedRegistry.tel, { pre: regk, sn: 0, publicationComplete: true });

  await assertGroupIssuanceCommands(alice, bob, group, regk, schema);
}

/** Import the same real schema into each independent member store through the public CLI. */
async function importCredentialSchema(stores: readonly StoreSpec[], headRoot: string): Promise<string> {
  const schema = new Schemer({ sed: { $id: "", type: "object" } });
  const schemaFile = `${headRoot}/credential-schema.json`;
  await Deno.writeFile(schemaFile, schema.raw);
  for (const member of stores) {
    assertCommandOk(
      await runTufa([
        "vc",
        "schema",
        "import",
        "--name",
        member.name,
        "--head-dir",
        member.headDirPath,
        "--schema",
        schemaFile,
      ]),
      "import group schema",
    );
  }
  return schema.said;
}

/** Resume the original ISS through independent member processes and verify both saved states. */
async function assertGroupIssuanceCommands(
  alice: StoreSpec,
  bob: StoreSpec,
  group: string,
  regk: string,
  schema: string,
): Promise<{ credential: string; tel: string }> {
  const location = (store: StoreSpec) => ["--name", store.name, "--head-dir", store.headDirPath];
  const issue = await runTufa([
    "vc",
    "create",
    ...location(alice),
    "--alias",
    "team",
    "--registry-name",
    "credentials",
    "--schema",
    schema,
    "--recipient",
    bob.pre,
    "--data",
    "{\"role\":\"holder\"}",
    "--timeout",
    "0",
  ]);
  assertCommandOk(issue, "propose group issuance without waiting");
  const issued = parseLastJson(issue.stdout);
  const credential = stringField(issued, "said");
  assertEquals(issued.publicationComplete, false);
  assertEquals(issued.saved, false);
  const messages = issued.messages;
  if (!Array.isArray(messages)) throw new Error("Missing credential coordination messages");
  const selected = messages.find(message => message.recipient === bob.pre);
  assertExists(selected);
  // Bob approves the original EXN, then Alice resumes it after her proposing process exited.
  for (const member of [bob, alice]) {
    const joined = await runTufa([
      "multisig",
      "join",
      ...location(member),
      "--group",
      "team",
      "--said",
      selected.exnSaid,
      "--auto",
      "--approval-timeout",
      "8",
    ]);
    assertCommandOk(joined, "complete group issuance");
    const report = parseLastJson(joined.stdout);
    assertEquals(report.accepted, true);
    assertEquals(report.embedded, issued.tel);
    assertEquals(report.tel, { pre: credential, sn: 0, publicationComplete: true });
    await run(function*() {
      const hby = yield* createHabery({ name: member.name, headDirPath: member.headDirPath, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        assertEquals(runtime.vdr!.reger.saved.get(credential)?.qb64, credential);
        assertEquals(runtime.vdr!.reger.tels.getOn(credential, 0)?.qb64, issued.tel);
        assertEquals(runtime.vdr!.reger.states.get(regk)?.ii, group);
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
  }
  return { credential, tel: stringField(issued, "tel") };
}

/** Compare CLI send identities with actual persisted wrappers and Multiplexor indexes. */
/** Public commands must refuse uncoordinated group work before business-state writes. */
async function assertGroupCommandBoundaries(store: StoreSpec, recipient: string, group: string): Promise<void> {
  const before = await groupSigningState(store, group);
  const location = ["--name", store.name, "--head-dir", store.headDirPath];
  const cases: [string[], string][] = [
    [["incept", ...location, "--alias", "team"], "inception requires an unused alias"],
    [["interact", ...location, "--alias", "team", "--data", "{\"unexpected\":true}"], "multisig interact"],
    [["rotate", ...location, "--alias", "team"], "multisig rotate"],
    [
      ["exchange", "send", ...location, "--sender", "team", "--recipient", recipient, "--route", "/test"],
      "does not coordinate group approval",
    ],
    [
      ["challenge", "respond", ...location, "--alias", "team", "--recipient", recipient, "--words", "alpha beta gamma"],
      "Select the responding member alias",
    ],
    [["loc", "add", ...location, "--alias", "team", "--url", "http://127.0.0.1:12345"], "endpoint-owner alias"],
    [["query", ...location, "--alias", "team", "--prefix", recipient], "member requester"],
    [
      ["dws", "bind", ...location, "--alias", "team", "--did", `did:webs:example.com:${group}`],
      "does not coordinate group credential approval",
    ],
  ];
  for (const [args, message] of cases) {
    const result = await runTufa(args);
    assertEquals(result.code === 0, false, `${args[0]} must refuse uncoordinated group signing`);
    assertStringIncludes(`${result.stdout}\n${result.stderr}`, message);
  }
  const contribution = await runTufa(["sign", ...location, "--alias", "team", "--text", "member contribution"]);
  assertCommandOk(contribution, "raw group contribution");
  assertStringIncludes(contribution.stdout, "Partial multisig signature contribution");
  assertEquals(await groupSigningState(store, group), before);
}

/** Compare the exact accepted state, keeper state and retained signatures across refused commands. */
async function groupSigningState(store: StoreSpec, group: string) {
  return await run(function*() {
    const hby = yield* createHabery({ name: store.name, headDirPath: store.headDirPath, skipConfig: true });
    try {
      return {
        alias: hby.db.getName("", "team"),
        habitat: hby.db.getHab(group),
        state: hby.db.getState(group),
        memberKeys: hby.ks.getSits(store.pre),
        signatures: [...hby.db.sigs.getTopItemIter([group])].map(([keys, sig]) => [keys, sig.qb64]),
        messages: [...hby.db.exns.getItemIter()].map(([, exn]) => exn.said),
        locations: [...hby.db.locs.getTopItemIter()],
      };
    } finally {
      yield* hby.close();
    }
  });
}

async function assertStoredMessageIdentities(
  store: StoreSpec,
  reports: Record<string, unknown>[],
  recipients: string[],
): Promise<void> {
  await run(function*() {
    const hby = yield* createHabery({ name: store.name, headDirPath: store.headDirPath, skipConfig: true });
    try {
      for (const report of reports) {
        const messages = report.messages;
        if (!Array.isArray(messages)) throw new Error("Expected coordination messages in the CLI result");
        assertEquals(messages.map(message => message.recipient), recipients);
        for (const message of messages) {
          const wrapper = hby.db.exns.get([message.exnSaid]);
          assertExists(wrapper);
          assertEquals(wrapper.said, message.exnSaid);
          assertEquals((wrapper.ked!.e as { d: string }).d, message.payloadSaid);
          assertEquals(hby.db.meids.get([message.payloadSaid]).some(said => said.qb64 === message.exnSaid), true);
        }
      }
    } finally {
      yield* hby.close();
    }
  });
}

async function seedMailboxProvider(headRoot: string, url: string): Promise<MailboxProvider> {
  const name = `mailbox-provider-${crypto.randomUUID()}`;
  const headDirPath = `${headRoot}/provider`;
  const alias = "mailbox";
  let pre = "";
  let loc = new Uint8Array();

  await run(function*(): Operation<void> {
    const hby = yield* createHabery({ name, headDirPath, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      pre = hab.pre;
      loc = new Uint8Array(hab.makeLocScheme(url, hab.pre, "http"));
      yield* settleRuntimeIngress(runtime, [
        loc,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
        hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
      ]);
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
    ...stores.map((store) => ingestSharedState(store.name, store.headDirPath, shared)),
    ingestSharedState(provider.name, provider.headDirPath, shared),
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
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      yield* settleRuntimeIngress(runtime, [...providerKel, provider.loc]);
      const hab = hby.habByName(store.alias);
      assertExists(hab);
      reply = new Uint8Array(hab.makeEndRole(provider.pre, EndpointRoles.mailbox, true));
      yield* settleRuntimeIngress(runtime, [reply]);
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
  messages: readonly Uint8Array[],
): Promise<void> {
  await run(function*(): Operation<void> {
    const hby = yield* createHabery({ name, headDirPath, skipConfig: true });
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      // Seed accepted protocol state before the provider host starts; this is not a sender turn.
      yield* settleRuntimeIngress(runtime, messages);
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
    "--approval-timeout",
    "20",
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
    const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
    try {
      const artifacts = generateDidWebsArtifacts(runtime.vdr!, {
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
