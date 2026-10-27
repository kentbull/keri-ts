import { createProtocolHandler, SourceTrust } from "@keri-ts/hosting";
import { Registrar } from "@keri-ts/registrar";
import { AcdcV2Verifier, createVerifierCueBaser, VerifierAgent } from "@keri-ts/verifier";
import { createWalletBaser, Wallet, WalletAuthor } from "@keri-ts/wallet";
import {
  collectPayload,
  Compactor,
  concatBytes,
  Counter,
  Diger,
  framePayload,
  Kinds,
  makeBlindState,
  type MapperMap,
  NonceDex,
  Noncer,
  parseBytes,
  t,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import {
  acdcmap,
  blindate,
  createAgentRuntime,
  createHabery,
  FetchHttpClient,
  ipexExnBody,
  Receiptor,
  Roles,
  Schemer,
  Schemes,
  systemClock,
} from "keri-ts/runtime";
import { createObservationBaser, Observer } from "../../../observer/mod.ts";
import { certificate, framed, kel, serveTls } from "../../../observer/test/fixtures/service.ts";
import { startStaticHttpHost } from "../verifier/fixtures.ts";

interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

function packageRoot(): string {
  return new URL("../../../../", import.meta.url).pathname;
}

async function runTufa(
  args: string[],
  env: Record<string, string>,
): Promise<CmdResult> {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
    cwd: packageRoot(),
    stdout: "piped",
    stderr: "piped",
    env,
  }).output();
  return {
    code: out.code,
    stdout: t(out.stdout),
    stderr: t(out.stderr),
  };
}

