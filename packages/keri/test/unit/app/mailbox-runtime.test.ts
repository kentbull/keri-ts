/**
 * Mailbox runtime end-to-end unit scenarios.
 *
 * These tests exercise the mailbox stack as a cooperating runtime slice rather
 * than as isolated helpers:
 * - mailbox add/list/update/debug command flows
 * - mailbox admin hosted relative to the stored mailbox URL path
 * - root OOBI hosting through the shared runtime server
 * - mailbox-polled challenge verification
 * - `/fwd` authorization before provider-side storage
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
import { CLITestHarness, testCLICommand } from "../../utils.ts";

/** Return a random localhost port for ephemeral mailbox and OOBI hosts. */
function randomPort(): number {
  return 20000 + Math.floor(Math.random() * 20000);
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
 * Proves the request-open timeout is separate from the SSE read duration.
 *
 * If response headers never arrive before the request timeout, mailbox polling
 * should treat that as "no messages yet" instead of hanging or throwing.
 */
Deno.test("MailboxPoller.processOnce returns cleanly when the request-open timeout expires before headers arrive", async () => {
  const providerName = `mailbox-open-timeout-provider-${crypto.randomUUID()}`;
  const clientName = `mailbox-open-timeout-client-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-open-timeout-provider-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-open-timeout-client-${crypto.randomUUID()}`;
  const port = randomPort();
  const providerUrl = `http://127.0.0.1:${port}`;
  const provider = await seedHostedController(
    providerName,
    providerHeadDirPath,
    "mbx",
    providerUrl,
  );
  await seedLocalController(clientName, clientHeadDirPath, "bob");

  let postCount = 0;
  const host = startStaticOobiHost(port, async (request, url) => {
    if (url.pathname === `/oobi/${provider.pre}/controller`) {
      return controllerOobiResponse(provider.pre, provider.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      await delayForRequest(60, request.signal);
      if (request.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      return new Response("retry: 5000\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response("Not Found", { status: 404 });
  });

  try {
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      provider.pre,
      providerUrl,
    );

    await run(function*() {
      const hby = yield* createHabery({
        name: clientName,
        headDirPath: clientHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });

      try {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          {
            timeouts: {
              requestOpenTimeoutMs: 20,
              maxPollDurationMs: 120,
              commandLocalBudgetMs: 40,
            },
          },
        );
        poller.registerTopic("/challenge");

        const received: Uint8Array[] = [];
        const started = Date.now();
        const batches = yield* poller.processOnce();
        received.push(...batches.flatMap((batch) => batch.messages));
        const elapsed = Date.now() - started;

        assertEquals(received.length, 0);
        assertEquals(postCount, 1);
        assertEquals(elapsed >= 15 && elapsed < 80, true);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

/**
 * Proves SSE reads can legitimately outlive the request-open timeout.
 *
 * Once headers arrive, the client should keep reading for the longer
 * mailbox poll duration and persist the consumed mailbox cursor.
 */
Deno.test("MailboxPoller.processOnce allows SSE reads to outlive the request-open timeout", async () => {
  const providerName = `mailbox-read-duration-provider-${crypto.randomUUID()}`;
  const clientName = `mailbox-read-duration-client-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-read-duration-provider-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-read-duration-client-${crypto.randomUUID()}`;
  const port = randomPort();
  const providerUrl = `http://127.0.0.1:${port}`;
  const provider = await seedHostedController(
    providerName,
    providerHeadDirPath,
    "mbx",
    providerUrl,
  );
  const clientPre = await seedLocalController(
    clientName,
    clientHeadDirPath,
    "bob",
  );

  let postCount = 0;
  const host = startStaticOobiHost(port, (request, url) => {
    if (url.pathname === `/oobi/${provider.pre}/controller`) {
      return controllerOobiResponse(provider.pre, provider.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      const encoder = new TextEncoder();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clearTimer = () => {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
      };
      request.signal.addEventListener("abort", clearTimer, { once: true });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode("retry: 5000\n\n"));
            timer = setTimeout(() => {
              request.signal.removeEventListener("abort", clearTimer);
              controller.enqueue(
                encoder.encode(
                  "id: 0\nevent: /challenge\ndata: mailbox-message\n\n",
                ),
              );
              timer = undefined;
            }, 40);
          },
          cancel() {
            request.signal.removeEventListener("abort", clearTimer);
            clearTimer();
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "text/event-stream" },
        },
      );
    }
    return new Response("Not Found", { status: 404 });
  });

  try {
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      provider.pre,
      providerUrl,
    );

    await run(function*() {
      const hby = yield* createHabery({
        name: clientName,
        headDirPath: clientHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });

      try {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          {
            timeouts: {
              requestOpenTimeoutMs: 20,
              maxPollDurationMs: 100,
              commandLocalBudgetMs: 150,
            },
          },
        );
        poller.registerTopic("/challenge");

        const received: Uint8Array[] = [];
        const started = Date.now();
        const batches = yield* poller.processOnce({ budgetMs: 150 });
        received.push(...batches.flatMap((batch) => batch.messages));
        const elapsed = Date.now() - started;

        assertEquals(received.length, 1);
        assertEquals(new TextDecoder().decode(received[0]), "mailbox-message");
        assertEquals(postCount, 1);
        assertEquals(elapsed >= 80 && elapsed < 180, true);
        assertEquals(
          hby.db.tops.get([clientPre, provider.pre])?.topics["/challenge"],
          0,
        );
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host.close();
  }
});

/**
 * Proves bounded command-local polling stays sequential and budgeted.
 *
 * The first slow endpoint may consume the whole bounded budget, in which case
 * `processOnce()` must stop without serializing on later endpoints.
 */
Deno.test("MailboxPoller.processOnce stops after the bounded command-local budget is exhausted", async () => {
  const clientName = `mailbox-budget-client-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-budget-client-${crypto.randomUUID()}`;
  await seedLocalController(clientName, clientHeadDirPath, "bob");

  const provider1 = {
    name: `mailbox-budget-provider-a-${crypto.randomUUID()}`,
    headDirPath: `/tmp/tufa-mailbox-budget-provider-a-${crypto.randomUUID()}`,
    port: randomPort(),
  };
  const provider2 = {
    name: `mailbox-budget-provider-b-${crypto.randomUUID()}`,
    headDirPath: `/tmp/tufa-mailbox-budget-provider-b-${crypto.randomUUID()}`,
    port: randomPort(),
  };
  const seeded1 = await seedHostedController(
    provider1.name,
    provider1.headDirPath,
    "mbx",
    `http://127.0.0.1:${provider1.port}`,
  );
  const seeded2 = await seedHostedController(
    provider2.name,
    provider2.headDirPath,
    "mbx",
    `http://127.0.0.1:${provider2.port}`,
  );

  let postCount = 0;
  const host1 = startStaticOobiHost(provider1.port, async (request, url) => {
    if (url.pathname === `/oobi/${seeded1.pre}/controller`) {
      return controllerOobiResponse(seeded1.pre, seeded1.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      await delayForRequest(60, request.signal);
      if (request.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      return new Response("retry: 5000\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response("Not Found", { status: 404 });
  });
  const host2 = startStaticOobiHost(provider2.port, async (request, url) => {
    if (url.pathname === `/oobi/${seeded2.pre}/controller`) {
      return controllerOobiResponse(seeded2.pre, seeded2.controllerBytes);
    }
    if (request.method === "POST" && url.pathname === "/") {
      postCount += 1;
      await delayForRequest(60, request.signal);
      if (request.signal.aborted) {
        return new Response(null, { status: 499 });
      }
      return new Response("retry: 5000\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    }
    return new Response("Not Found", { status: 404 });
  });

  try {
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      seeded1.pre,
      `http://127.0.0.1:${provider1.port}`,
    );
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      seeded2.pre,
      `http://127.0.0.1:${provider2.port}`,
    );

    await run(function*() {
      const hby = yield* createHabery({
        name: clientName,
        headDirPath: clientHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });

      try {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          {
            timeouts: {
              requestOpenTimeoutMs: 50,
              maxPollDurationMs: 200,
              commandLocalBudgetMs: 50,
            },
          },
        );
        poller.registerTopic("/challenge");
        yield* poller.processOnce();

        assertEquals(postCount, 1);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host1.close();
    await host2.close();
  }
});

/**
 * Proves long-lived mailbox polling now keeps one remote worker per endpoint.
 *
 * This is the TS-native equivalent of KERIpy's concurrent `Poller` doers: two
 * remote endpoints should both receive their initial `mbx` request promptly,
 * rather than being serialized behind one long poll.
 */
Deno.test("MailboxPoller.pollDo starts one concurrent long-lived worker per remote endpoint", async () => {
  const clientName = `mailbox-concurrency-client-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-concurrency-client-${crypto.randomUUID()}`;
  await seedLocalController(clientName, clientHeadDirPath, "bob");

  const provider1 = {
    name: `mailbox-concurrency-provider-a-${crypto.randomUUID()}`,
    headDirPath: `/tmp/tufa-mailbox-concurrency-provider-a-${crypto.randomUUID()}`,
    port: randomPort(),
  };
  const provider2 = {
    name: `mailbox-concurrency-provider-b-${crypto.randomUUID()}`,
    headDirPath: `/tmp/tufa-mailbox-concurrency-provider-b-${crypto.randomUUID()}`,
    port: randomPort(),
  };
  const seeded1 = await seedHostedController(
    provider1.name,
    provider1.headDirPath,
    "mbx",
    `http://127.0.0.1:${provider1.port}`,
  );
  const seeded2 = await seedHostedController(
    provider2.name,
    provider2.headDirPath,
    "mbx",
    `http://127.0.0.1:${provider2.port}`,
  );

  let postCount = 0;
  const makeLongPollHost = (
    port: number,
    seeded: { pre: string; controllerBytes: Uint8Array },
  ) =>
    startStaticOobiHost(port, (request, url) => {
      if (url.pathname === `/oobi/${seeded.pre}/controller`) {
        return controllerOobiResponse(seeded.pre, seeded.controllerBytes);
      }
      if (request.method === "POST" && url.pathname === "/") {
        postCount += 1;
        const encoder = new TextEncoder();
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(encoder.encode("retry: 5000\n\n"));
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "text/event-stream" },
          },
        );
      }
      return new Response("Not Found", { status: 404 });
    });

  const host1 = makeLongPollHost(provider1.port, seeded1);
  const host2 = makeLongPollHost(provider2.port, seeded2);

  try {
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      seeded1.pre,
      `http://127.0.0.1:${provider1.port}`,
    );
    await authorizeMailboxPollTarget(
      clientName,
      clientHeadDirPath,
      "bob",
      seeded2.pre,
      `http://127.0.0.1:${provider2.port}`,
    );

    await run(function*() {
      const hby = yield* createHabery({
        name: clientName,
        headDirPath: clientHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });

      try {
        const poller = new MailboxPoller(
          hby,
          new MailboxDirector(hby),
          {
            timeouts: {
              requestOpenTimeoutMs: 20,
              maxPollDurationMs: 80,
              commandLocalBudgetMs: 20,
            },
          },
        );
        poller.registerTopic("/challenge");

        const task = yield* spawn(function*() {
          yield* poller.pollDo((_batch) => {});
        });

        try {
          yield* waitForCondition(() => postCount >= 2, {
            timeoutMs: 120,
            retryDelayMs: 5,
            message: "Expected two concurrent mailbox poll requests.",
          });
        } finally {
          yield* waitForTaskHalt(task);
        }
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await host1.close();
    await host2.close();
  }
});

/**
 * Proves the shared mailbox-turn helper owns local mailbox batch settlement.
 *
 * The helper should preserve batch boundaries, return the consumed batches,
 * and settle each batch far enough for challenge-response visibility.
 */
Deno.test("processMailboxTurn settles local mailbox batches and returns them", async () => {
  const clientName = `mailbox-turn-client-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-turn-client-${crypto.randomUUID()}`;
  const wordsA = ["able", "baker"];
  const wordsB = ["charlie", "delta"];

  await run(function*() {
    const hby = yield* createHabery({
      name: clientName,
      headDirPath: clientHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });

    try {
      const alice = hby.makeHab("alice", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const bob = hby.makeHab("bob", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const senderA = hby.makeHab("sender-a", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const senderB = hby.makeHab("sender-b", undefined, {
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
      });
      const runtime = yield* createAgentRuntime(hby, {
        mode: "local",
        enableMailboxStore: true,
      });
      const mailboxer = runtime.mailboxer;
      if (!mailboxer) {
        throw new Error("Expected local mailboxer for mailbox turn test.");
      }

      runtime.mailboxDirector.topics.clear();
      runtime.mailboxDirector.registerTopic("/challenge");

      const first = {
        senderPre: senderA.pre,
        message: senderA.endorse(
          makeExchangeSerder("/challenge/response", {
            i: senderA.pre,
            words: [...wordsA],
          }, {
            sender: senderA.pre,
            recipient: alice.pre,
          }),
        ),
      };
      const second = {
        senderPre: senderB.pre,
        message: senderB.endorse(
          makeExchangeSerder("/challenge/response", {
            i: senderB.pre,
            words: [...wordsB],
          }, {
            sender: senderB.pre,
            recipient: bob.pre,
          }),
        ),
      };

      mailboxer.storeMsg(
        mailboxTopicKey(alice.pre, "/challenge"),
        first.message,
      );
      mailboxer.storeMsg(
        mailboxTopicKey(bob.pre, "/challenge"),
        second.message,
      );

      const batches = yield* processMailboxTurn(runtime);

      assertEquals(
        batches.map((batch) => ({ source: batch.source, pre: batch.pre })),
        [
          { source: "local", pre: alice.pre },
          { source: "local", pre: bob.pre },
        ],
      );
      assertExists(findVerifiedChallengeResponse(hby.db, first.senderPre, wordsA));
      assertExists(findVerifiedChallengeResponse(hby.db, second.senderPre, wordsB));
    } finally {
      yield* hby.close();
    }
  });
});

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

Deno.test("mailbox admin accepts raw CESR and multipart requests and applies add/cut state", async () => {
  const providerName = `mailbox-admin-provider-${crypto.randomUUID()}`;
  const controllerName = `mailbox-admin-controller-${crypto.randomUUID()}`;
  const delegatedName = `mailbox-admin-delegated-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-admin-provider-${crypto.randomUUID()}`;
  const controllerHeadDirPath = `/tmp/tufa-mailbox-admin-controller-${crypto.randomUUID()}`;
  const delegatedHeadDirPath = `/tmp/tufa-mailbox-admin-delegated-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}`;

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
    const delegatedHby = yield* createHabery({
      name: delegatedName,
      headDirPath: delegatedHeadDirPath,
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
    const delegator = delegatedHby.makeHab("delegator", undefined, {
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
    });
    const delegated = delegatedHby.makeHab("delegate", undefined, {
      transferable: true,
      icount: 1,
      isith: "1",
      ncount: 1,
      nsith: "1",
      toad: 0,
      delpre: delegator.pre,
    });
    anchorDelegatedHab(delegatedHby, delegator, delegated);

    const runtime = yield* createAgentRuntime(providerHby, { mode: "indirect" });
    const hab = providerHby.habByName("relay");
    ingestKeriBytes(runtime, mailbox.makeLocScheme(url, mailbox.pre, "http"));
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
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      const add = concatBytes(
        collectReplay(controllerHby, controller.pre),
        controller.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
      );
      let response = yield* postMailboxAdmin(`${url}/mailboxes`, add);
      yield* assertResponseStatus(response, 200);
      assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
        cid: controller.pre,
        role: EndpointRoles.mailbox,
        eid: mailbox.pre,
        allowed: true,
      });
      assertEquals(
        providerHby.db.ends.get([controller.pre, EndpointRoles.mailbox, mailbox.pre])
          ?.allowed,
        true,
      );

      const cut = concatBytes(
        collectReplay(controllerHby, controller.pre),
        controller.makeEndRole(mailbox.pre, EndpointRoles.mailbox, false),
      );
      response = yield* postMailboxAdmin(`${url}/mailboxes`, cut);
      yield* assertResponseStatus(response, 200);
      assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
        cid: controller.pre,
        role: EndpointRoles.mailbox,
        eid: mailbox.pre,
        allowed: false,
      });
      assertEquals(
        providerHby.db.ends.get([controller.pre, EndpointRoles.mailbox, mailbox.pre])
          ?.allowed,
        false,
      );

      const delegatedAdd = concatBytes(
        collectReplay(delegatedHby, delegated.pre),
        delegated.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
      );
      response = yield* postMailboxAdmin(`${url}/mailboxes`, delegatedAdd);
      yield* assertResponseStatus(response, 200);
      assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
        cid: delegated.pre,
        role: EndpointRoles.mailbox,
        eid: mailbox.pre,
        allowed: true,
      });
      assertEquals(
        providerHby.db.ends.get([delegated.pre, EndpointRoles.mailbox, mailbox.pre])
          ?.allowed,
        true,
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        ["kel", new TextDecoder().decode(collectReplay(controllerHby, controller.pre))],
        [
          "rpy",
          new TextDecoder().decode(
            controller.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
          ),
        ],
      ]);
      yield* assertResponseStatus(response, 200);
      assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
        cid: controller.pre,
        role: EndpointRoles.mailbox,
        eid: mailbox.pre,
        allowed: true,
      });

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        ["kel", new TextDecoder().decode(collectReplay(controllerHby, controller.pre))],
        [
          "rpy",
          new TextDecoder().decode(
            controller.makeEndRole(mailbox.pre, EndpointRoles.mailbox, false),
          ),
        ],
      ]);
      yield* assertResponseStatus(response, 200);
      assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
        cid: controller.pre,
        role: EndpointRoles.mailbox,
        eid: mailbox.pre,
        allowed: false,
      });

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        [
          "kel",
          new TextDecoder().decode(
            concatBytes(...delegatedHby.db.clonePreIter(delegated.pre)),
          ),
        ],
        [
          "delkel",
          new TextDecoder().decode(
            concatBytes(...delegatedHby.db.cloneDelegation(delegated.kever!)),
          ),
        ],
        [
          "rpy",
          new TextDecoder().decode(
            delegated.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
          ),
        ],
      ]);
      yield* assertResponseStatus(response, 200);
      assertEquals(yield* jsonOp<Record<string, unknown>>(response), {
        cid: delegated.pre,
        role: EndpointRoles.mailbox,
        eid: mailbox.pre,
        allowed: true,
      });
      assertEquals(
        providerHby.db.ends.get([delegated.pre, EndpointRoles.mailbox, mailbox.pre])
          ?.allowed,
        true,
      );
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* delegatedHby.close();
      yield* controllerHby.close();
      yield* providerHby.close();
    }
  });
});

