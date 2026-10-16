/** Independent real HTTP peers exercise full IPEX lineage and retained partial disclosure. */
import {
  type CesrFrame,
  collectPayload,
  Compactor,
  Diger,
  framePayload,
  Kinds,
  type MapperMap,
  NonceDex,
  Noncer,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run, scoped } from "effection";
import { assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { requestFrame } from "../../../src/app/cesr-egress.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex-building.ts";
import type { DisclosurePlan } from "../../../src/app/ipex-graph.ts";
import type { IpexRoute } from "../../../src/app/ipexing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { loadNests } from "../../../src/db/exchange-nests.ts";
import { createInteropContext, randomPort, spawnChild, stopChild } from "./interop-test-helpers.ts";

const PEER = fromFileUrl(new URL("../../fixtures/ipex-http-peer.py", import.meta.url));
type Mode = "apply" | "offer" | "spurn-apply" | "spurn-offer";

/** Wait on observed peer state with an elapsed deadline; no whole-runtime pumping. */
async function observed<T>(label: string, read: () => T | null | undefined): Promise<T> {
  const deadline = performance.now() + 35_000;
  while (performance.now() < deadline) {
    const value = read();
    if (value != null) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Missing observation files are not observations; malformed results must fail immediately. */
function jsonFile<T>(path: string): T | null {
  try {
    return JSON.parse(Deno.readTextFileSync(path));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return null;
    throw error;
  }
}

/** One direction and conversation family, with fresh independent key stores and listeners. */
async function conversation(tsIssuer: boolean, mode: Mode): Promise<void> {
  const context = await createInteropContext();
  let child: ReturnType<typeof spawnChild> | undefined;
  let server: Deno.HttpServer<Deno.NetAddr> | undefined;
  let intakeFailure: unknown;
  const diagnostics: string[] = [];
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: `ipex-http-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, {
        kram: { enabled: true, denials: [], caches: { "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000] } },
      });
      try {
        const hab = hby.makeHab("typescript");
        const nonce = () =>
          new Noncer({ code: NonceDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }).qb64;
        const full = acdcmap(hab.pre, {
          uuid: nonce(),
          attribute: {
            d: "",
            u: nonce(),
            status: { d: "", u: nonce(), value: "citizen" },
            private: { d: "", u: nonce(), value: "hidden-value" },
          },
          kind: Kinds.json,
        });
        const compactor = new Compactor({
          mad: structuredClone(full.sad!.a) as MapperMap,
          kind: Kinds.json,
          verify: false,
        });
        compactor.compact(["a/status/"], "a");
        const partial = acdcmap(hab.pre, {
          uuid: full.sad!.u as string,
          schema: full.sad!.s as MapperMap,
          attribute: compactor.partials!["a/status/"].mad,
          kind: Kinds.json,
        });
        assertEquals(partial.said, full.said);
        const schema = (full.sad!.s as { $id: string }).$id;
        const plan: DisclosurePlan = [[schema, "/", ["a/status/"]]];
        server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
          try {
            const wire = await readCesrRequestBytes(request);
            await run(() => runtime.reactor.processBytes(wire));
            return new Response(null, { status: 204 });
          } catch (error) {
            intakeFailure = error;
            return new Response(String(error), { status: 500 });
          }
        });
        child = spawnChild(
          context.pythonCommand,
          [
            PEER,
            context.home,
            tsIssuer ? "holder" : "issuer",
            mode,
            hab.pre,
            `http://127.0.0.1:${server.addr.port}/`,
            schema,
            String(randomPort()),
          ],
          context.env,
          context.repoRoot,
        );
        // Drain both tee branches as the peer runs; failures retain its actual output.
        void new Response(child.liveStdout).text().then((text) => diagnostics.push(text));
        void new Response(child.liveStderr).text().then((text) => diagnostics.push(text));
        let peerExit: Deno.CommandStatus | undefined;
        void child.status.then((status) => {
          peerExit = status;
        });
        const read = <T>(get: () => T | null): T | null => {
          if (intakeFailure) throw intakeFailure;
          if (peerExit && !peerExit.success) {
            throw new Error(`Python peer exited ${peerExit.code}: ${diagnostics.join("\n")}`);
          }
          return get();
        };
        yield* call(async () => {
          const peer = await observed(
            "Python listener",
            () => read(() => jsonFile<{ pre: string; port: number }>(`${context.home}/ready.json`)),
          );
          const url = `http://127.0.0.1:${peer.port}/`;
          const post = async (frame: CesrFrame) => {
            await run(() =>
              scoped(function*() {
                const response = yield* requestFrame(url, frame, { destination: peer.pre, services: runtime.services });
                yield* call(() => response.arrayBuffer());
                assertEquals(response.status, 204);
              })
            );
          };
          const inception = hab.kever!.serder;
          const kel = messagize(inception, {
            sigers: hab.sign(inception.raw, true),
            gvrsn: Vrsn_2_0,
            pipelined: true,
            genusify: true,
          });
          await post((await parseBytes(kel))[0]);
          await observed("verified Python KEL", () => read(() => hby.db.getKever(peer.pre)));
          const received = (verb: string) =>
            observed(`accepted peer ${verb}`, () =>
              read(() => {
                for (const [, body] of hby.db.exns.getItemIter()) {
                  if (body.route === `/ipex/${verb}` && body.pre === peer.pre) return body;
                }
                return null;
              }));
          const signed = (body: SerderACDC | SerderKERI): CesrFrame => ({
            body,
            gvrsn: Vrsn_2_0,
            attachments: messageAttachmentGroups({
              tsgs: [
                new TransIdxSigGroup(
                  new Prefixer({ qb64: hab.pre }),
                  NumberPrimitive.fromNum(BigInt(hab.kever!.lastEst.s)),
                  new Diger({ qb64: hab.kever!.lastEst.d }),
                  hab.sign(body.raw, true),
                ),
              ],
            }, Vrsn_2_0),
          });
          const send = async (verb: string, prior?: SerderKERI) => {
            const nodes = verb === "offer" || verb === "grant" ? [partial] : [];
            const body = ipexExnBody(hab.pre, `/ipex/${verb}` as IpexRoute, nodes, {
              message: verb,
              prior,
              recipient: peer.pre,
              ...(!prior ? { xid: full.said!, plan } : {}),
            });
            const frame = signed(body);
            if (nodes.length) {
              frame.nests = nodes.map((node) =>
                verb === "grant"
                  ? signed(node)
                  : { body: node, attachments: [], gvrsn: Vrsn_2_0 }
              );
            }
            const wire = await collectPayload(framePayload(frame));
            await run(() => runtime.reactor.processBytes(wire));
            assertExists(hby.db.exns.get(body.said!), `local acceptance of ${verb}`);
            await post(frame);
            return body;
          };
          if (tsIssuer) {
            const apply = mode.endsWith("apply") ? await received("apply") : undefined;
            if (mode === "spurn-apply") await send("spurn", apply);
            else {
              await send("offer", apply);
              if (mode === "spurn-offer") await received("spurn");
              else {
                const agree = await received("agree");
                await send("grant", agree);
                await received("admit");
              }
            }
          } else {
            if (mode.endsWith("apply")) await send("apply");
            if (mode === "spurn-apply") await received("spurn");
            else {
              const offer = await received("offer");
              if (mode === "spurn-offer") await send("spurn", offer);
              else {
                await send("agree", offer);
                const grant = await received("grant");
                await send("admit", grant);
              }
            }
          }
          const result = await observed(
            "Python assertions",
            () => read(() => jsonFile<{ lineage: string[]; credential: string | null }>(`${context.home}/result.json`)),
          );
          assertEquals((await child!.status).success, true, diagnostics.join("\n"));
          const verbs = mode === "spurn-apply"
            ? ["apply", "spurn"]
            : mode === "spurn-offer"
            ? ["offer", "spurn"]
            : [...(mode === "apply" ? ["apply"] : []), "offer", "agree", "grant", "admit"];
          const messages = [...hby.db.exns.getItemIter()].map(([, body]) => body);
          assertEquals(messages.length, verbs.length);
          const lineage = verbs.map((verb) => {
            const body = messages.find((body) => body.route === `/ipex/${verb}`);
            assertExists(body, verb);
            return body;
          });
          assertEquals(lineage.map((body) => body.said!), result.lineage);
          assertEquals(lineage[0].sad!.p, "");
          for (let i = 1; i < lineage.length; i++) {
            const prior = lineage[i - 1], reply = lineage[i];
            assertEquals(reply.sad!.p, prior.said);
            assertEquals(reply.sad!.x, prior.sad!.x);
            assertEquals(reply.pre, prior.sad!.ri);
            assertEquals(reply.sad!.ri, prior.pre);
          }
          if (mode.startsWith("spurn")) {
            assertEquals(result.credential, null);
            assertEquals(messages.some((body) => body.route === "/ipex/grant" || body.route === "/ipex/admit"), false);
          } else {
            const grant = lineage.find((body) => body.route === "/ipex/grant")!;
            const nests = loadNests(hby.db, grant.said!);
            assertEquals(nests.length, 1);
            const node = nests[0].body;
            assertInstanceOf(node, SerderACDC);
            assertEquals(node.said, result.credential);
            assertEquals((node.sad!.a as { status: { value: string } }).status.value, "citizen");
            assertEquals(typeof (node.sad!.a as { private: unknown }).private, "string");
            assertEquals(new TextDecoder().decode(node.raw).includes("hidden-value"), false);
            if (tsIssuer) assertEquals(node.said, full.said);
            assertEquals(
              hby.db.exns.get(node.said!),
              null,
              "grant acceptance does not independently accept a credential",
            );
          }
        });
      } finally {
        if (child) diagnostics.push(yield* call(() => stopChild(child!)));
        if (server) yield* call(() => server!.shutdown());
        yield* runtime.close();
        yield* hby.close(true);
      }
    });
  } catch (error) {
    throw new Error(`${tsIssuer ? "TS → Py" : "Py → TS"} ${mode}: ${diagnostics.join("\n")}`, { cause: error });
  } finally {
    await Deno.remove(context.home, { recursive: true });
  }
}

for (const tsIssuer of [true, false]) {
  for (const mode of ["apply", "offer", "spurn-apply", "spurn-offer"] as const) {
    Deno.test(`IPEX ${tsIssuer ? "TS → Py" : "Py → TS"}: ${mode} over HTTP`, () => conversation(tsIssuer, mode));
  }
}
