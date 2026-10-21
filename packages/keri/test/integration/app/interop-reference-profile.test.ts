import { call, run, spawn } from "effection";
import { assert, assertEquals, assertExists, assertInstanceOf } from "jsr:@std/assert";
import {
  concatBytes,
  Counter,
  Diger,
  Kinds,
  NumberPrimitive,
  NumDex,
  parseBytes,
  SerderKERI,
  Siger,
  Signer,
  t,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { startWitnessTcpServer } from "../../../../tufa/src/host/witness-tcp.ts";
import { createProtocolHandler } from "../../../../tufa/src/http/protocol-handler.ts";
import { createHabery } from "../../../src/app/identity/habbing.ts";
import { createProtocolProcessor } from "../../../src/app/protocol/protocol-processing.ts";
import { Reactor } from "../../../src/app/protocol/reactor.ts";
import { createAgentRuntime, runAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { readCesrRequestBytes } from "../../../src/app/transport/cesr-http.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { incept as inceptKel } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { incept as inceptRegistry } from "../../../src/core/protocol-vdr-eventing.ts";
import { Roles } from "../../../src/core/roles.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { Credentialer } from "../../../src/vdr/credentialing.ts";
import { waitForTaskHalt } from "../../effection-http.ts";
import { reserveTcpPort } from "../../http-test-support.ts";
import {
  createInteropContext,
  extractPrefix,
  requireSuccess,
  runCmdWithTimeout,
  runTufaWithTimeout,
  startKeriPyWitnessHarness,
} from "./interop-test-helpers.ts";
import { keripyProtocolVersionArgs, selectedKeripyProfile } from "./keripy-runtime.ts";

Deno.test("selected KERIpy CLI creates and exports a signed v1 inception accepted by TypeScript", async () => {
  const ctx = await createInteropContext();
  try {
    const name = `profile-${crypto.randomUUID()}`;
    const config = `${ctx.home}/inception.json`;
    await Deno.writeTextFile(
      config,
      JSON.stringify({
        transferable: true,
        icount: 1,
        isith: "1",
        ncount: 1,
        nsith: "1",
        toad: 0,
        wits: [],
      }),
    );
    const versions = keripyProtocolVersionArgs(ctx.env, "1.0");
    await requireSuccess(
      "reference init",
      runCmdWithTimeout(ctx.kliCommand, ["init", ...versions, "--name", name, "--nopasscode"], ctx.env, 20_000),
    );
    const inception = await requireSuccess(
      "reference inception",
      runCmdWithTimeout(
        ctx.kliCommand,
        [
          "incept",
          ...versions,
          "--name",
          name,
          "--alias",
          "alice",
          "--file",
          config,
        ],
        ctx.env,
        20_000,
      ),
    );
    const pre = extractPrefix(inception.stdout);
    const exported = await requireSuccess(
      "reference export",
      runCmdWithTimeout(ctx.kliCommand, ["export", "--name", name, "--alias", "alice"], ctx.env, 20_000),
    );
    await run(function*() {
      const hby = yield* createHabery({ name: `profile-${crypto.randomUUID()}`, temp: true, skipConfig: true });
      try {
        const protocol = createProtocolProcessor(hby);
        const reactor = new Reactor(protocol);
        // CLI export omits a selector; its attachment genus is independent of the signed v1 body.
        const major = selectedKeripyProfile(ctx.env)?.exportGenus ?? 2;
        assert(major === 1 || major === 2);
        yield* reactor.processBytes(concatBytes(
          Counter.makeGVC({ major, minor: 0 }),
          new TextEncoder().encode(exported.stdout),
        ));
        const accepted = hby.db.kevers.get(pre);
        assertExists(accepted);
        assertEquals(accepted.sn, 0);
        assertEquals(accepted.pre, pre);
      } finally {
        yield* hby.close(true);
      }
    });
    const invalid = await runCmdWithTimeout(ctx.kliCommand, ["init", "--not-a-real-option"], ctx.env, 10_000);
    assertEquals(invalid.code, 2, "The verified console launcher must preserve argparse failure.");
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("selected KERIpy profile serves its real v1 witness OOBI", async () => {
  const ctx = await createInteropContext();
  try {
    const witnesses = await startKeriPyWitnessHarness(ctx, { aliases: ["wan"] });
    try {
      const response = await fetch(witnesses.node("wan").witnessOobi);
      const bytes = new Uint8Array(await response.arrayBuffer());
      assertEquals(response.status, 200);
      assertEquals(bytes.length > 0, true);
    } finally {
      await witnesses.close();
    }
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("selected Python and Tufa query commands converge from stale accepted state through independent mailboxes", async () => {
  const ctx = await createInteropContext();
  try {
    const python = await startKeriPyWitnessHarness(ctx, { aliases: ["wan"], messengerProbe: true });
    try {
      await run(function*() {
        const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
        const witness = hby.makeHab("witness", undefined, { transferable: false, ncount: 0 });
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
          enableMailboxStore: true,
        });
        const handler = createProtocolHandler(runtime, {
          serviceHab: witness,
          witnessHab: witness,
          hostedPrefixes: [witness.pre],
        });
        const traffic: { route: string | null; status: number }[] = [];
        const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async req => {
          let route: string | null = null;
          if (req.method === "POST" && new URL(req.url).pathname === "/") {
            const frames = await parseBytes(await readCesrRequestBytes(req.clone()));
            route = (frames[0].body as SerderKERI).route;
          }
          const response = await handler(req);
          if (route) traffic.push({ route, status: response.status });
          return response;
        });
        const origin = `http://127.0.0.1:${server.addr.port}`;
        yield* runtime.reactor.processBytes(witness.makeLocScheme(origin, witness.pre, "http"));
        yield* runtime.reactor.processBytes(witness.makeEndRole(witness.pre, Roles.controller, true));
        const worker = yield* spawn(() => runAgentRuntime(runtime, { hab: witness }));
        try {
          yield* call(async () => {
            const versions = keripyProtocolVersionArgs(ctx.env, "1.0");
            const legacy = selectedKeripyProfile(ctx.env)?.protocolVersionArgument === false;
            const head = `${ctx.home}/tufa`,
              issuer = `issuer-${crypto.randomUUID()}`,
              reader = `reader-${crypto.randomUUID()}`;
            const pyReader = `query-${crypto.randomUUID()}`, pyWitness = python.node("wan");
            /** Invoke public Tufa commands with this fixture's isolated store root. */
            const tufa = (label: string, args: string[]) =>
              requireSuccess(label, runTufaWithTimeout(args, ctx.env, ctx.repoRoot, 30_000));
            /** Select real reference CLI arguments without rewriting the peer implementation. */
            const kli = (label: string, args: string[]) =>
              requireSuccess(label, runCmdWithTimeout(ctx.kliCommand, args, ctx.env, 30_000));
            /** Reopen accepted Tufa state after each command relinquishes its store. */
            const state = async (name: string, pre: string) =>
              await run(function*() {
                const store = yield* createHabery({ name, headDirPath: head, skipConfig: true, skipSignator: true });
                try {
                  const kever = store.db.getKever(pre);
                  assertExists(kever);
                  return { sn: kever.sn, said: kever.said };
                } finally {
                  yield* store.close();
                }
              });
            /** Read Python's own persisted state, rather than infer query success from its exit code. */
            const pythonState = async (pre: string): Promise<{ sn: number; said: string }> => {
              const result = await requireSuccess(
                "read accepted Python query state",
                runCmdWithTimeout(
                  ctx.pythonCommand,
                  [
                    "scripts/ci/read-query-state.py",
                    "--name",
                    pyReader,
                    "--prefix",
                    pre,
                    ...(legacy ? ["--legacy"] : []),
                  ],
                  ctx.env,
                  20_000,
                  ctx.repoRoot,
                ),
              );
              return JSON.parse(result.stdout);
            };
            for (const name of [issuer, reader]) {
              await tufa("initialize Tufa query store", ["init", "--name", name, "--head-dir", head, "--nopasscode"]);
            }
            const resolve = (name: string, url: string) =>
              tufa("resolve query prerequisite", ["oobi", "resolve", "--name", name, "--head-dir", head, "--url", url]);
            await resolve(issuer, pyWitness.controllerOobi);
            await resolve(issuer, `${origin}/oobi/${witness.pre}/controller`);
            await resolve(reader, pyWitness.controllerOobi);
            /** Author a genuinely witnessed AID through the CLI, with one explicit witness. */
            const incept = async (name: string, alias: string, wit: string) =>
              extractPrefix(
                (await tufa("incept query participant", [
                  "incept",
                  "--name",
                  name,
                  "--head-dir",
                  head,
                  "--alias",
                  alias,
                  "--transferable",
                  "--icount",
                  "1",
                  "--ncount",
                  "1",
                  "--toad",
                  "1",
                  "--receipt-endpoint",
                  "--wits",
                  wit,
                ])).stdout,
              );
            const pySubject = await incept(issuer, "python-subject", pyWitness.pre);
            const tsSubject = await incept(issuer, "tufa-subject", witness.pre);
            await incept(reader, "reader", pyWitness.pre);
            await resolve(reader, `${pyWitness.httpOrigin}/oobi/${pySubject}/witness/${pyWitness.pre}`);
            assertEquals((await state(reader, pySubject)).sn, 0);

            await kli("initialize Python reader", ["init", ...versions, "--name", pyReader, "--nopasscode"]);
            await kli("resolve Tufa witness", [
              "oobi",
              "resolve",
              ...versions,
              "--name",
              pyReader,
              "--oobi",
              `${origin}/oobi/${witness.pre}/controller`,
            ]);
            const config = `${ctx.home}/python-reader.json`;
            await Deno.writeTextFile(
              config,
              JSON.stringify({
                transferable: true,
                icount: 1,
                isith: "1",
                ncount: 1,
                nsith: "1",
                toad: 1,
                wits: [witness.pre],
              }),
            );
            await kli("incept Python mailbox recipient", [
              "incept",
              ...versions,
              "--name",
              pyReader,
              "--alias",
              "reader",
              "--file",
              config,
              "--receipt-endpoint",
            ]);
            await kli("bootstrap stale Python state", [
              "oobi",
              "resolve",
              ...versions,
              "--name",
              pyReader,
              "--oobi",
              `${origin}/oobi/${tsSubject}/witness/${witness.pre}`,
            ]);
            assertEquals((await pythonState(tsSubject)).sn, 0);

            for (const alias of ["python-subject", "tufa-subject"]) {
              await tufa("advance query subject", [
                "rotate",
                "--name",
                issuer,
                "--head-dir",
                head,
                "--alias",
                alias,
                "--receipt-endpoint",
                "--toad",
                "1",
              ]);
            }
            const expectedPy = await state(issuer, pySubject), expectedTs = await state(issuer, tsSubject);
            assertEquals([expectedPy.sn, expectedTs.sn], [1, 1]);
            const observed = await fetch(`${pyWitness.httpOrigin}/_messenger`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "snapshot", prefixes: [] }),
            });
            const before = (await observed.json()).traffic.length;
            await tufa("Tufa query Python-backed newer state", [
              "query",
              "--name",
              reader,
              "--head-dir",
              head,
              "--alias",
              "reader",
              "--prefix",
              pySubject,
            ]);
            assertEquals(await state(reader, pySubject), expectedPy);
            const snapshot = await fetch(`${pyWitness.httpOrigin}/_messenger`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "snapshot", prefixes: [] }),
            });
            const queried: { status: number }[] = (await snapshot.json()).traffic.slice(before);
            assert(queried.some(row => row.status === 204));
            assert(queried.some(row => row.status === 200));
            const start = traffic.length;
            await kli("Python query Tufa-backed newer state", [
              "query",
              ...versions,
              "--name",
              pyReader,
              "--alias",
              "reader",
              "--prefix",
              tsSubject,
            ]);
            assertEquals(await pythonState(tsSubject), expectedTs);
            const queries = traffic.slice(start);
            for (const route of ["ksn", "logs"]) {
              assert(
                queries.some(row => row.route === route && row.status === 204),
                `Expected acknowledged ${route}: ${JSON.stringify(queries)}`,
              );
            }
            assert(queries.some(row => row.route === "mbx" && row.status === 200));
          });
        } finally {
          yield* waitForTaskHalt(worker);
          yield* runtime.close();
          yield* call(() => server.shutdown());
          yield* call(() => handler.close!());
          yield* hby.close(true);
        }
      });
    } finally {
      await python.close();
    }
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("selected Python profile accepts actual TCP TEL replay through issued and revoked state", async () => {
  const ctx = await createInteropContext();
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const issuer = hby.makeHab("issuer");
      const service = hby.makeHab("service", undefined, { transferable: false });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const rgy = runtime.vdr!;
        const schema = new Schemer({ sed: { $id: "", type: "object" } });
        hby.db.schema.pin(schema.said, schema);
        const registry = rgy.makeRegistry("replay", issuer);
        const credentialer = new Credentialer(hby, { reger: rgy.reger, vry: rgy.vry });
        const creder = credentialer.create({ registry, schema: schema.said, recipient: issuer.pre, data: {} });
        assertEquals(credentialer.issue(registry, creder).telDecision.kind, "accept");
        const revoked = registry.revoke(creder.said!);
        assertEquals(revoked.decision.kind, "accept");
        runtime.cues.clear();
        const port = reserveTcpPort();
        const listener = yield* spawn(() => startWitnessTcpServer(port, "127.0.0.1", runtime, service));
        try {
          const evidence = `${ctx.home}/tel-replay.json`;
          yield* call(() =>
            Deno.writeTextFile(
              evidence,
              JSON.stringify({
                port,
                service: service.pre,
                registry: registry.regk,
                credential: creder.said,
                revocation: revoked.serder.said,
                kel: [...hby.db.clonePreIter(issuer.pre)].map(t).join(""),
              }),
            )
          );
          const legacy = selectedKeripyProfile(ctx.env)?.protocolVersionArgument === false;
          const result = yield* call(() =>
            requireSuccess(
              "Python observes TEL query replay",
              runCmdWithTimeout(
                ctx.pythonCommand,
                ["packages/keri/test/fixtures/tel_replay_peer.py", evidence, ...(legacy ? ["--legacy"] : [])],
                ctx.env,
                30_000,
                ctx.repoRoot,
              ),
            )
          );
          assertEquals(
            JSON.parse(result.stdout.trim().split("\n").at(-1)!),
            (legacy ? [1] : [1, 2]).map(genus => ({
              genus,
              events: ["iss", "rev"],
              said: revoked.serder.said,
            })),
          );
        } finally {
          yield* waitForTaskHalt(listener);
        }
      } finally {
        yield* runtime.close();
        yield* hby.close(true);
      }
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("selected Python TEL issuance and revocation survive fresh TypeScript intake and restart", async () => {
  const ctx = await createInteropContext();
  try {
    const legacy = selectedKeripyProfile(ctx.env)?.protocolVersionArgument === false;
    const generated = await requireSuccess(
      "Python produces accepted TEL evidence",
      runCmdWithTimeout(
        ctx.pythonCommand,
        ["packages/keri/test/fixtures/tel_issuer_peer.py", ...(legacy ? ["--legacy"] : [])],
        ctx.env,
        30_000,
        ctx.repoRoot,
      ),
    );
    const evidence: {
      issuer: string;
      registry: string;
      credential: string;
      revocation: string;
      events: string[];
      kel: string;
    } = JSON.parse(generated.stdout.trim().split("\n").at(-1)!);
    const encoder = new TextEncoder();
    const store = { name: "tel-observer", headDirPath: ctx.home, skipConfig: true };
    await run(function*() {
      const hby = yield* createHabery(store);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        yield* runtime.reactor.processBytes(encoder.encode(evidence.kel));
        assertExists(hby.db.getKever(evidence.issuer));
        for (const [index, wire] of evidence.events.entries()) {
          yield* runtime.reactor.processBytes(encoder.encode(wire));
          yield* runtime.protocol.processEscrowsOnce();
          if (index > 0) {
            assertEquals(
              runtime.vdr!.tvy.tevers.get(evidence.registry)?.vcState(evidence.credential)?.et,
              index === 1 ? "iss" : "rev",
            );
          }
        }
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
    // New owners load only durable state. Replaying stale issuance must not
    // replace the accepted revocation or its source-seal evidence.
    await run(function*() {
      const hby = yield* createHabery(store);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const rgy = runtime.vdr!;
        assertEquals(rgy.tvy.tevers.get(evidence.registry)?.vcState(evidence.credential)?.et, "rev");
        yield* runtime.reactor.processBytes(encoder.encode(evidence.events[1]));
        yield* runtime.protocol.processEscrowsOnce();
        assertEquals(rgy.tvy.tevers.get(evidence.registry)?.vcState(evidence.credential)?.d, evidence.revocation);
        const replay = [...rgy.reger.clonePreIter(evidence.credential)].map(raw => new SerderKERI({ raw }));
        assertEquals(replay.map(event => event.ilk), ["iss", "rev"]);
        assertEquals(replay.at(-1)!.said, evidence.revocation);
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("selected Python observer accepts indexed legacy TEL evidence", async () => {
  const ctx = await createInteropContext();
  try {
    await run(function*() {
      const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const issuer = hby.makeHab("issuer");
        const signers = ["first", "second"].map(name => hby.makeHab(name, undefined, { transferable: false }));
        const backers = signers.map(hab => hab.pre);
        // Protocol-level fixture signing supplies independent indexed receipt evidence.
        const vcp = inceptRegistry(issuer.pre, { baks: backers, toad: 2 });
        issuer.interact({ data: [{ i: vcp.pre, s: vcp.snh, d: vcp.said }] });
        const ordinal = new Uint8Array(16);
        ordinal[15] = 1;
        const proofs = signers.map((hab, index) => {
          const signature = hab.sign(vcp.raw, true)[0];
          return new Siger({ code: signature.code, raw: signature.raw, index });
        });
        const rgy = runtime.vdr!;
        assertEquals(
          rgy.tvy.processEvent({
            serder: vcp,
            seqner: new NumberPrimitive({ code: NumDex.Huge, raw: ordinal }),
            saider: new Diger({ qb64: issuer.kever!.said }),
            wigers: proofs,
          }).kind,
          "accept",
        );
        const evidence = `${ctx.home}/tel-observer.json`;
        yield* call(() =>
          Deno.writeTextFile(
            evidence,
            JSON.stringify({
              registry: vcp.pre,
              backers,
              kel: [...hby.db.clonePreIter(issuer.pre)].map(t).join(""),
              tel: t(rgy.reger.cloneTvt(vcp.pre!, vcp.said!)),
            }),
          )
        );
        const legacy = selectedKeripyProfile(ctx.env)?.protocolVersionArgument === false;
        const result = yield* call(() =>
          requireSuccess(
            "Python observes indexed TEL evidence",
            runCmdWithTimeout(
              ctx.pythonCommand,
              ["packages/keri/test/fixtures/tel_observer_peer.py", evidence, ...(legacy ? ["--legacy"] : [])],
              ctx.env,
              20_000,
              ctx.repoRoot,
            ),
          )
        );
        assertEquals(JSON.parse(result.stdout.trim().split("\n").at(-1)!), {
          registry: vcp.pre,
          threshold: 2,
          backers,
        });
      } finally {
        yield* runtime.close();
        yield* hby.close(true);
      }
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});

Deno.test("selected Python profile accepts v1 KEL and enforces its independent native-v2 boundary", async () => {
  const ctx = await createInteropContext();
  try {
    const signer = new Signer({ raw: crypto.getRandomValues(new Uint8Array(32)), code: "A", transferable: true });
    const evidence = [Vrsn_1_0, Vrsn_2_0].map(version => {
      const event = inceptKel([signer.verfer.qb64], {
        isith: "1",
        ndigs: [],
        nsith: "0",
        toad: 0,
        wits: [],
        pvrsn: version,
        kind: version.major === 1 ? Kinds.json : Kinds.cesr,
        code: "E",
      });
      const signature = signer.sign(event.raw, { index: 0 });
      assertInstanceOf(signature, Siger);
      return {
        major: version.major,
        pre: event.pre,
        said: event.said,
        wire: t(messagize(event, {
          sigers: [signature],
          gvrsn: version,
          pipelined: false,
          genusify: version.major === 2,
        })),
      };
    });
    const path = `${ctx.home}/kel-versions.json`;
    await Deno.writeTextFile(path, JSON.stringify(evidence));
    const legacy = selectedKeripyProfile(ctx.env)?.protocolVersionArgument === false;
    const output = await requireSuccess(
      "observe real KEL version acceptance",
      runCmdWithTimeout(
        ctx.pythonCommand,
        ["packages/keri/test/fixtures/kel_version_peer.py", path, ...(legacy ? ["--legacy"] : [])],
        ctx.env,
        20_000,
        ctx.repoRoot,
      ),
    );
    const observed = JSON.parse(output.stdout.trim().split("\n").at(-1)!);
    assertEquals(observed["1"], { sn: 0, said: evidence[0].said });
    assertEquals(observed["2"], legacy ? null : { sn: 0, said: evidence[1].said });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});
