import { concatBytes, Diger, essrChunks, parseBytes, Texter, Vrsn_1_0 } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import { createProtocolHandler } from "../../../../tufa/src/http/protocol-handler.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { acceptedEventReplayMessage, createHabery, type Hab } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { HTTPMessenger } from "../../../src/app/http-messenger.ts";
import { HTTPStreamMessenger } from "../../../src/app/http-stream-messenger.ts";
import { messengerFrom, streamMessengerFrom } from "../../../src/app/messengering.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
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
  }[];
  exn: string | null;
  payload: string[];
}

Deno.test("messenger factories exchange ordered POSTs and whole PUTs through actual Python witness and Tufa intake", async () => {
  const ctx = await createInteropContext();
  try {
    const witnesses = await startKeriPyWitnessHarness(ctx, { aliases: ["wan"], messengerProbe: true });
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
        const http = new FetchHttpClient();
        const runtime = yield* createAgentRuntime(hby, http, systemClock);
        const receiver = hby.makeHab("receiver");
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
          const ordinary = hby.makeHab("ordinary"), stream = hby.makeHab("stream");
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
            ? hby.makeHab("tcp", undefined, { wits: [witness.pre], toad: 1 })
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
