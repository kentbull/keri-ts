// @file-test-lane runtime-medium

/**
 * Mailbox runtime end-to-end unit scenarios.
 *
 * These tests exercise the mailbox stack as a cooperating runtime slice rather
 * than as isolated helpers:
 * - mailbox admin hosted relative to the stored mailbox URL path
 * - root OOBI hosting through the shared runtime server
 * - mailbox start provisioning for root and non-root hosted paths
 * - agent controller bootstrap config behavior
 * - multi-AID host filtering for the selected mailbox alias
 */
import { action, type Operation, run, spawn } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { concatBytes, Diger, SealSource, SerderKERI, Siger } from "../../../../cesr/mod.ts";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processMailboxTurn,
  processRuntimeTurn,
  runAgentRuntime,
} from "../../../src/app/agent-runtime.ts";
import { findVerifiedChallengeResponse } from "../../../src/app/challenging.ts";
import { agentCommand } from "../../../src/app/cli/agent.ts";
import { challengeRespondCommand, challengeVerifyCommand } from "../../../src/app/cli/challenge.ts";
import { setupHby } from "../../../src/app/cli/common/existing.ts";
import { endsAddCommand } from "../../../src/app/cli/ends.ts";
import {
  mailboxAddCommand,
  mailboxDebugCommand,
  mailboxListCommand,
  mailboxRemoveCommand,
  mailboxStartCommand,
  mailboxUpdateCommand,
} from "../../../src/app/cli/mailbox.ts";
import { oobiGenerateCommand, oobiResolveCommand } from "../../../src/app/cli/oobi.ts";
import { createConfiger } from "../../../src/app/configing.ts";
import { MailboxPoller } from "../../../src/app/forwarding.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { MailboxDirector } from "../../../src/app/mailbox-director.ts";
import { fetchEndpointUrls, mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { startServer } from "../../../src/app/server.ts";
import { Kevery } from "../../../src/core/eventing.ts";
import { makeEmbeddedExchangeMessage, makeExchangeSerder } from "../../../src/core/messages.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { fetchOp, sleepOp, textOp, waitForServer, waitForTaskHalt } from "../../effection-http.ts";
import { reserveTcpPort } from "../../http-test-support.ts";
import { CLITestHarness, testCLICommand } from "../../utils.ts";

/** Return a random localhost port for ephemeral mailbox and OOBI hosts. */
function randomPort(): number {
  return reserveTcpPort();
}

/**
 * Start a minimal static OOBI host used by the mailbox tests.
 *
 * This deliberately avoids the full runtime host so the tests can control the
 * exact controller OOBI bytes served from the remote endpoint.
 */
function startStaticOobiHost(
  port: number,
  handler: (request: Request, url: URL) => Response | Promise<Response>,
): { close: () => Promise<void> } {
  const controller = new AbortController();
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port,
    signal: controller.signal,
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return await handler(request, url);
  });

  return {
    async close() {
      controller.abort();
      try {
        await server.finished;
      } catch {
        // Abort-driven shutdown is expected here.
      }
    },
  };
}

/** Return one standard controller OOBI HTTP response for a seeded test host. */
function controllerOobiResponse(
  pre: string,
  controllerBytes: Uint8Array,
): Response {
  return new Response(new Uint8Array(controllerBytes).buffer, {
    status: 200,
    headers: { "Content-Type": "application/cesr", "Oobi-Aid": pre },
  });
}

/** Collect one controller replay stream for remote mailbox admin submission. */
function collectReplay(
  hby: Habery,
  pre: string,
): Uint8Array {
  const parts: Uint8Array[] = [];
  const kever = hby.db.getKever(pre);
  if (kever) {
    parts.push(...hby.db.cloneDelegation(kever));
  }
  parts.push(...hby.db.clonePreIter(pre));
  return parts.length === 0 ? new Uint8Array() : concatBytes(...parts);
}