async function requireSuccess(
  label: string,
  resultPromise: Promise<CmdResult>,
): Promise<CmdResult> {
  const result = await resultPromise;
  if (result.code !== 0) {
    throw new Error(`${label} failed:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return result;
}

function storeArgs(name: string, headDirPath: string, passcode: string): string[] {
  return ["--name", name, "--head-dir", headDirPath, "--passcode", passcode];
}

function parseJsonLine(output: string): Record<string, unknown> {
  const line = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{") && line.endsWith("}"))
    .at(-1);
  if (!line) {
    throw new Error(`Unable to parse JSON line from output:\n${output}`);
  }
  return JSON.parse(line) as Record<string, unknown>;
}

function extractPrefix(output: string): string {
  const line = output.split(/\r?\n/).find((line) => line.trim().startsWith("Prefix"));
  if (!line) {
    throw new Error(`Unable to parse prefix from output:\n${output}`);
  }
  const value = line.trim().split(/\s+/).at(-1);
  if (!value) {
    throw new Error(`Unable to parse prefix value from output:\n${output}`);
  }
  return value;
}

function schemaSed(): Record<string, unknown> {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    type: "object",
    required: ["v", "d", "i", "ri", "s", "a"],
    properties: {
      v: { type: "string" },
      d: { type: "string" },
      i: { type: "string" },
      ri: { type: "string" },
      s: { type: "string" },
      a: {
        type: "object",
        required: ["i", "role"],
        properties: {
          i: { type: "string" },
          role: { type: "string" },
        },
      },
    },
  };
}

async function initAndIncept(
  env: Record<string, string>,
  headDirPath: string,
  name: string,
  alias: string,
  passcode: string,
): Promise<string> {
  await requireSuccess(
    `${alias} init`,
    runTufa(["init", ...storeArgs(name, headDirPath, passcode)], env),
  );
  const incept = await requireSuccess(
    `${alias} incept`,
    runTufa([
      "incept",
      ...storeArgs(name, headDirPath, passcode),
      "--alias",
      alias,
      "--transferable",
      "--isith",
      "1",
      "--icount",
      "1",
      "--nsith",
      "1",
      "--ncount",
      "1",
      "--toad",
      "0",
    ], env),
  );
  return extractPrefix(incept.stdout);
}

Deno.test("ACDC workflow: tufa issuer -> holder -> verifier with revoke webhook", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "tufa-acdc-workflow-" });
  const env = {
    ...Deno.env.toObject(),
    KERI_LMDB_MAP_SIZE: "134217728",
  };
  const passcode = "MyPasscodeARealSecret";
  const issuerName = `issuer-${crypto.randomUUID().slice(0, 8)}`;
  const holderName = `holder-${crypto.randomUUID().slice(0, 8)}`;
  const verifierName = `verifier-${crypto.randomUUID().slice(0, 8)}`;
  const schemaPath = `${headDirPath}/schema.json`;
  const holderStreamPath = `${headDirPath}/holder-credential.cesr`;
  const verifierGrantPath = `${headDirPath}/verifier-grant.cesr`;
  const verifierRevocationPath = `${headDirPath}/verifier-revocation.cesr`;
  const webhookBodies: Record<string, unknown>[] = [];
  let failNextAcdcV2Hook = false;
  const hook = startStaticHttpHost(async (request, url) => {
    if (url.pathname !== "/hook") {
      return new Response("not found", { status: 404 });
    }
    const body = JSON.parse(await request.text()) as Record<string, unknown>;
    webhookBodies.push(body);
    if (failNextAcdcV2Hook && typeof (body.data as Record<string, unknown>).grant === "string") {
      failNextAcdcV2Hook = false;
      return new Response("temporary ACDC v2 hook failure", { status: 503 });
    }
    return new Response("", { status: 202 });
  });

  try {
    const schemer = new Schemer({ sed: schemaSed() });
    await Deno.writeFile(schemaPath, schemer.raw);
    const issuerPre = await initAndIncept(env, headDirPath, issuerName, "issuer", passcode);
    const holderPre = await initAndIncept(env, headDirPath, holderName, "holder", passcode);
    const verifierPre = await initAndIncept(env, headDirPath, verifierName, "verifier", passcode);

    const issuerSchema = await requireSuccess(
      "issuer schema import",
      runTufa(["vc", "schema", "import", ...storeArgs(issuerName, headDirPath, passcode), "--schema", schemaPath], env),
    );
    const schemaSaid = parseJsonLine(issuerSchema.stdout).schema as string;
    assertEquals(schemaSaid, schemer.said);

    const registry = await requireSuccess(
      "issuer registry incept",
      runTufa([
        "vc",
        "registry",
        "incept",
        ...storeArgs(issuerName, headDirPath, passcode),
        "--alias",
        "issuer",
        "--registry-name",
        "issuer-reg",
      ], env),
    );
    assertEquals(parseJsonLine(registry.stdout).issuer, issuerPre);

    const issued = await requireSuccess(
      "issuer credential create",
      runTufa([
        "vc",
        "create",
        ...storeArgs(issuerName, headDirPath, passcode),
        "--alias",
        "issuer",
        "--registry-name",
        "issuer-reg",
        "--schema",
        schemaSaid,
        "--recipient",
        holderPre,
        "--data",
        JSON.stringify({ role: "holder" }),
        "--out",
        holderStreamPath,
      ], env),
    );
    const issuedJson = parseJsonLine(issued.stdout);
    const credentialSaid = issuedJson.said as string;
    assertEquals(issuedJson.status, "accept");

    // A parsed bundle with a missing schema is retained, but the finite command must report incomplete acceptance.
    const incomplete = await runTufa(
      [
        "vc",
        "import",
        ...storeArgs(holderName, headDirPath, passcode),
        "--in",
        holderStreamPath,
        "--settlement-timeout-ms",
        "0.5",
      ],
      env,
    );
    assertEquals(incomplete.code !== 0, true);
    assertEquals(parseJsonLine(incomplete.stdout).complete, false);
    assertEquals(parseJsonLine(incomplete.stdout).saved, []);
    assertEquals(parseJsonLine(incomplete.stdout).unaccepted, [credentialSaid]);

    await requireSuccess(
      "holder schema import",
      runTufa(["vc", "schema", "import", ...storeArgs(holderName, headDirPath, passcode), "--schema", schemaPath], env),
    );
    const holderImport = await requireSuccess(
      "holder credential import",
      runTufa(["vc", "import", ...storeArgs(holderName, headDirPath, passcode), "--in", holderStreamPath], env),
    );
    assertEquals(parseJsonLine(holderImport.stdout).saved, [credentialSaid]);
    assertEquals(parseJsonLine(holderImport.stdout).complete, true);
    assertEquals(parseJsonLine(holderImport.stdout).unaccepted, []);

    const holderGrant = await requireSuccess(
      "holder ipex grant",
      runTufa([
        "ipex",
        "grant",
        ...storeArgs(holderName, headDirPath, passcode),
        "--alias",
        "holder",
        "--recipient",
        verifierPre,
        "--said",
        credentialSaid,
        "--message",
        "presentation",
        "--out",
        verifierGrantPath,
      ], env),
    );
    assertEquals(parseJsonLine(holderGrant.stdout).credential, credentialSaid);

    await requireSuccess(
      "verifier schema import",
      runTufa(
        ["vc", "schema", "import", ...storeArgs(verifierName, headDirPath, passcode), "--schema", schemaPath],
        env,
      ),
    );
    await requireSuccess(
      "verifier grant import",
      runTufa(["vc", "import", ...storeArgs(verifierName, headDirPath, passcode), "--in", verifierGrantPath], env),
    );

    const firstVerifierRun = await requireSuccess(
      "verifier issuance run",
      runTufa([
        "verifier",
        "run",
        ...storeArgs(verifierName, headDirPath, passcode),
        "--hook",
        `${hook.origin}/hook`,
        "--once",
      ], env),
    );
    const firstResult = parseJsonLine(firstVerifierRun.stdout).result as Record<string, unknown>;
    assertEquals(firstResult.webhooksSent, 1);
    assertEquals(webhookBodies.length, 1);
    assertEquals(webhookBodies[0]!.action, "iss");
    assertEquals(webhookBodies[0]!.actor, issuerPre);
    assertEquals((webhookBodies[0]!.data as Record<string, unknown>).credential, credentialSaid);
    assertEquals((webhookBodies[0]!.data as Record<string, unknown>).recipient, holderPre);

    await requireSuccess(
      "issuer credential revoke",
      runTufa([
        "vc",
        "revoke",
        ...storeArgs(issuerName, headDirPath, passcode),
        "--registry-name",
        "issuer-reg",
        "--said",
        credentialSaid,
        "--out",
        verifierRevocationPath,
      ], env),
    );
    await requireSuccess(
      "verifier revocation import",
      runTufa(["vc", "import", ...storeArgs(verifierName, headDirPath, passcode), "--in", verifierRevocationPath], env),
    );

    const secondVerifierRun = await requireSuccess(
      "verifier revocation run",
      runTufa([
        "verifier",
        "run",
        ...storeArgs(verifierName, headDirPath, passcode),
        "--hook",
        `${hook.origin}/hook`,
        "--once",
      ], env),
    );
    const secondResult = parseJsonLine(secondVerifierRun.stdout).result as Record<string, unknown>;
    assertEquals(secondResult.webhooksSent, 1);
    assertEquals(webhookBodies.length, 2);
    assertEquals(webhookBodies[1]!.action, "rev");
    assertEquals((webhookBodies[1]!.data as Record<string, unknown>).credential, credentialSaid);

    const thirdVerifierRun = await requireSuccess(
      "verifier idempotence run",
      runTufa([
        "verifier",
        "run",
        ...storeArgs(verifierName, headDirPath, passcode),
        "--hook",
        `${hook.origin}/hook`,
        "--once",
      ], env),
    );
    const thirdResult = parseJsonLine(thirdVerifierRun.stdout).result as Record<string, unknown>;
    assertEquals(thirdResult.webhooksSent, 0);
    assertEquals(webhookBodies.length, 2);
    // Continue with the same issuer/holder/verifier stores and real public ACDC v2 evidence.
    await run(function*() {
      const issuerHby = yield* createHabery({ name: issuerName, headDirPath, bran: passcode, skipConfig: true });
      const holderHby = yield* createHabery({ name: holderName, headDirPath, bran: passcode, skipConfig: true });
      let verifierHby = yield* createHabery({ name: verifierName, headDirPath, bran: passcode, skipConfig: true });
      const observed = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
      const witnesses = [];
      for (let i = 0; i < 3; i++) {
        witnesses.push(yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true }));
      }
      const witnessHabs = witnesses.map(peer => peer.makeHab("witness", undefined, { transferable: false }));
      const issuer = issuerHby.habByName("issuer")!, holder = holderHby.habByName("holder")!;
      const observerHab = observed.makeHab("observer"), http = new FetchHttpClient();
      const kram = {
        enabled: true,
        denials: [],
        caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] as const },
      };
      const source = yield* createAgentRuntime(issuerHby, http, systemClock, { kram });
      const forwarding = yield* createAgentRuntime(holderHby, http, systemClock);
      let receiver = yield* createAgentRuntime(verifierHby, http, systemClock);
      const cached = yield* createAgentRuntime(observed, http, systemClock, { kram });
      const witnessRuntimes = [];
      for (const peer of witnesses) witnessRuntimes.push(yield* createAgentRuntime(peer, http, systemClock));
      const handlers = witnessRuntimes.map((runtime, i) =>
        createProtocolHandler(runtime, {
          hostedPrefixes: [witnessHabs[i].pre],
          serviceHab: witnessHabs[i],
          witnessHab: witnessHabs[i],
        })
      );
      const servers = handlers.map(handler => Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler));
      const inventory = yield* createWalletBaser({ name: issuerName, headDirPath });
      let cues = yield* createVerifierCueBaser({ name: verifierName, headDirPath });
      const observations = yield* createObservationBaser({ name: crypto.randomUUID(), temp: true });
      let registrarServer: Awaited<ReturnType<typeof serveTls>> | undefined,
        observerServer: Awaited<ReturnType<typeof serveTls>> | undefined;
      try {
        for (const [i, witness] of witnessHabs.entries()) {
          for (const wire of witnesses[i].db.clonePreIter(witness.pre)) yield* source.reactor.processBytes(wire);
          yield* source.reactor.processBytes(
            witness.makeLocScheme(`http://127.0.0.1:${servers[i].addr.port}/`, witness.pre, Schemes.http),
          );
          yield* source.reactor.processBytes(witness.makeEndRole(witness.pre, Roles.controller, true));
        }
        issuer.rotate({ adds: witnessHabs.map(wit => wit.pre), toad: 2 });
        const receiptor = new Receiptor(issuerHby, source.protocol, http, systemClock);
        yield* receiptor.receipt(issuer.pre);
        const author = new WalletAuthor(
          new Wallet({ hby: issuerHby, registry: source.acdc!.store, exc: source.exc, db: inventory }),
          source.acdc!,
          receiptor,
        );
        const rip = yield* author.incept("acdc-v2-verifier", issuer.pre),
          reg = author.registry("acdc-v2-verifier", issuer.pre);
        const nonce = () =>
          new Noncer({ code: NonceDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }).qb64;
        const full = author.create(reg, {
          uuid: nonce(),
          issuee: holder.pre,
          attribute: {
            d: "",
            u: nonce(),
            status: { d: "", u: nonce(), role: "holder" },
            private: { d: "", u: nonce(), secret: "never project" },
          },
        });
        const issuance = yield* author.issue(reg, full, { public: true });
        const compactor = new Compactor({
          mad: structuredClone(full.attrib) as MapperMap,
          kind: Kinds.json,
          makify: true,
        });
        compactor.compact(["a/status/"], "a");
        const partial = acdcmap(issuer.pre, {
          regid: rip.said,
          uuid: full.sad!.u as string,
          schema: full.schema as string | MapperMap,
          attribute: compactor.partials!["a/status/"].mad,
          issuee: holder.pre,
        });
        assertEquals(partial.said, full.said);
        const publicEvidence = () =>
          concatBytes(Counter.makeGVC(Vrsn_2_0), kel(issuer), source.acdc!.store.cloneTel(rip.said!));
        for (const runtime of [forwarding, receiver]) {
          yield* runtime.reactor.processBytes(publicEvidence());
          for (const wire of holderHby.db.clonePreIter(holder.pre)) yield* runtime.reactor.processBytes(wire);
        }
        for (const wire of observed.db.clonePreIter(observerHab.pre)) yield* source.reactor.processBytes(wire);
        for (const wire of verifierHby.db.clonePreIter(verifierPre)) yield* cached.reactor.processBytes(wire);
        const registrar = new Registrar(source.protocol, source.acdc!.store, {
          observers: [observerHab.pre],
          fullEvidence: true,
        });
        const pem = yield* call(() => Deno.readTextFile(certificate));
        registrarServer = yield* call(() => serveTls(pem, registrar.handle));
        let now = Date.now();
        const observer = new Observer(cached.protocol, cached.acdc!.store, observations, {
          sources: [{
            url: `https://127.0.0.1:${registrarServer!.addr.port}/`,
            caFile: certificate,
            certName: "localhost",
          }],
          readers: [verifierPre],
          now: () => now,
        });
        let sourceQueries = 0;
        observerServer = yield* call(() =>
          serveTls(pem, request => {
            sourceQueries++;
            return observer.handle(request);
          })
        );
        assertEquals(yield* observer.pullOnce(observerHab), 1);
        const sourceTrust = new SourceTrust({
          url: `https://127.0.0.1:${observerServer.addr.port}/`,
          caFile: certificate,
          certName: "localhost",
        });
        const exn = ipexExnBody(holder.pre, "/ipex/grant", [partial], {
          recipient: verifierPre,
          xid: new Diger({ raw: crypto.getRandomValues(new Uint8Array(32)), code: "E" }).qb64,
          message: "ACDC v2 retained partial",
          plan: [[(partial.schema as { $id: string }).$id, "/", []]],
        });
        const outer = parseBytes(holder.endorse(exn, { gvrsn: Vrsn_2_0, genusify: true }))[0];
        outer.nests = [parseBytes(framed(partial, source.acdc!.store.publicOpening(issuance.update)!))[0]];
        const wire = yield* call(() => collectPayload(framePayload(outer)));
        yield* receiver.reactor.processBytes(wire);
        assertEquals(receiver.exc.complete(exn.said!), true);
        const options = { source: sourceTrust, maximumAgeMs: 15000, requestTimeoutMs: 5000, now: () => now };
        let acdcV2 = new AcdcV2Verifier(
          verifierHby,
          verifierHby.habByName("verifier")!,
          receiver.exc,
          new Registrar(receiver.protocol, receiver.acdc!.store),
          options,
        );
        const beforeInspection = { sourceQueries, cues: receiver.cues.length, counts: cues.getCounts() };
        const historical = acdcV2.inspectHistorical(exn.said!);
        assertEquals({ sourceQueries, cues: receiver.cues.length, counts: cues.getCounts() }, beforeInspection);
        assertEquals(historical.credential!.sad, partial.sad);
        assertEquals((yield* acdcV2.verifyCurrent(exn.said!)).kind, "issued");
        const agent = () =>
          new VerifierAgent(
            verifierHby,
            receiver.vdr!.reger,
            cues,
            receiver.protocol,
            receiver.cues,
            http,
            () => now,
            {},
            { hook: `${hook.origin}/hook`, acdcV2 },
          );
        yield* cues.close();
        yield* receiver.close();
        yield* verifierHby.close();
        const acdcV2Run = yield* call(() =>
          runTufa([
            "verifier",
            "run",
            ...storeArgs(verifierName, headDirPath, passcode),
            "--acdc-v2",
            "--alias",
            "verifier",
            "--observer",
            sourceTrust.url,
            "--observer-ca",
            certificate,
            "--observer-cert-name",
            "localhost",
            "--maximum-age-ms",
            "60000",
            "--hook",
            `${hook.origin}/hook`,
            "--once",
          ], env)
        );
        assertEquals(acdcV2Run.code, 0, acdcV2Run.stdout + acdcV2Run.stderr);
        assertEquals((parseJsonLine(acdcV2Run.stdout).result as Record<string, unknown>).webhooksSent, 1);
        verifierHby = yield* createHabery({ name: verifierName, headDirPath, bran: passcode, skipConfig: true });
        receiver = yield* createAgentRuntime(verifierHby, http, systemClock);
        cues = yield* createVerifierCueBaser({ name: verifierName, headDirPath });
        acdcV2 = new AcdcV2Verifier(
          verifierHby,
          verifierHby.habByName("verifier")!,
          receiver.exc,
          new Registrar(receiver.protocol, receiver.acdc!.store),
          options,
        );
        assertEquals([
          (webhookBodies.at(-1)!.data as Record<string, unknown>).grant,
          (webhookBodies.at(-1)!.data as Record<string, unknown>).presenter,
          (webhookBodies.at(-1)!.data as Record<string, unknown>).verifier,
        ], [exn.said, holderPre, verifierPre]);
        assertEquals(
          typeof (webhookBodies.at(-1)!.data as { attributes: { private: unknown } }).attributes.private,
          "string",
        );
        const fuller = ipexExnBody(holder.pre, "/ipex/grant", [full], {
          recipient: verifierPre,
          xid: new Diger({ raw: crypto.getRandomValues(new Uint8Array(32)), code: "E" }).qb64,
          message: "explicit full view",
          plan: [[(full.schema as { $id: string }).$id, "/", []]],
        });
        const fullerFrame = parseBytes(holder.endorse(fuller, { gvrsn: Vrsn_2_0, genusify: true }))[0];
        fullerFrame.nests = [parseBytes(framed(full, source.acdc!.store.publicOpening(issuance.update)!))[0]];
        yield* receiver.reactor.processBytes(yield* call(() => collectPayload(framePayload(fullerFrame))));
        assertEquals(receiver.exc.complete(fuller.said!), true);
        failNextAcdcV2Hook = true;
        const failedHook = yield* agent().processOnce();
        assertEquals([failedHook.webhooksSent, failedHook.webhooksFailed], [0, 1]);
        assertEquals(cues.ack.get([exn.said!])!.sad, partial.sad);
        const ready = [...cues.recv.getTopItemIter([fuller.said!, ""])];
        assertEquals(ready.length, 1, "same credential, distinct retained Grant view");
        assertEquals(ready[0][1].sad, full.sad);
        assertEquals(acdcV2.inspectHistorical(exn.said!), historical);
        const opaqueProof = makeBlindState({ sn: 2, acdc: full.said!, state: "revoked" });
        const opaque = blindate(rip.said!, issuance.update, opaqueProof.d.nonce, { sn: 2 });
        reg.processEvent(opaque);
        issuer.interact({ data: [{ s: "2", d: opaque.said }] });
        yield* receiptor.receipt(issuer.pre);
        reg.processEscrows();
        assertEquals(yield* observer.pullOnce(observerHab), 1);
        assertEquals((yield* acdcV2.verifyCurrent(exn.said!)).kind, "missing");
        const delivered = webhookBodies.length;
        assertEquals((yield* agent().processOnce()).webhooksSent, 0);
        yield* cues.close();
        yield* receiver.close();
        yield* verifierHby.close();
        verifierHby = yield* createHabery({ name: verifierName, headDirPath, bran: passcode, skipConfig: true });
        receiver = yield* createAgentRuntime(verifierHby, http, systemClock);
        cues = yield* createVerifierCueBaser({ name: verifierName, headDirPath });
        acdcV2 = new AcdcV2Verifier(
          verifierHby,
          verifierHby.habByName("verifier")!,
          receiver.exc,
          new Registrar(receiver.protocol, receiver.acdc!.store),
          options,
        );
        assertEquals(acdcV2.inspectHistorical(exn.said!), historical);
        assertEquals((yield* acdcV2.verifyCurrent(exn.said!)).kind, "missing");
        assertEquals(webhookBodies.length, delivered);
        yield* author.update(reg, full, "revoked", { public: true });
        assertEquals(yield* observer.pullOnce(observerHab), 1);
        assertEquals((yield* acdcV2.verifyCurrent(exn.said!)).kind, "revoked");
        assertEquals((yield* agent().processOnce()).webhooksSent, 1);
        assertEquals(webhookBodies.at(-1)!.action, "rev");
        assertEquals(acdcV2.inspectHistorical(exn.said!), historical);
        // A revoked far node is known False, not invalid: NOR may authorize an issued root.
        const farRip = yield* author.incept("acdc-v2-far", issuer.pre),
          farReg = author.registry("acdc-v2-far", issuer.pre);
        const far = author.create(farReg, { attribute: { name: "authority" } });
        const farIssued = yield* author.issue(farReg, far, { public: true });
        for (const operator of ["NOR", "AND"] as const) {
          const near = author.create(reg, {
            attribute: { operator },
            edge: { d: "", o: operator, proof: { n: far.said, o: "NI2I" } },
          });
          const nearIssued = yield* author.issue(reg, near, { public: true });
          yield* receiver.reactor.processBytes(
            concatBytes(publicEvidence(), source.acdc!.store.cloneTel(farRip.said!)),
          );
          const grant = ipexExnBody(holder.pre, "/ipex/grant", [near, far], {
            recipient: verifierPre,
            xid: new Diger({ raw: crypto.getRandomValues(new Uint8Array(32)), code: "E" }).qb64,
            message: operator,
            plan: [[(near.schema as { $id: string }).$id, "/", []], [
              (far.schema as { $id: string }).$id,
              "/e/proof/_/",
              [],
            ]],
          });
          const frame = parseBytes(holder.endorse(grant, { gvrsn: Vrsn_2_0, genusify: true }))[0];
          const farEvent = operator === "NOR" ? farIssued.update : farReg.regd!;
          frame.nests = [
            parseBytes(framed(near, source.acdc!.store.publicOpening(nearIssued.update)!))[0],
            parseBytes(framed(far, source.acdc!.store.publicOpening(farEvent)!))[0],
          ];
          yield* receiver.reactor.processBytes(yield* call(() => collectPayload(framePayload(frame))));
          assertEquals(receiver.exc.complete(grant.said!), true);
          if (operator === "NOR") yield* author.revoke(farReg, far.said!, { public: true });
          assertEquals(yield* observer.pullOnce(observerHab), 1);
          assertEquals((yield* acdcV2.verifyCurrent(grant.said!)).kind, operator === "NOR" ? "issued" : "refused");
          assertEquals((yield* agent().processOnce()).webhooksSent, operator === "NOR" ? 1 : 0);
        }
        now += 16000;
        assertEquals((yield* acdcV2.verifyCurrent(exn.said!)).kind, "missing");
      } finally {
        if (observerServer) yield* call(() => observerServer!.shutdown());
        if (registrarServer) yield* call(() => registrarServer!.shutdown());
        yield* cues.close();
        yield* observations.close(true);
        yield* inventory.close();
        for (const server of servers) yield* call(() => server.shutdown());
        handlers.forEach(handler => handler.close?.());
        yield* source.close();
        yield* forwarding.close();
        yield* receiver.close();
        yield* cached.close();
        for (const runtime of witnessRuntimes) yield* runtime.close();
        yield* issuerHby.close();
        yield* holderHby.close();
        yield* verifierHby.close();
        yield* observed.close(true);
        for (const peer of witnesses) yield* peer.close(true);
      }
    });
  } finally {
    await hook.close();
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});
