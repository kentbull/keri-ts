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
import { createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex-building.ts";
import type { DisclosurePlan } from "../../../src/app/ipex-graph.ts";
import type { IpexRoute } from "../../../src/app/ipexing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { loadNests } from "../../../src/db/exchange-nests.ts";
import { createInteropContext, randomPort, spawnChild, stopChild } from "./interop-test-helpers.ts";

const PEER = fromFileUrl(new URL("../../fixtures/ipex-http-peer.py", import.meta.url));
type Mode = "apply" | "offer" | "spurn-apply" | "spurn-offer";

/** Build a full commitment and its status-only partial with identical SAIDs. */
function disclosure(
  issuer: string,
  options: { issuee?: string; edge?: MapperMap } = {},
): { full: SerderACDC; partial: SerderACDC } {
  const nonce = () => new Noncer({ code: NonceDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }).qb64;
  const full = acdcmap(issuer, {
    ...options,
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
  const partial = acdcmap(issuer, {
    uuid: full.sad!.u as string,
    schema: full.sad!.s as MapperMap,
    attribute: compactor.partials!["a/status/"].mad,
    edge: full.sad!.e as MapperMap | undefined,
    kind: Kinds.json,
  });
  assertEquals(partial.said, full.said);
  return { full, partial };
}

type GraphCase = "I2I" | "NI2I" | "E1E" | "AND" | "OR" | "multi-hop" | "branching";
/** Concrete credential bodies, issuer keys and the deliberately missing proof. */
interface DisclosureGraph {
  full: SerderACDC;
  nodes: SerderACDC[];
  badNodes: SerderACDC[];
  issuers: Hab[];
  unsigned: string | null;
}

/** Build the issuer-side graph independently of transport and conversation state. */
function graphDisclosures(hby: Habery, hab: Hab, graphCase?: GraphCase): DisclosureGraph {
  let { full, partial } = disclosure(hab.pre);
  const authority = graphCase ? hby.makeHab("authority") : undefined;
  let nodes = [partial], badNodes: SerderACDC[] = [];
  if (authority && (graphCase === "multi-hop" || graphCase === "branching")) {
    const ancestor = hby.makeHab("ancestor");
    const tail = disclosure(ancestor.pre, { issuee: authority.pre });
    const middle = disclosure(authority.pre, {
      issuee: hab.pre,
      edge: { d: "", authority: { n: tail.partial.said, o: "I2I" } },
    });
    const edge: MapperMap = { d: "", authority: { n: middle.partial.said, o: "I2I" } };
    nodes = [middle.partial, tail.partial];
    const issuers = [hab, authority, ancestor];
    if (graphCase === "branching") {
      const auditor = hby.makeHab("auditor");
      const audit = disclosure(auditor.pre, {
        issuee: ancestor.pre,
        edge: { d: "", authority: { n: tail.partial.said, o: "NI2I" } },
      });
      edge.audit = { n: audit.partial.said, o: "NI2I" };
      nodes = [middle.partial, audit.partial, tail.partial];
      issuers.push(auditor);
    }
    const root = disclosure(hab.pre, { edge });
    nodes.unshift(root.partial);
    return {
      full: root.full,
      nodes,
      issuers,
      badNodes: graphCase === "multi-hop" ? nodes.slice(0, -1) : nodes,
      unsigned: graphCase === "branching" ? tail.partial.said : null,
    };
  }
  if (authority) {
    const far = disclosure(authority.pre, { issuee: graphCase === "I2I" ? hab.pre : authority.pre });
    /** Vary relation truth while retaining independently signed node evidence. */
    const near = (far: SerderACDC, invalid = false) =>
      disclosure(hab.pre, {
        issuee: authority.pre,
        edge: graphCase === "AND" || graphCase === "OR"
          ? {
            d: "",
            o: graphCase,
            authority: {
              o: graphCase === "AND" ? "OR" : "AND",
              link: { n: far.said, o: invalid && graphCase === "OR" ? "I2I" : "NI2I" },
              sameIssuee: { n: far.said, o: graphCase === "AND" ? "I2I" : "E1E" },
            },
            check: { n: far.said, o: graphCase === "AND" && !invalid ? "E1E" : "I2I" },
          }
          : { d: "", authority: { n: far.said, o: graphCase! } },
      });
    ({ full, partial } = near(far.partial));
    nodes = [partial, far.partial];
    if (graphCase === "NI2I") badNodes = nodes;
    else if (graphCase === "AND" || graphCase === "OR") badNodes = [near(far.partial, true).partial, far.partial];
    else {
      const badFar = disclosure(authority.pre, { issuee: graphCase === "I2I" ? authority.pre : hab.pre });
      badNodes = [near(badFar.partial).partial, badFar.partial];
    }
  }
  return {
    full,
    nodes,
    badNodes,
    issuers: authority ? [hab, authority] : [hab],
    unsigned: graphCase === "NI2I" ? nodes[1].said : null,
  };
}

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
async function conversation(
  tsIssuer: boolean,
  mode: Mode,
  graphCase?: GraphCase,
): Promise<void> {
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
        const { full, nodes, badNodes, issuers, unsigned } = graphDisclosures(
          hby,
          hab,
          tsIssuer ? graphCase : undefined,
        );
        const schema = (full.sad!.s as { $id: string }).$id;
        const paths = !graphCase
          ? ["/"]
          : graphCase === "multi-hop"
          ? ["/", "/e/authority/_/", "/e/authority/_/e/authority/_/"]
          : graphCase === "branching"
          ? ["/", "/e/authority/_/", "/e/audit/_/", "/e/authority/_/e/authority/_/"]
          : ["/", graphCase === "AND" || graphCase === "OR" ? "/e/authority/link/_/" : "/e/authority/_/"];
        const plan: DisclosurePlan = paths.map((path) => [schema, path, ["a/status/"]]);
        const receivedGrants: { said: string; kind: string | undefined }[] = [];
        server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
          try {
            const wire = await readCesrRequestBytes(request);
            for (const frame of await parseBytes(wire)) {
              const result = await run(() => runtime.reactor.dispatch(frame));
              if (result.envelope.serder.route === "/ipex/grant") {
                receivedGrants.push({
                  said: frame.body.said!,
                  kind: result.decision ? result.decision.kind : undefined,
                });
              }
            }
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
            graphCase ?? "-",
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
          for (const issuer of issuers) {
            const inception = issuer.kever!.serder;
            const kel = messagize(inception, {
              sigers: issuer.sign(inception.raw, true),
              gvrsn: Vrsn_2_0,
              pipelined: true,
              genusify: true,
            });
            await post((await parseBytes(kel))[0]);
          }
          await observed("verified Python KEL", () => read(() => hby.db.getKever(peer.pre)));
          const received = (verb: string) =>
            observed(`accepted peer ${verb}`, () =>
              read(() => {
                for (const [, body] of hby.db.exns.getItemIter()) {
                  if (body.route === `/ipex/${verb}` && body.pre === peer.pre) return body;
                }
                return null;
              }));
          /** Sign a child with its issuer's key, independently of the outer sender. */
          const signed = (body: SerderACDC | SerderKERI): CesrFrame => {
            const owner = body instanceof SerderACDC ? issuers.find((issuer) => issuer.pre === body.issuer) : hab;
            assertExists(owner, "fixture node issuer");
            return ({
              body,
              gvrsn: Vrsn_2_0,
              attachments: messageAttachmentGroups({
                tsgs: [
                  new TransIdxSigGroup(
                    new Prefixer({ qb64: owner.pre }),
                    NumberPrimitive.fromNum(BigInt(owner.kever!.lastEst.s)),
                    new Diger({ qb64: owner.kever!.lastEst.d }),
                    owner.sign(body.raw, true),
                  ),
                ],
              }, Vrsn_2_0),
            });
          };
          let rejected: string | undefined;
          const send = async (verb: string, prior?: SerderKERI, invalid = false) => {
            const carried = verb === "grant"
              ? invalid ? badNodes : nodes
              : verb === "offer" && !graphCase
              ? nodes
              : [];
            const body = ipexExnBody(hab.pre, `/ipex/${verb}` as IpexRoute, carried, {
              message: invalid ? "invalid chain" : verb,
              prior,
              recipient: peer.pre,
              ...(!prior ? { xid: full.said!, plan } : {}),
            });
            const frame = signed(body);
            if (carried.length) {
              frame.nests = carried.map((node) =>
                verb === "grant" && !(invalid && node.said === unsigned)
                  ? signed(node)
                  : { body: node, attachments: [], gvrsn: Vrsn_2_0 }
              );
            }
            const wire = await collectPayload(framePayload(frame));
            await run(() => runtime.reactor.processBytes(wire));
            assertEquals(Boolean(hby.db.exns.get(body.said!)), !invalid, `local outcome of ${verb}`);
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
                if (graphCase) rejected = (await send("grant", agree, true)).said!;
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
            () =>
              read(() =>
                jsonFile<{
                  lineage: string[];
                  credential: string | null;
                  nodes: string[];
                  rejected: string | null;
                }>(`${context.home}/result.json`)
              ),
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
          if (graphCase) {
            if (tsIssuer) assertEquals(result.rejected, rejected);
            else {
              rejected = result.rejected!;
              const observation = receivedGrants.find((grant) => grant.said === rejected);
              assertExists(observation, "the invalid grant reached actual protocol dispatch");
              assertEquals(observation.kind, "reject");
            }
            assertExists(rejected);
            assertEquals(hby.db.exns.get(rejected), null);
            assertEquals(hby.db.epse.get(rejected), null);
            assertEquals(hby.db.enst.get(rejected), []);
          }
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
            assertEquals(nests.length, plan.length);
            assertEquals(nests.map((nest) => nest.body.said!), result.nodes);
            for (const nest of nests) {
              assertInstanceOf(nest.body, SerderACDC);
              assertEquals((nest.body.sad!.a as { status: { value: string } }).status.value, "citizen");
              assertEquals(typeof (nest.body.sad!.a as { private: unknown }).private, "string");
              assertEquals(new TextDecoder().decode(nest.body.raw).includes("hidden-value"), false);
              assertEquals(
                hby.db.exns.get(nest.body.said!),
                null,
                "a parent does not independently accept its children",
              );
            }
            const node = nests[0].body;
            assertInstanceOf(node, SerderACDC);
            assertEquals(node.said, result.credential);
            if (tsIssuer) assertEquals(node.said, full.said);
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
  for (const graphCase of ["I2I", "NI2I", "E1E", "AND", "OR"] as const) {
    Deno.test(`IPEX ${tsIssuer ? "TS → Py" : "Py → TS"}: ${graphCase} chain refusal then admission`, () =>
      conversation(tsIssuer, "apply", graphCase));
  }
  for (const graphCase of ["multi-hop", "branching"] as const) {
    Deno.test(`IPEX ${tsIssuer ? "TS → Py" : "Py → TS"}: ${graphCase} partial graph refusal then admission`, () =>
      conversation(tsIssuer, "apply", graphCase));
  }
}