function eventSeal(serder: SerderKERI) {
  assertExists(serder.pre);
  assertExists(serder.snh);
  assertExists(serder.said);
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

function sourceSealFor(serder: SerderKERI): SealSource {
  assertExists(serder.sner);
  assertExists(serder.said);
  return SealSource.fromTuple([
    serder.sner,
    new Diger({ qb64: serder.said }),
  ]);
}

function makeDelegatingInteraction(
  pre: string,
  sn: number,
  prior: string,
  seals: ReturnType<typeof eventSeal>[],
): SerderKERI {
  return new SerderKERI({
    sad: {
      t: "ixn",
      i: pre,
      s: sn.toString(16),
      p: prior,
      a: seals,
    },
    makify: true,
  });
}

function anchorDelegatedHab(
  hby: Habery,
  delegator: Hab,
  delegated: Hab,
): void {
  const delegatorKever = delegator.kever;
  const delegatedKever = delegated.kever;
  assertExists(delegatorKever);
  assertExists(delegatedKever);
  assertExists(delegatorKever.said);
  assertExists(delegatedKever.said);

  const dip = hby.db.getEvtSerder(delegated.pre, delegatedKever.said);
  assertExists(dip);

  const anchor = makeDelegatingInteraction(
    delegator.pre,
    1,
    delegatorKever.said,
    [eventSeal(dip)],
  );
  const kvy = new Kevery(hby.db);
  assertEquals(
    kvy.processEvent({
      serder: anchor,
      sigers: delegator.sign(anchor.raw, true) as Siger[],
      wigers: [],
      frcs: [],
      sscs: [],
      ssts: [],
      local: true,
    }).kind,
    "accept",
  );
  const replayedDip = kvy.processEvent({
    serder: dip,
    sigers: hby.db.sigs.get([delegated.pre, delegatedKever.said]),
    wigers: [],
    frcs: [],
    sscs: [sourceSealFor(anchor)],
    ssts: [],
    local: true,
  }).kind;
  assertEquals(
    replayedDip === "accept" || replayedDip === "duplicate",
    true,
  );
  assertExists(dip.said);
  assertExists(anchor.sner);
  assertExists(anchor.said);

  // The local habitat already accepted `dip` during creation, so replaying it
  // through a fresh `Kevery` often resolves as `duplicate` instead of
  // re-logging the accepted source seal. Persist the authoritative anchor
  // explicitly so later `clonePreIter(...)` exports include the delegation
  // proof a third-party mailbox host needs.
  hby.db.aess.pin(dgKey(delegated.pre, dip.said), [
    anchor.sner,
    new Diger({ qb64: anchor.said }),
  ]);
}

/** Read one JSON response body inside the Effection runtime. */
function* jsonOp<T>(response: Response): Operation<T> {
  return yield* action<T>((resolve, reject) => {
    response.json().then((value) => resolve(value as T)).catch(reject);
    return () => {};
  });
}

/** Assert one HTTP status and surface the response body on mismatch. */
function* assertResponseStatus(
  response: Response,
  expected: number,
): Operation<void> {
  if (response.status === expected) {
    return;
  }
  const body = yield* textOp(response);
  throw new Error(
    `Expected HTTP ${expected}, got ${response.status}: ${body}`,
  );
}

/**
 * Resolve one remote controller OOBI and authorize it locally as a mailbox.
 *
 * These focused poller tests care about local mailbox polling state, not the
 * remote mailbox admin workflow, so they use the local `ends add` seam after
 * resolving the remote controller endpoint.
 */
async function authorizeMailboxPollTarget(
  name: string,
  headDirPath: string,
  alias: string,
  mailboxPre: string,
  mailboxUrl: string,
): Promise<void> {
  await run(function*() {
    const resolved = yield* testCLICommand(
      oobiResolveCommand({
        name,
        headDirPath,
        url: `${mailboxUrl}/oobi/${mailboxPre}/controller`,
        oobiAlias: mailboxPre,
      }),
    );
    assertEquals(
      resolved.output.at(-1),
      `${mailboxUrl}/oobi/${mailboxPre}/controller`,
    );

    const added = yield* testCLICommand(
      endsAddCommand({
        name,
        headDirPath,
        alias,
        role: "mailbox",
        eid: mailboxPre,
      }),
    );
    assertEquals(added.output.at(-1), `mailbox ${mailboxPre}`);
  });
}

/** Wait for a short-lived test condition inside one Effection task tree. */
function* waitForCondition(
  condition: () => boolean,
  {
    timeoutMs = 500,
    retryDelayMs = 10,
    message = "Timed out waiting for condition.",
  }: {
    timeoutMs?: number;
    retryDelayMs?: number;
    message?: string;
  } = {},
): Operation<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }
    yield* sleepOp(retryDelayMs);
  }
  throw new Error(message);
}

