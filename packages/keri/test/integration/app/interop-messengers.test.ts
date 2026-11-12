import { createProtocolHandler } from "@keri-ts/hosting";
import { collectPayload, concatBytes, Diger, essrChunks, framePayload, parseBytes, Texter, Vrsn_1_0 } from "cesr-ts";
import { call, run, sleep, spawn } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { decodeBase64, encodeBase64 } from "jsr:@std/encoding/base64";
import { acceptedEventReplayMessage, type Hab } from "../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../src/app/identity/lmdb-habery.ts";
import { createAgentRuntime, settleMailboxPollBatch } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { isNativeCesrFrame } from "../../../src/app/transport/cesr-egress.ts";
import { HTTPMessenger } from "../../../src/app/transport/http-messenger.ts";
import { HTTPStreamMessenger } from "../../../src/app/transport/http-stream-messenger.ts";
import { messengerFrom, streamMessengerFrom } from "../../../src/app/transport/messengering.ts";
import { NodeHttpClient } from "../../../src/app/transport/node-http-client.ts";
import { exchange } from "../../../src/core/exchange/protocol-exchanging.ts";
import { Roles } from "../../../src/core/roles.ts";
import { waitForTaskHalt } from "../../effection-http.ts";
import { createInteropContext, startKeriPyWitnessHarness } from "./interop-test-helpers.ts";

/** Observations from the real Python witness; control never accepts protocol bytes. */
interface Snapshot {
  states: Record<string, string[]>;
  traffic: {
    method: string;
    type: string;
    length: number;
    destination: string;
    attachment: string | null;
    authorization: string | null;
    status?: number;
  }[];
  exn: string | null;
  payload: string[];
}

/** Result of the fixture's `history` command: a foreign v2 key history the witness has never seen. */
interface KeyHistory {
  pre: string;
  saids: string[];
  wire: string;
}

