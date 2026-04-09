// @file-test-lane runtime-slow

import { action, type Operation, run, spawn } from "effection";
import { assertEquals, assertExists, assertStringIncludes } from "jsr:@std/assert";
import { concatBytes, Diger, SealSource, SerderKERI, Siger } from "../../../../cesr/mod.ts";
import {
  mailboxAddCommand,
  mailboxDebugCommand,
  mailboxListCommand,
  mailboxRemoveCommand,
  mailboxUpdateCommand,
} from "../../../../tufa/src/cli/mailbox.ts";
import { startServer } from "../../../../tufa/src/host/http-server.ts";
import {
  createAgentRuntime,
  ingestKeriBytes,
  processRuntimeTurn,
  runAgentRuntime,
} from "../../../src/app/agent-runtime.ts";
import { challengeRespondCommand, challengeVerifyCommand } from "../../../src/app/cli/challenge.ts";
import { oobiGenerateCommand, oobiResolveCommand } from "../../../src/app/cli/oobi.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { mailboxTopicKey } from "../../../src/app/mailboxing.ts";
import { Kevery } from "../../../src/core/eventing.ts";
import { makeEmbeddedExchangeMessage, makeExchangeSerder } from "../../../src/core/messages.ts";
import { EndpointRoles } from "../../../src/core/roles.ts";
import { dgKey } from "../../../src/db/core/keys.ts";
import { fetchOp, textOp, waitForServer, waitForTaskHalt } from "../../effection-http.ts";
import { controllerOobiResponse, reserveTcpPort, startStaticHttpHost } from "../../http-test-support.ts";
import { testCLICommand } from "../../utils.ts";
import { seedHostedController, seedLocalController } from "./mailbox-runtime-support.ts";

const textDecoder = new TextDecoder();

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

  await run(function*(): Operation<void> {
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
    body: textDecoder.decode(body),
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
  const port = reserveTcpPort();
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

    const runtime = yield* createAgentRuntime(providerHby, {
      mode: "indirect",
    });
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
        providerHby.db.ends.get([
          controller.pre,
          EndpointRoles.mailbox,
          mailbox.pre,
        ])
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
        providerHby.db.ends.get([
          controller.pre,
          EndpointRoles.mailbox,
          mailbox.pre,
        ])
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
        providerHby.db.ends.get([
          delegated.pre,
          EndpointRoles.mailbox,
          mailbox.pre,
        ])
          ?.allowed,
        true,
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        [
          "kel",
          textDecoder.decode(collectReplay(controllerHby, controller.pre)),
        ],
        [
          "rpy",
          textDecoder.decode(
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
        [
          "kel",
          textDecoder.decode(collectReplay(controllerHby, controller.pre)),
        ],
        [
          "rpy",
          textDecoder.decode(
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
          textDecoder.decode(
            concatBytes(...delegatedHby.db.clonePreIter(delegated.pre)),
          ),
        ],
        [
          "delkel",
          textDecoder.decode(
            concatBytes(...delegatedHby.db.cloneDelegation(delegated.kever!)),
          ),
        ],
        [
          "rpy",
          textDecoder.decode(
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
        providerHby.db.ends.get([
          delegated.pre,
          EndpointRoles.mailbox,
          mailbox.pre,
        ])
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
  const port = reserveTcpPort();
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

    const runtime = yield* createAgentRuntime(providerHby, {
      mode: "indirect",
    });
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
        textDecoder.decode(
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
        textDecoder.decode(collectReplay(controllerHby, controller.pre)),
      ]]);
      assertEquals(response.status, 400);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization request is missing rpy",
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        [
          "kel",
          textDecoder.decode(collectReplay(controllerHby, controller.pre)),
        ],
        [
          "rpy",
          textDecoder.decode(
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
        [
          "kel",
          textDecoder.decode(collectReplay(controllerHby, controller.pre)),
        ],
        [
          "rpy",
          textDecoder.decode(
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
        [
          "kel",
          textDecoder.decode(collectReplay(controllerHby, controller.pre)),
        ],
        [
          "rpy",
          textDecoder.decode(
            controller.makeEndRole(
              otherMailbox.pre,
              EndpointRoles.mailbox,
              true,
            ),
          ),
        ],
      ]);
      assertEquals(response.status, 403);
      assertEquals(
        yield* textOp(response),
        "Mailbox authorization target does not match hosted mailbox",
      );

      response = yield* postMailboxAdminMultipart(`${url}/mailboxes`, [
        [
          "kel",
          textDecoder.decode(collectReplay(controllerHby, controller.pre)),
        ],
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
  const port = reserveTcpPort();
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
  const providerPort = reserveTcpPort();
  const providerUrl = `http://127.0.0.1:${providerPort}`;
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
  let alice:
    | Awaited<ReturnType<typeof seedHostedController>>
    | undefined;
  const aliceHost = startStaticHttpHost((_request, url) => {
    if (alice && url.pathname === `/oobi/${alice.pre}/controller`) {
      return controllerOobiResponse(alice.pre, alice.controllerBytes);
    }
    return new Response("Not Found", { status: 404 });
  });
  alice = await seedHostedController(
    aliceName,
    aliceHeadDirPath,
    "alice",
    aliceHost.origin,
  );

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
        yield* startServer(providerPort, undefined, runtime);
      });

      try {
        yield* waitForServer(providerPort);

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
            url: `${aliceHost.origin}/oobi/${alice.pre}/controller`,
            oobiAlias: "alice",
          }),
        );
        assertEquals(
          aliceResolved.output.at(-1),
          `${aliceHost.origin}/oobi/${alice.pre}/controller`,
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
            pollDelayMs: 25,
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
  const port = reserveTcpPort();
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