Deno.test("mailbox admin rejects unsupported content types and invalid raw or multipart replies", async () => {
  const providerName = `mailbox-admin-invalid-provider-${crypto.randomUUID()}`;
  const controllerName = `mailbox-admin-invalid-controller-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-admin-invalid-provider-${crypto.randomUUID()}`;
  const controllerHeadDirPath = `/tmp/tufa-mailbox-admin-invalid-controller-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}`;

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
    const otherMailbox = providerHby.makeHab("other", undefined, {
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

    const runtime = yield* createAgentRuntime(providerHby, { mode: "indirect" });
    const hab = providerHby.habByName("relay");
    ingestKeriBytes(runtime, mailbox.makeLocScheme(url, mailbox.pre, "http"));
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
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      let response = yield* postMailboxAdmin(
        `${url}/mailboxes`,
        collectReplay(controllerHby, controller.pre),
        "text/plain",
      );
      assertEquals(response.status, 406);
      assertEquals(yield* textOp(response), "Unacceptable content type.");

      response = yield* postMailboxAdmin(
        `${url}/mailboxes`,
        collectReplay(controllerHby, controller.pre),
      );
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization stream must end in rpy",
      );

      response = yield* postMailboxAdmin(
        `${url}/mailboxes`,
        concatBytes(
          collectReplay(controllerHby, controller.pre),
          controller.makeLocScheme(url, mailbox.pre, "http"),
        ),
      );
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Unsupported mailbox authorization route",
      );

      response = yield* postMailboxAdmin(
        `${url}/mailboxes`,
        concatBytes(
          collectReplay(controllerHby, controller.pre),
          controller.makeEndRole(mailbox.pre, "watcher", true),
        ),
      );
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization reply must use role=mailbox",
      );

      response = yield* postMailboxAdmin(
        `${url}/mailboxes`,
        concatBytes(
          collectReplay(controllerHby, controller.pre),
          controller.makeEndRole(otherMailbox.pre, EndpointRoles.mailbox, true),
        ),
      );
      assertEquals(response.status, 403);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization target does not match hosted mailbox",
      );

      response = yield* postMailboxAdmin(
        `${url}/mailboxes`,
        controller.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
      );
      assertEquals(response.status, 403);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization reply was not accepted",
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [[
        "rpy",
        new TextDecoder().decode(
          controller.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true),
        ),
      ]]);
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization request is missing kel",
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [[
        "kel",
        new TextDecoder().decode(collectReplay(controllerHby, controller.pre)),
      ]]);
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization request is missing rpy",
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        ["kel", new TextDecoder().decode(collectReplay(controllerHby, controller.pre))],
        [
          "rpy",
          new TextDecoder().decode(
            controller.makeLocScheme(url, mailbox.pre, "http"),
          ),
        ],
      ]);
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Unsupported mailbox authorization route",
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        ["kel", new TextDecoder().decode(collectReplay(controllerHby, controller.pre))],
        [
          "rpy",
          new TextDecoder().decode(
            controller.makeEndRole(mailbox.pre, "watcher", true),
          ),
        ],
      ]);
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization reply must use role=mailbox",
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        ["kel", new TextDecoder().decode(collectReplay(controllerHby, controller.pre))],
        [
          "rpy",
          new TextDecoder().decode(
            controller.makeEndRole(otherMailbox.pre, EndpointRoles.mailbox, true),
          ),
        ],
      ]);
      assertEquals(response.status, 403);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization target does not match hosted mailbox",
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        ["kel", new TextDecoder().decode(collectReplay(controllerHby, controller.pre))],
        ["rpy", "not cesr"],
      ]);
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization reply field must contain exactly one CESR message",
      );
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* controllerHby.close();
      yield* providerHby.close();
    }
  });
});

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

    const runtime = yield* createAgentRuntime(providerHby, { mode: "indirect" });
    const hab = providerHby.habByName("relay");
    ingestKeriBytes(runtime, mailbox.makeLocScheme(advertisedUrl, mailbox.pre, "http"));
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

      const kel = new TextDecoder().decode(collectReplay(controllerHby, controller.pre));
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

      const kel = new TextDecoder().decode(collectReplay(controllerHby, controller.pre));
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