Deno.test("messenger factories exchange ordered POSTs and whole PUTs through actual Python witness and Tufa intake", async () => {
  const ctx = await createInteropContext();
  try {
    const witnesses = await startKeriPyWitnessHarness(ctx, {
      aliases: ["wan"],
      messengerProbe: true,
      protocolVersion: 1,
    });
    try {
      const witness = witnesses.node("wan");
      /** Invoke the fixture's state observer or actual Python messenger, not a protocol substitute. */
      const control = async <T>(command: Record<string, unknown>): Promise<T> => {
        const response = await fetch(`${witness.httpOrigin}/_messenger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(20_000),
        });
        assertEquals(response.status, 200, await response.clone().text());
        return await response.json();
      };
      await run(function*() {
        const hby = yield* createHabery({ name: `messengers-${crypto.randomUUID()}`, temp: true, skipConfig: true });
        const http = new NodeHttpClient();
        const runtime = yield* createAgentRuntime(hby, http, systemClock);
        // These reference media profiles exercise v1 KEL evidence across every profile.
        const receiver = hby.makeHab("receiver", undefined, { version: Vrsn_1_0 });
        const handler = createProtocolHandler(runtime, { serviceHab: receiver });
        const received: {
          method: string;
          destination: string | null;
          attachment: string | null;
          authorization: string | null;
          body: Uint8Array;
        }[] = [];
        const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async req => {
          received.push({
            method: req.method,
            destination: req.headers.get("CESR-DESTINATION"),
            attachment: req.headers.get("CESR-ATTACHMENT"),
            authorization: req.headers.get("Authorization"),
            body: new Uint8Array(await req.clone().arrayBuffer()),
          });
          return await handler(req);
        });
        try {
          /** Two real locally accepted signed KEL events, in their actual replay order. */
          const kel = (hab: Hab): Uint8Array[] => {
            hab.interact();
            return [0, 1].map(sn => acceptedEventReplayMessage(hby, hab.pre, sn, Vrsn_1_0).message);
          };
          const ordinary = hby.makeHab("ordinary", undefined, { version: Vrsn_1_0 }),
            stream = hby.makeHab("stream", undefined, { version: Vrsn_1_0 });
          const ordinaryParts = kel(ordinary), streamParts = kel(stream);
          const raw = new Uint8Array([0, 255, 128, 1, 2, 3]);
          const [essr] = exchange("/essr/req", {}, {
            sender: stream.pre,
            diger: new Diger({ raw: Diger.digest(raw, "E"), code: "E" }),
          });
          const streamWire = concatBytes(
            ...streamParts,
            stream.endorse(essr, { pipelined: false, gvrsn: Vrsn_1_0 }),
            ...essrChunks([new Texter({ raw, code: "4B" })], { gvrsn: Vrsn_1_0 }),
          );
          const auth = { Authorization: "messenger-probe" };
          const ordinarySender = messengerFrom(witness.pre, { http: witness.httpOrigin }, http, systemClock, auth);
          assertInstanceOf(ordinarySender, HTTPMessenger);
          assertEquals((yield* ordinarySender.send(concatBytes(...ordinaryParts))).kind, "complete");
          const streamSender = streamMessengerFrom(
            witness.pre,
            { http: witness.httpOrigin },
            streamWire,
            http,
            systemClock,
            auth,
          );
          assertInstanceOf(streamSender, HTTPStreamMessenger);
          assertEquals((yield* streamSender.send()).status, 204);

          // At least the unmodified GLEIF 1.2.17 peer qualifies TCP intake. Main/1.3's Python-origin factory defect is separate.
          const tcp = ctx.env.KERIPY_INTEROP_PROFILE === "1.2"
            ? hby.makeHab("tcp", undefined, { wits: [witness.pre], toad: 1, version: Vrsn_1_0 })
            : undefined;
          const tcpParts = tcp ? kel(tcp) : [];
          if (tcp) {
            yield* streamMessengerFrom(
              witness.pre,
              { tcp: witness.tcpUrl },
              concatBytes(...tcpParts),
              http,
              systemClock,
            ).send();
          }
          yield* call(async () => {
            const prefixes = [ordinary.pre, stream.pre, ...(tcp ? [tcp.pre] : [])];
            let snapshot: Snapshot | undefined;
            const deadline = Date.now() + 20_000;
            do {
              snapshot = await control<Snapshot>({ action: "snapshot", prefixes, exn: essr.said });
              if (prefixes.every(pre => snapshot!.states[pre]?.length === 2) && snapshot.exn) break;
              await new Promise(resolve => setTimeout(resolve, 10));
            } while (Date.now() < deadline);
            for (
              const [hab, parts] of [
                [ordinary, ordinaryParts],
                [stream, streamParts],
                ...(tcp ? [[tcp, tcpParts] as const] : []),
              ] as const
            ) {
              assertEquals(
                snapshot!.states[hab.pre],
                parts.map(part => parseBytes(part)[0].body.said),
                `${hab.name}: ${JSON.stringify(snapshot!.states)}`,
              );
            }
            assertEquals(snapshot!.exn, essr.said);
            assertEquals(snapshot!.payload, [encodeBase64(raw)]);
            const posts = snapshot!.traffic.filter(t => t.method === "POST");
            const legacy = ctx.env.KERIPY_INTEROP_PROFILE === "1.2" || ctx.env.KERIPY_INTEROP_PROFILE === "1.3";
            assertEquals(
              posts.map(t => t.type),
              legacy
                ? ["application/cesr", "application/cesr+json", "application/cesr", "application/cesr+json"]
                : ["application/cesr", "application/cesr"],
            );
            for (const post of posts) {
              assertEquals(post.destination, witness.pre);
              assertEquals(post.authorization, "messenger-probe");
              assertExists(post.attachment);
            }
            const puts = snapshot!.traffic.filter(t => t.method === "PUT");
            assertEquals(puts.map(t => [t.length, t.destination, t.attachment, t.authorization]), [[
              streamWire.length,
              witness.pre,
              null,
              "messenger-probe",
            ]]);

            for (const stream of [false, true]) {
              const start = received.length;
              const sent = await control<{ pre: string; saids: string[]; wire: string; responses: number }>({
                action: "send",
                url: `http://127.0.0.1:${server.addr.port}/`,
                destination: receiver.pre,
                stream,
              });
              assertEquals(sent.responses, stream ? 1 : 2);
              assertEquals(parseBytes(concatBytes(...hby.db.clonePreIter(sent.pre))).map(f => f.body.said), sent.saids);
              const traffic = received.slice(start);
              assertEquals(traffic.map(t => t.method), stream ? ["PUT"] : ["POST", "POST"]);
              for (const req of traffic) {
                assertEquals(req.destination, receiver.pre);
                assertEquals(req.authorization, "messenger-probe");
                if (stream) {
                  assertEquals(req.attachment, null);
                  assertEquals(encodeBase64(req.body), sent.wire);
                } else assertExists(req.attachment);
              }
            }
          });
        } finally {
          yield* call(() => server.shutdown());
          yield* call(() => handler.close!());
          yield* runtime.close();
          yield* hby.close(true);
        }
      });
    } finally {
      await witnesses.close();
    }
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("signed mailbox queries retrieve and accept Python replies across reference media profiles", async () => {
  const ctx = await createInteropContext();
  try {
    const witnesses = await startKeriPyWitnessHarness(ctx, {
      aliases: ["wan"],
      messengerProbe: true,
      protocolVersion: 1,
    });
    try {
      const witness = witnesses.node("wan");
      /** Test controls publish signed output or inspect accepted state; protocol intake stays real. */
      const control = async <T>(command: Record<string, unknown>): Promise<T> => {
        const response = await fetch(`${witness.httpOrigin}/_messenger`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(command),
          signal: AbortSignal.timeout(20_000),
        });
        assertEquals(response.status, 200, await response.clone().text());
        return await response.json();
      };
      await run(function*() {
        const hby = yield* createHabery({ name: `mailbox-media-${crypto.randomUUID()}`, temp: true, skipConfig: true });
        const http = new NodeHttpClient();
        const runtime = yield* createAgentRuntime(hby, http, systemClock);
        const recipient = hby.makeHab("recipient", undefined, { version: Vrsn_1_0 });
        try {
          const inception = acceptedEventReplayMessage(hby, recipient.pre, 0, Vrsn_1_0).message;
          yield* messengerFrom(witness.pre, { http: witness.httpOrigin }, http, systemClock).send(inception);
          yield* call(async () => {
            const deadline = Date.now() + 20_000;
            let accepted: string[] | undefined;
            do {
              accepted =
                (await control<Snapshot>({ action: "snapshot", prefixes: [recipient.pre] })).states[recipient.pre];
              if (accepted) break;
              await new Promise((resolve) => setTimeout(resolve, 10));
            } while (Date.now() < deadline);
            assertEquals(accepted, [parseBytes(inception)[0].body.said]);
          });
          const published = yield* call(() =>
            control<{ sender: string; message: string }>({
              action: "publish",
              alias: "wan",
              recipient: recipient.pre,
            })
          );
          assertEquals(published.sender, witness.pre);
          const before = yield* call(() => control<Snapshot>({ action: "snapshot", prefixes: [] }));
          // These are recipient-owned endpoint choices, never seeded foreign accepted evidence.
          hby.db.locs.pin([witness.pre, "http"], { url: witness.httpOrigin });
          hby.db.ends.pin([recipient.pre, Roles.mailbox, witness.pre], { allowed: true });
          runtime.mailboxDirector.topics.clear();
          runtime.mailboxDirector.registerTopic("/reply");
          const received: Uint8Array[] = [];
          const worker = yield* spawn(() =>
            runtime.mailboxPoller.pollDo(function*(batch) {
              yield* settleMailboxPollBatch(runtime, batch);
              received.push(...batch.messages);
            })
          );
          try {
            const deadline = Date.now() + 20_000;
            while (hby.db.tops.get([recipient.pre, witness.pre])?.topics["/reply"] !== 0 && Date.now() < deadline) {
              yield* sleep(10);
            }
            assertEquals(hby.db.tops.get([recipient.pre, witness.pre])?.topics["/reply"], 0);
            assertEquals(hby.db.ends.get([witness.pre, Roles.agent, witness.pre])?.allowed, true);
            assertEquals(received.map(encodeBase64), [published.message]);
          } finally {
            yield* waitForTaskHalt(worker);
          }
          const after = yield* call(() => control<Snapshot>({ action: "snapshot", prefixes: [] }));
          const posts = after.traffic.slice(before.traffic.length).filter((t) => t.method === "POST");
          const legacy = ctx.env.KERIPY_INTEROP_PROFILE === "1.2" || ctx.env.KERIPY_INTEROP_PROFILE === "1.3";
          const expected = legacy ? ["application/cesr", "application/cesr+json"] : ["application/cesr"];
          assertEquals(posts.slice(0, expected.length).map((t) => t.type), expected);
          for (const post of posts) {
            assertEquals(post.destination, witness.pre);
            assertExists(post.attachment);
          }
        } finally {
          yield* runtime.close();
          yield* hby.close(true);
        }
      });
    } finally {
      await witnesses.close();
    }
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test({
  name: "native CESR key histories from the Python peer travel as whole PUTs through HTTPMessenger and are accepted",
  // v1-only reference profiles cannot author kind-CESR v2 key histories.
  ignore: ["1.2", "1.3"].includes(Deno.env.get("KERIPY_INTEROP_PROFILE") ?? ""),
  async fn() {
    const ctx = await createInteropContext();
    try {
      const witnesses = await startKeriPyWitnessHarness(ctx, {
        aliases: ["wan"],
        messengerProbe: true,
        protocolVersion: 2,
      });
      try {
        const witness = witnesses.node("wan");
        /** Author foreign histories or inspect accepted state; protocol intake stays real. */
        const control = async <T>(command: Record<string, unknown>): Promise<T> => {
          const response = await fetch(`${witness.httpOrigin}/_messenger`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(command),
            signal: AbortSignal.timeout(20_000),
          });
          assertEquals(response.status, 200, await response.clone().text());
          return await response.json();
        };
        await run(function*() {
          const hby = yield* createHabery({
            name: `native-history-${crypto.randomUUID()}`,
            temp: true,
            skipConfig: true,
          });
          const http = new NodeHttpClient();
          const runtime = yield* createAgentRuntime(hby, http, systemClock);
          const receiver = hby.makeHab("receiver");
          const handler = createProtocolHandler(runtime, { serviceHab: receiver });
          const received: {
            method: string;
            destination: string | null;
            attachment: string | null;
            body: Uint8Array;
          }[] = [];
          const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
            received.push({
              method: req.method,
              destination: req.headers.get("CESR-DESTINATION"),
              attachment: req.headers.get("CESR-ATTACHMENT"),
              body: new Uint8Array(await req.clone().arrayBuffer()),
            });
            return await handler(req);
          });
          try {
            const auth = { Authorization: "messenger-probe" };
            // keripy's test_http_messenger_key_history rows: native text, native binary, then v2 JSON.
            for (const [kind, binary] of [["cesr", false], ["cesr", true], ["json", false]] as const) {
              const label = `${kind}${binary ? " binary" : ""}`;
              const history = yield* call(() => control<KeyHistory>({ action: "history", kind, binary }));
              const wire = decodeBase64(history.wire);
              const frames = parseBytes(wire);
              assertEquals(frames.map((frame) => frame.body.said), history.saids, label);
              assertEquals(frames.every(isNativeCesrFrame), kind === "cesr", label);
              /** Expected native PUT bodies: each frame behind its own genus selector, in the source domain. */
              const bodies = kind === "cesr"
                ? yield* call(() =>
                  Promise.all(
                    frames.map((frame) => collectPayload(framePayload(frame, { domain: binary ? "bny" : "txt" }))),
                  )
                )
                : [];

              const before = yield* call(() => control<Snapshot>({ action: "snapshot", prefixes: [] }));
              const toWitness = messengerFrom(witness.pre, { http: witness.httpOrigin }, http, systemClock, auth);
              assertInstanceOf(toWitness, HTTPMessenger);
              assertEquals((yield* toWitness.send(wire)).kind, "complete", label);
              // The authoring Habery closed before sending: Python acceptance is genuine foreign intake.
              const snapshot = yield* call(async () => {
                const deadline = Date.now() + 20_000;
                let snapshot: Snapshot;
                do {
                  snapshot = await control<Snapshot>({ action: "snapshot", prefixes: [history.pre] });
                  if (snapshot.states[history.pre]?.length === 2) break;
                  await new Promise((resolve) => setTimeout(resolve, 10));
                } while (Date.now() < deadline);
                return snapshot;
              });
              assertEquals(snapshot.states[history.pre], history.saids, label);
              const traffic = snapshot.traffic.slice(before.traffic.length);
              if (kind === "cesr") {
                assertEquals(
                  traffic.map((
                    t,
                  ) => [t.method, t.type, t.length, t.destination, t.attachment, t.authorization, t.status]),
                  bodies.map((
                    body,
                  ) => ["PUT", "application/cesr", body.length, witness.pre, null, "messenger-probe", 204]),
                  label,
                );
              } else {
                assertEquals(traffic.map((t) => [t.method, t.type, t.destination, t.status]), [
                  ["POST", "application/cesr", witness.pre, 204],
                  ["POST", "application/cesr", witness.pre, 204],
                ], label);
                for (const post of traffic) assertExists(post.attachment);
              }

              // The same messenger shape reaches TypeScript intake with the same frames.
              const start = received.length;
              const toReceiver = messengerFrom(
                receiver.pre,
                { http: `http://127.0.0.1:${server.addr.port}` },
                http,
                systemClock,
                auth,
              );
              assertInstanceOf(toReceiver, HTTPMessenger);
              assertEquals((yield* toReceiver.send(wire)).kind, "complete", label);
              const delivered = received.slice(start);
              assertEquals(delivered.map((r) => r.method), kind === "cesr" ? ["PUT", "PUT"] : ["POST", "POST"], label);
              for (const r of delivered) assertEquals(r.destination, receiver.pre);
              if (kind === "cesr") {
                assertEquals(delivered.map((r) => r.body), bodies, label);
                assertEquals(delivered.map((r) => r.attachment), [null, null], label);
              }
              assertEquals(
                parseBytes(concatBytes(...hby.db.clonePreIter(history.pre))).map((frame) => frame.body.said),
                history.saids,
                label,
              );
            }
          } finally {
            yield* call(() => server.shutdown());
            yield* call(() => handler.close!());
            yield* runtime.close();
            yield* hby.close(true);
          }
        });
      } finally {
        await witnesses.close();
      }
    } finally {
      await Deno.remove(ctx.home, { recursive: true });
    }
  },
});