/** Delay inside a test HTTP handler, but clear the timer if the request aborts. */
async function delayForRequest(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return;
  }

  await new Promise<void>((resolve) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Seed one non-transferable mailbox provider habitat with location and end-role
 * state.
 */
async function seedMailboxHost(
  name: string,
  headDirPath: string,
  alias: string,
  url: string,
): Promise<string> {
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      pre = hab.pre;
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true),
      );
      yield* processRuntimeTurn(runtime, { hab });
    } finally {
      yield* hby.close();
    }
  });

  return pre;
}

/**
 * Seed one hosted transferable controller and capture its controller OOBI
 * response bytes for later static serving.
 */
async function seedHostedController(
  name: string,
  headDirPath: string,
  alias: string,
  url: string,
): Promise<{ pre: string; controllerBytes: Uint8Array }> {
  let pre = "";
  let controllerBytes = new Uint8Array();

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      ingestKeriBytes(runtime, hab.makeLocScheme(url, hab.pre, "http"));
      ingestKeriBytes(
        runtime,
        hab.makeEndRole(hab.pre, EndpointRoles.controller, true),
      );
      yield* processRuntimeTurn(runtime, { hab });
      controllerBytes = new Uint8Array(
        hab.replyToOobi(pre, EndpointRoles.controller),
      );
    } finally {
      yield* hby.close();
    }
  });

  return { pre, controllerBytes };
}

/** Seed one local transferable controller used as a mailbox client in tests. */
async function seedLocalController(
  name: string,
  headDirPath: string,
  alias: string,
): Promise<string> {
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      pre = hby.makeHab(alias, undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
    } finally {
      yield* hby.close();
    }
  });

  return pre;
}

/**
 * Build one `/fwd` message carrying an embedded `/challenge/response` payload.
 *
 * The authorization test uses this helper to exercise mailbox storage without
 * depending on the higher-level challenge CLI path.
 */