/**
 * Proves the full local mailbox operator workflow against a live remote mailbox
 * host:
 * - resolve mailbox OOBI
 * - add mailbox
 * - list and debug mailbox state
 * - update topic cursor state
 * - remove mailbox
 */
Deno.test("mailbox CLI add/remove/list/update/debug round-trips against remote mailbox host", async () => {
  const providerName = `mailbox-provider-${crypto.randomUUID()}`;
  const clientName = `mailbox-client-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-provider-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-client-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}`;
  const providerPre = await seedMailboxHost(
    providerName,
    providerHeadDirPath,
    "mbx",
    url,
  );
  const clientPre = await seedLocalController(
    clientName,
    clientHeadDirPath,
    "alice",
  );

  await run(function*() {
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
    });
    const hab = providerHby.habByName("mbx");
    const runtime = yield* createAgentRuntime(providerHby, {
      mode: "indirect",
    });
    const mailboxer = runtime.mailboxer;
    if (!mailboxer) {
      throw new Error("Expected provider runtime mailboxer.");
    }
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      const resolved = yield* testCLICommand(
        oobiResolveCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          url: `${url}/oobi/${providerPre}/mailbox/${providerPre}`,
          oobiAlias: "mbx",
        }),
      );
      assertEquals(
        resolved.output.at(-1),
        `${url}/oobi/${providerPre}/mailbox/${providerPre}`,
      );

      const added = yield* testCLICommand(
        mailboxAddCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          mailbox: "mbx",
        }),
      );
      assertEquals(added.output.at(-1), `added ${providerPre}`);

      mailboxer.storeMsg(
        mailboxTopicKey(clientPre, "/challenge"),
        new TextEncoder().encode("challenge-msg"),
      );

      const listed = yield* testCLICommand(
        mailboxListCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
        }),
      );
      assertStringIncludes(listed.output.join("\n"), providerPre);

      const updated = yield* testCLICommand(
        mailboxUpdateCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          witness: providerPre,
          topic: "/challenge",
          index: 5,
        }),
      );
      assertEquals(updated.output.at(-1), `${providerPre} /challenge 5`);

      const debugged = yield* testCLICommand(
        mailboxDebugCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          witness: providerPre,
        }),
      );
      assertStringIncludes(debugged.output.join("\n"), "Configured Mailboxes");
      assertStringIncludes(debugged.output.join("\n"), "/challenge");

      const removed = yield* testCLICommand(
        mailboxRemoveCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          mailbox: providerPre,
        }),
      );
      assertEquals(removed.output.at(-1), `removed ${providerPre}`);
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* providerHby.close();
    }
  });

  await run(function*() {
    const clientHby = yield* createHabery({
      name: clientName,
      headDirPath: clientHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
      skipSignator: true,
    });

    try {
      assertEquals(
        clientHby.db.ends.get([clientPre, EndpointRoles.mailbox, providerPre])
          ?.allowed,
        false,
      );
      assertEquals(
        providerHby.db.ends.get([clientPre, EndpointRoles.mailbox, providerPre])
          ?.allowed,
        false,
      );
      assertEquals(
        clientHby.db.tops.get([clientPre, providerPre])?.topics["/challenge"],
        5,
      );
    } finally {
      yield* providerHby.close();
      yield* clientHby.close();
    }
  });
});