function* buildForwardMessage(
  senderName: string,
  senderHeadDirPath: string,
  recipientPre: string,
): Operation<Uint8Array> {
  const hby = yield* createHabery({
    name: senderName,
    headDirPath: senderHeadDirPath,
    skipConfig: true,
  });

  try {
    let sender = hby.habByName("sender");
    if (!sender) {
      sender = hby.makeHab("sender", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
    }

    const embedded = sender.endorse(
      makeExchangeSerder("/challenge/response", {
        i: sender.pre,
        words: ["able", "baker"],
      }, {
        sender: sender.pre,
        recipient: recipientPre,
      }),
    );
    const wrapped = makeEmbeddedExchangeMessage("/fwd", {}, {
      sender: sender.pre,
      modifiers: { pre: recipientPre, topic: "challenge" },
      embeds: { evt: embedded },
    });
    return concatBytes(
      sender.replyEndRole(sender.pre),
      sender.endorse(wrapped.serder),
      wrapped.attachments,
    );
  } finally {
    yield* hby.close();
  }
}

/** Post one raw CESR mailbox-forwarding request and return the HTTP status. */
function* postForward(url: string, body: Uint8Array): Operation<number> {
  const response = yield* fetchOp(url, {
    method: "POST",
    headers: { "Content-Type": "application/cesr" },
    body: new TextDecoder().decode(body),
  });
  return response.status;
}

/** Post one raw CESR mailbox admin request and return the full HTTP response. */
function* postMailboxAdmin(
  url: string,
  body: Uint8Array,
  contentType = "application/cesr",
): Operation<Response> {
  return yield* fetchOp(url, {
    method: "POST",
    headers: { "Content-Type": contentType },
    body: new Uint8Array(body).slice().buffer,
  });
}

/** Post one multipart mailbox admin request using compatibility field names. */
function* postMailboxAdminMultipart(
  url: string,
  fields: Array<[string, string]>,
): Operation<Response> {
  const form = new FormData();
  for (const [name, value] of fields) {
    form.set(name, value);
  }
  return yield* fetchOp(url, {
    method: "POST",
    body: form,
  });
}

Deno.test("mailbox admin follows the stored mailbox URL path and does not keep a root alias", async () => {
  const providerName = `mailbox-admin-path-provider-${crypto.randomUUID()}`;
  const controllerName = `mailbox-admin-path-controller-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-admin-path-provider-${crypto.randomUUID()}`;
  const controllerHeadDirPath = `/tmp/tufa-mailbox-admin-path-controller-${crypto.randomUUID()}`;
  const port = randomPort();
  const origin = `http://127.0.0.1:${port}`;
  const advertisedUrl = `${origin}/relay`;

  await run(function*() {
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
    });
    const controllerHby = yield* createHabery({
      name: controllerName,
      headDirPath: controllerHeadDirPath,
      skipConfig: true,
    });

    const mailbox = providerHby.makeHab("relay", undefined, {
      transferable: false,
      icount: 1,
      isith: "1",
      toad: 0,
    });
    const controller = controllerHby.makeHab("alice", undefined, {
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    });

    const runtime = yield* createAgentRuntime(providerHby, {
      mode: "indirect",
    });
    const hab = providerHby.habByName("relay");
    ingestKeriBytes(
      runtime,
      mailbox.makeLocScheme(advertisedUrl, mailbox.pre, "http"),
    );
    ingestKeriBytes(
      runtime,
      mailbox.makeEndRole(mailbox.pre, EndpointRoles.controller, true),
    );
    ingestKeriBytes(
      runtime,
      mailbox.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
    );
    yield* processRuntimeTurn(runtime, { hab: hab ?? undefined });
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime, {
        hostedPrefixes: [mailbox.pre],
        serviceHab: hab ?? undefined,
      });
    });

    try {
      yield* waitForServer(port);

      const kel = new TextDecoder().decode(
        collectReplay(controllerHby, controller.pre),
      );
      const rpy = new TextDecoder().decode(
        controller.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
      );

      // Root `/mailboxes` is no longer a mailbox-admin alias when the hosted
      // mailbox URL carries a non-root path. A valid multipart admin envelope
      // therefore fails content-type handling at the generic ingress seam.
      let response = yield* postMailboxAdminMultipart(`${origin}/mailboxes`, [
        ["kel", kel],
        ["rpy", rpy],
      ]);
      assertEquals(response.status, 406);
      yield* textOp(response);

      response = yield* postMailboxAdminMultipart(
        `${advertisedUrl}/mailboxes`,
        [
          ["kel", kel],
          ["rpy", rpy],
        ],
      );
      yield* assertResponseStatus(response, 200);
      assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
        cid: controller.pre,
        role: EndpointRoles.mailbox,
        eid: mailbox.pre,
        allowed: true,
      });
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* controllerHby.close();
      yield* providerHby.close();
    }
  });
});

Deno.test("mailbox start provisions a mailbox from config and serves root mailbox routes", async () => {
  const name = `mailbox-start-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-mailbox-start-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}`;
  const configPath = `${headDirPath}/mailbox-start.json`;
  Deno.mkdirSync(headDirPath, { recursive: true });
  Deno.writeTextFileSync(
    configPath,
    JSON.stringify({
      relay: {
        dt: "2026-04-06T12:00:00.000Z",
        curls: [url],
      },
    }),
  );

  await run(function*(): Operation<void> {
    const harness = new CLITestHarness();
    harness.captureOutput();
    const serverTask = yield* spawn(function*() {
      yield* mailboxStartCommand({
        name,
        alias: "relay",
        headDirPath,
        configFile: configPath,
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });

    try {
      const prefixLine = harness.getOutput().find((line) => line.startsWith("Mailbox Prefix"));
      assertEquals(!!prefixLine, true);
      const pre = prefixLine!.split(/\s+/).at(-1)!;

      const rootOobi = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${pre}/mailbox/${pre}`,
      );
      assertEquals(rootOobi.status, 200);
      yield* textOp(rootOobi);

      const blindOobi = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi`,
      );
      assertEquals(blindOobi.status, 200);
      const blindBody = yield* textOp(blindOobi);

      const selfOobi = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${pre}`,
      );
      assertEquals(selfOobi.status, 200);
      const selfBody = yield* textOp(selfOobi);
      assertEquals(blindBody, selfBody);
      assertStringIncludes(blindBody, pre);

      const admin = yield* fetchOp(`${url}/mailboxes`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: "not cesr",
      });
      assertEquals(admin.status, 406);
      yield* textOp(admin);
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
      harness.restoreOutput();
    }

    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const hab = [...hby.habs.values()].find((current) => current.name === "relay");
      assertEquals(!!hab, true);
      const pre = hab!.pre;
      assertEquals(hab!.kever?.transferable, false);
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.controller, pre])?.allowed,
        true,
      );
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.mailbox, pre])?.allowed,
        true,
      );
      assertEquals(hab!.fetchUrls(pre, "http").http, new URL(url).toString());
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("mailbox start accepts config URLs with non-root paths and serves mailbox admin there", async () => {
  const name = `mailbox-start-path-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-mailbox-start-path-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}/relay`;
  const origin = `http://127.0.0.1:${port}`;
  const configPath = `${headDirPath}/mailbox-start.json`;
  Deno.mkdirSync(headDirPath, { recursive: true });
  Deno.writeTextFileSync(
    configPath,
    JSON.stringify({
      relay: {
        dt: "2026-04-06T12:00:00.000Z",
        curls: [url],
      },
    }),
  );

  await run(function*(): Operation<void> {
    const harness = new CLITestHarness();
    harness.captureOutput();
    const serverTask = yield* spawn(function*() {
      yield* mailboxStartCommand({
        name,
        alias: "relay",
        headDirPath,
        configFile: configPath,
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });
    const controllerHby = yield* createHabery({
      name: `mailbox-start-path-controller-${crypto.randomUUID()}`,
      headDirPath: `/tmp/tufa-mailbox-start-path-controller-${crypto.randomUUID()}`,
      skipConfig: true,
    });

    try {
      const prefixLine = harness.getOutput().find((line) => line.startsWith("Mailbox Prefix"));
      assertEquals(!!prefixLine, true);
      const pre = prefixLine!.split(/\s+/).at(-1)!;
      const controller = controllerHby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });

      const rootOobi = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${pre}/mailbox/${pre}`,
      );
      assertEquals(rootOobi.status, 200);
      yield* textOp(rootOobi);

      const blindOobi = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi`,
      );
      assertEquals(blindOobi.status, 200);
      const blindBody = yield* textOp(blindOobi);

      const selfOobi = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${pre}`,
      );
      assertEquals(selfOobi.status, 200);
      const selfBody = yield* textOp(selfOobi);
      assertEquals(blindBody, selfBody);
      assertStringIncludes(blindBody, pre);

      const kel = new TextDecoder().decode(
        collectReplay(controllerHby, controller.pre),
      );
      const rpy = new TextDecoder().decode(
        controller.makeEndRole(pre, EndpointRoles.mailbox, true),
      );

      let admin = yield* postMailboxAdminMultipart(`${origin}/mailboxes`, [
        ["kel", kel],
        ["rpy", rpy],
      ]);
      assertEquals(admin.status, 406);
      yield* textOp(admin);

      admin = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        ["kel", kel],
        ["rpy", rpy],
      ]);
      yield* assertResponseStatus(admin, 200);
      assertEquals(yield* jsonOp<Record<string, unknown>>(admin), {
        cid: controller.pre,
        role: EndpointRoles.mailbox,
        eid: pre,
        allowed: true,
      });
    } finally {
      yield* controllerHby.close();
      yield* waitForTaskHalt(serverTask, 100);
      harness.restoreOutput();
    }

    const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
      readonly: true,
      skipConfig: true,
      skipSignator: true,
    });
    try {
      const hab = [...hby.habs.values()].find((current) => current.name === "relay");
      assertEquals(!!hab, true);
      const pre = hab!.pre;
      assertEquals(hab!.kever?.transferable, false);
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.controller, pre])?.allowed,
        true,
      );
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.mailbox, pre])?.allowed,
        true,
      );
      assertEquals(hab!.fetchUrls(pre, "http").http, url);
    } finally {
      yield* hby.close();
    }
  });
});

Deno.test("agent command uses explicit config-file controller curls and does not synthesize agent role", async () => {
  const name = `agent-config-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-agent-${crypto.randomUUID()}`;
  const configDir = `/tmp/tufa-agent-config-${crypto.randomUUID()}`;
  const configFile = "agent-start";
  const port = randomPort();
  const configuredUrl = `http://localhost:${port}`;
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
      assertEquals(
        hby.db.ends.get([pre, EndpointRoles.controller, pre]),
        null,
      );
    } finally {
      yield* hby.close();
    }
  });

  await run(function*() {
    const cf = yield* createConfiger({
      name: configFile,
      headDirPath: configDir,
      temp: false,
    });
    try {
      cf.put({
        alice: {
          dt: "2026-04-06T14:00:00.000Z",
          curls: [configuredUrl],
        },
      });
    } finally {
      yield* cf.close();
    }
  });

  await run(function*(): Operation<void> {
    const serverTask = yield* spawn(function*() {
      yield* agentCommand({
        name,
        headDirPath,
        configDir,
        configFile,
        port,
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });

    try {
      const hosted = yield* fetchOp(`${configuredUrl}/oobi/${pre}/controller`);
      assertEquals(hosted.status, 200);
      yield* textOp(hosted);

      const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
        readonly: true,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertEquals(fetchEndpointUrls(hby, pre, "http").http, configuredUrl);
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.controller, pre])?.allowed,
          true,
        );
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.agent, pre]),
          null,
        );
      } finally {
        yield* hby.close();
      }
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});