/**
 * Proves that `challenge verify` is mailbox-driven, not just local DB polling,
 * and that provider routes work through canonical root mailbox/OOBI endpoints.
 */
Deno.test("challenge verify polls a remote mailbox provider through root mailbox OOBI and mailbox admin routes", async () => {
  const providerName = `mailbox-base-provider-${crypto.randomUUID()}`;
  const bobName = `mailbox-base-bob-${crypto.randomUUID()}`;
  const aliceName = `mailbox-base-alice-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-base-provider-${crypto.randomUUID()}`;
  const bobHeadDirPath = `/tmp/tufa-mailbox-base-bob-${crypto.randomUUID()}`;
  const aliceHeadDirPath = `/tmp/tufa-mailbox-base-alice-${crypto.randomUUID()}`;
  const port = randomPort();
  const alicePort = randomPort();
  const providerUrl = `http://127.0.0.1:${port}`;
  const aliceUrl = `http://127.0.0.1:${alicePort}`;
  const words = ["able", "baker", "charlie"];
  const providerPre = await seedMailboxHost(
    providerName,
    providerHeadDirPath,
    "mbx",
    providerUrl,
  );
  const bobPre = await seedLocalController(
    bobName,
    bobHeadDirPath,
    "bob",
  );
  const alice = await seedHostedController(
    aliceName,
    aliceHeadDirPath,
    "alice",
    aliceUrl,
  );
  const aliceHost = startStaticOobiHost(alicePort, (_request, url) => {
    if (url.pathname === `/oobi/${alice.pre}/controller`) {
      return new Response(new Uint8Array(alice.controllerBytes).buffer, {
        status: 200,
        headers: { "Content-Type": "application/cesr", "Oobi-Aid": alice.pre },
      });
    }
    return new Response("Not Found", { status: 404 });
  });

  try {
    await run(function*() {
      const providerHby = yield* createHabery({
        name: providerName,
        headDirPath: providerHeadDirPath,
        skipConfig: true,
      });
      const hab = providerHby.habByName("mbx");
      const runtime = yield* createAgentRuntime(providerHby, {
        mode: "indirect",
      });
      const mailboxer = runtime.mailboxer;
      if (!mailboxer) {
        throw new Error("Expected provider runtime mailboxer.");
      }
      const runtimeTask = yield* spawn(function*() {
        yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
      });
      const serverTask = yield* spawn(function*() {
        yield* startServer(port, undefined, runtime);
      });

      try {
        yield* waitForServer(port);
        yield* waitForServer(alicePort);

        const providerResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            url: `${providerUrl}/oobi/${providerPre}/controller`,
            oobiAlias: "mbx",
          }),
        );
        assertEquals(
          providerResolved.output.at(-1),
          `${providerUrl}/oobi/${providerPre}/controller`,
        );

        const aliceResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            url: `${aliceUrl}/oobi/${alice.pre}/controller`,
            oobiAlias: "alice",
          }),
        );
        assertEquals(
          aliceResolved.output.at(-1),
          `${aliceUrl}/oobi/${alice.pre}/controller`,
        );

        const added = yield* testCLICommand(
          mailboxAddCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            alias: "bob",
            mailbox: providerPre,
          }),
        );
        assertEquals(added.output.at(-1), `added ${providerPre}`);

        const mailboxOobi = yield* testCLICommand(
          oobiGenerateCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            alias: "bob",
            role: "mailbox",
          }),
        );
        assertEquals(
          mailboxOobi.output.at(-1),
          `${providerUrl}/oobi/${bobPre}/mailbox/${providerPre}`,
        );

        const bobResolved = yield* testCLICommand(
          oobiResolveCommand({
            name: aliceName,
            headDirPath: aliceHeadDirPath,
            url: `${providerUrl}/oobi/${bobPre}/mailbox/${providerPre}`,
            oobiAlias: "bob",
          }),
        );
        assertEquals(
          bobResolved.output.at(-1),
          `${providerUrl}/oobi/${bobPre}/mailbox/${providerPre}`,
        );

        const responded = yield* testCLICommand(
          challengeRespondCommand({
            name: aliceName,
            headDirPath: aliceHeadDirPath,
            alias: "alice",
            recipient: bobPre,
            words: JSON.stringify(words),
            transport: "indirect",
          }),
        );
        assertEquals(responded.output[0], "Sent EXN message");
        assertEquals(
          mailboxer.getTopicMsgs(mailboxTopicKey(bobPre, "/challenge"))
            .length > 0,
          true,
        );

        const verified = yield* testCLICommand(
          challengeVerifyCommand({
            name: bobName,
            headDirPath: bobHeadDirPath,
            signer: alice.pre,
            words: JSON.stringify(words),
            timeout: 5,
          }),
        );
        assertStringIncludes(verified.output.at(-1) ?? "", alice.pre);
      } finally {
        yield* waitForTaskHalt(serverTask);
        yield* waitForTaskHalt(runtimeTask);
        yield* runtime.close();
        yield* providerHby.close();
      }
    });

    await run(function*() {
      const bobHby = yield* createHabery({
        name: bobName,
        headDirPath: bobHeadDirPath,
        skipConfig: true,
        skipSignator: true,
      });
      try {
        assertEquals(bobHby.db.reps.get([alice.pre]).length > 0, true);
        assertEquals(bobHby.db.chas.get([alice.pre]).length > 0, true);
        assertEquals(
          bobHby.db.ends.get([bobPre, EndpointRoles.mailbox, providerPre])
            ?.allowed,
          true,
        );
      } finally {
        yield* bobHby.close();
      }
    });
  } finally {
    await aliceHost.close();
  }
});