Deno.test("agent command falls back to synthesized controller state only when config is absent", async () => {
  const name = `agent-fallback-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-agent-${crypto.randomUUID()}`;
  const port = randomPort();
  const fallbackUrl = `http://127.0.0.1:${port}`;
  let pre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      const hab = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      pre = hab.pre;
    } finally {
      yield* hby.close();
    }
  });

  await run(function*(): Operation<void> {
    const serverTask = yield* spawn(function*() {
      yield* agentCommand({
        name,
        headDirPath,
        port,
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });

    try {
      const hosted = yield* fetchOp(`${fallbackUrl}/oobi/${pre}/controller`);
      assertEquals(hosted.status, 200);
      yield* textOp(hosted);

      const hby = yield* setupHby(name, "", undefined, false, headDirPath, {
        readonly: true,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertEquals(fetchEndpointUrls(hby, pre, "http").http, fallbackUrl);
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.controller, pre])?.allowed,
          true,
        );
        assertEquals(
          hby.db.ends.get([pre, EndpointRoles.agent, pre]),
          null,
        );
      } finally {
        yield* hby.close();
      }
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
    }
  });
});

Deno.test("mailbox start on a multi-AID keystore serves only the selected local mailbox alias", async () => {
  const name = `mailbox-start-multi-${crypto.randomUUID()}`;
  const headDirPath = `/tmp/tufa-mailbox-start-multi-${crypto.randomUUID()}`;
  const port = randomPort();
  const startupUrl = `http://127.0.0.1:${port}`;
  let otherPre = "";

  await run(function*() {
    const hby = yield* createHabery({
      name,
      headDirPath,
      skipConfig: true,
    });
    try {
      otherPre = hby.makeHab("other", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      }).pre;
    } finally {
      yield* hby.close();
    }
  });

  await run(function*(): Operation<void> {
    const harness = new CLITestHarness();
    harness.captureOutput();
    const serverTask = yield* spawn(function*() {
      yield* mailboxStartCommand({
        name,
        alias: "relay",
        headDirPath,
        url: startupUrl,
        datetime: "2026-04-06T13:00:00.000Z",
      });
    });
    yield* waitForServer(port, { host: "127.0.0.1", maxAttempts: 30 });

    try {
      const prefixLine = harness.getOutput().find((line) => line.startsWith("Mailbox Prefix"));
      assertEquals(!!prefixLine, true);
      const relayPre = prefixLine!.split(/\s+/).at(-1)!;

      const selected = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${relayPre}/mailbox/${relayPre}`,
      );
      assertEquals(selected.status, 200);
      yield* textOp(selected);

      const unrelated = yield* fetchOp(
        `http://127.0.0.1:${port}/oobi/${otherPre}/controller`,
      );
      assertEquals(unrelated.status, 404);
      yield* textOp(unrelated);
    } finally {
      yield* waitForTaskHalt(serverTask, 100);
      harness.restoreOutput();
    }
  });
});