/**
 * Proves the inbound mailbox authorization boundary on `/fwd`.
 *
 * A mailbox host must not store forwarded traffic until the recipient has
 * authorized that mailbox provider.
 */
Deno.test("mailbox host only stores forwarded payloads after mailbox authorization", async () => {
  const providerName = `mailbox-auth-provider-${crypto.randomUUID()}`;
  const senderName = `mailbox-auth-sender-${crypto.randomUUID()}`;
  const clientName = `mailbox-auth-client-${crypto.randomUUID()}`;
  const providerHeadDirPath = `/tmp/tufa-mailbox-auth-provider-${crypto.randomUUID()}`;
  const senderHeadDirPath = `/tmp/tufa-mailbox-auth-sender-${crypto.randomUUID()}`;
  const clientHeadDirPath = `/tmp/tufa-mailbox-auth-client-${crypto.randomUUID()}`;
  const port = randomPort();
  const url = `http://127.0.0.1:${port}`;
  const providerPre = await seedMailboxHost(
    providerName,
    providerHeadDirPath,
    "mbx",
    url,
  );
  const recipientPre = await seedLocalController(
    clientName,
    clientHeadDirPath,
    "alice",
  );

  await run(function*() {
    const providerHby = yield* createHabery({
      name: providerName,
      headDirPath: providerHeadDirPath,
      skipConfig: true,
    });
    const hab = providerHby.habByName("mbx");
    const runtime = yield* createAgentRuntime(providerHby, {
      mode: "indirect",
    });
    const mailboxer = runtime.mailboxer;
    if (!mailboxer) {
      throw new Error("Expected provider runtime mailboxer.");
    }
    const runtimeTask = yield* spawn(function*() {
      yield* runAgentRuntime(runtime, { hab: hab ?? undefined });
    });
    const serverTask = yield* spawn(function*() {
      yield* startServer(port, undefined, runtime);
    });

    try {
      yield* waitForServer(port);

      const unauthorized = yield* buildForwardMessage(
        senderName,
        senderHeadDirPath,
        recipientPre,
      );
      const first = yield* postForward(url, unauthorized);
      assertEquals(first, 204);
      assertEquals(
        mailboxer.getTopicMsgs(
          mailboxTopicKey(recipientPre, "/challenge"),
        ).length,
        0,
      );

      const resolved = yield* testCLICommand(
        oobiResolveCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          url: `${url}/oobi/${providerPre}/mailbox/${providerPre}`,
          oobiAlias: "mbx",
        }),
      );
      assertEquals(
        resolved.output.at(-1),
        `${url}/oobi/${providerPre}/mailbox/${providerPre}`,
      );

      const added = yield* testCLICommand(
        mailboxAddCommand({
          name: clientName,
          headDirPath: clientHeadDirPath,
          alias: "alice",
          mailbox: providerPre,
        }),
      );
      assertEquals(added.output.at(-1), `added ${providerPre}`);

      const authorized = yield* buildForwardMessage(
        senderName,
        senderHeadDirPath,
        recipientPre,
      );
      const second = yield* postForward(url, authorized);
      assertEquals(second, 204);
      assertEquals(
        mailboxer.getTopicMsgs(
          mailboxTopicKey(recipientPre, "/challenge"),
        ).length,
        1,
      );
    } finally {
      yield* waitForTaskHalt(serverTask);
      yield* waitForTaskHalt(runtimeTask);
      yield* runtime.close();
      yield* providerHby.close();
    }
  });
});
