/** Public CLI group conversation authoring and exact approval resume over real HTTP intake. */
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { concatBytes, Diger, parseBytes, Prefixer, Seqner, SerderKERI, Vrsn_1_0 } from "../../../../cesr/mod.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { credentialStreamBytes } from "../../../src/app/credential-workflows.ts";
import { createExchangeMessage } from "../../../src/app/exchange-messaging.ts";
import { createHabery, type Habery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { attachmentCounterPayloadQb64b } from "../../../src/core/attachment-countering.ts";
import { reply as endpointReply } from "../../../src/core/protocol-eventing.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { incept as registryIncept, issue as credentialIssue } from "../../../src/core/protocol-vdr-eventing.ts";
import { RegistryRecord } from "../../../src/core/records.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { credential, serializeCredential } from "../../../src/vdr/credentialing.ts";

Deno.test("IPEX group CLI settles grants and admits through independent member stores", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "ipex-group-cli-" });
  const stores = ["left", "right", "peer"];
  let transmissions = 0;
  let businessDeliveries = 0;
  const receivers = new Map<string, { hby: Habery; runtime: AgentRuntime }>();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async request => {
    const name = new URL(request.url).pathname.slice(1);
    if (!stores.includes(name)) return new Response(null, { status: 404 });
    transmissions++;
    const bytes = await readCesrRequestBytes(request);
    // This fixture supplies direct intake, not a mailbox/query provider.
    // Unsupported queries receive an explicit refusal, never a fabricated reply.
    if (parseBytes(bytes).some(frame => frame.body instanceof SerderKERI && frame.body.ilk === "qry")) {
      return new Response(null, { status: 404 });
    }
    if (name === "peer") {
      businessDeliveries += parseBytes(bytes).filter(frame =>
        frame.body instanceof SerderKERI && frame.body.route?.startsWith("/ipex/")
      ).length;
    }
    const receiver = receivers.get(name);
    if (!receiver) return new Response(null, { status: 503 });
    // Concurrent HTTP inputs share this node's one store/protocol owner. CLI
    // commands use independent processes over the same durable environment.
    await run(() => receiver.runtime.reactor.processBytes(bytes));
    return new Response(null, { status: 204 });
  });
  const root = new URL("../../../../../", import.meta.url).pathname;
  async function execute(name: string, args: string[], family: "ipex" | "vc" | "multisig" = "ipex") {
    return await new Deno.Command(Deno.execPath(), {
      cwd: root,
      args: ["run", "-A", "packages/tufa/mod.ts", family, ...args, "--name", name, "--head-dir", headDirPath],
      stdout: "piped",
      stderr: "piped",
    }).output();
  }
  async function command(name: string, args: string[]) {
    const output = await execute(name, args);
    assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
    const lines = new TextDecoder().decode(output.stdout).trim().split("\n");
    return JSON.parse(lines.at(-1)!) as {
      said: string;
      status: string;
      lead: boolean;
      approved?: boolean;
      messages: { exnSaid: string }[];
      saved?: boolean;
      credential: string;
      grant: string;
      deliveries: string[];
    };
  }
  try {
    const fixture = await run(function*() {
      const hbys: Habery[] = [];
      for (const name of stores) hbys.push(yield* createHabery({ name, headDirPath, skipConfig: true }));
      const runtimes: AgentRuntime[] = [];
      for (const hby of hbys) runtimes.push(yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock));
      try {
        const members = hbys.map(hby => hby.makeHab("member"));
        const kel = members.map(hab => concatBytes(...hab.db.clonePreIter(hab.pre)));
        for (const runtime of runtimes) for (const wire of kel) yield* runtime.reactor.processBytes(wire);
        const mids = members.slice(0, 2).map(hab => hab.pre);
        const groups = hbys.slice(0, 2).map((hby, i) =>
          hby.makeGroupHab("group", members[i], mids, mids, undefined, { isith: "2", nsith: "2" })
        );
        const groupKel = messagize(groups[0].serder, { sigers: [...groups[0].sigers, ...groups[1].sigers] });
        for (const runtime of runtimes) yield* runtime.reactor.processBytes(groupKel, { local: true });
        for (const [i, hab] of members.entries()) {
          const url = `http://127.0.0.1:${server.addr.port}/${stores[i]}`;
          for (const runtime of runtimes) {
            yield* runtime.reactor.processBytes(hab.makeEndRole(hab.pre, "controller", true));
            yield* runtime.reactor.processBytes(hab.makeLocScheme(url, hab.pre, "http"));
          }
        }
        const group = groups[0].hab.pre, peer = members[2];
        // Signed group agent bindings deliver recipient traffic to both actual
        // members. Location replies above belong to those endpoint identities.
        for (const member of members.slice(0, 2)) {
          const reply = endpointReply("/end/role/add", { cid: group, role: "agent", eid: member.pre });
          for (const contribution of groups) {
            for (const runtime of runtimes) {
              yield* runtime.reactor.processBytes(contribution.hab.endorse(reply, { pipelined: false }));
            }
          }
        }
        const schema = new Schemer({ sed: { $id: "", type: "object" } });
        const schemaFile = `${headDirPath}/schema.json`;
        yield* call(() => Deno.writeFile(schemaFile, schema.raw));
        for (const hby of hbys) hby.db.schema.pin(schema.said, schema);
        const registry = registryIncept(group, { cnfg: ["NB"] });
        const issued = credential({
          issuer: group,
          registry: registry.pre!,
          schema: schema.said,
          recipient: peer.pre,
          data: {},
        });
        const issuance = credentialIssue(issued.said!, registry.pre!);
        // Fixture issuance uses real two-member KEL anchors and ordinary TEL/ACDC
        // intake. No accepted registry or wallet rows are seeded for the CLI test.
        for (const tel of [registry, issuance]) {
          const anchors = hbys.slice(0, 2).map(hby =>
            hby.interactGroupHab("group", mids, {
              data: [{ i: tel.pre, s: "0", d: tel.said }],
            })
          );
          assertEquals(anchors[0].serder.raw, anchors[1].serder.raw);
          const wire = messagize(anchors[0].serder, { sigers: anchors.flatMap(anchor => anchor.sigers) });
          const seal = [anchors[0].serder.sner!.qb64b, new Diger({ qb64: anchors[0].serder.said! }).qb64b];
          const telWire = concatBytes(
            tel.raw,
            attachmentCounterPayloadQb64b("SealSourceCouples", 1, seal, Vrsn_1_0),
            ...seal,
          );
          // The group members know their own issued credential; the counterparty
          // must learn TEL/ACDC evidence from the later grant delivery.
          for (const runtime of runtimes.slice(0, 2)) {
            yield* runtime.reactor.processBytes(wire, { local: true });
            yield* runtime.reactor.processBytes(telWire, { local: true });
          }
        }
        const issuedWire = serializeCredential(
          issued,
          new Prefixer({ qb64: issued.said! }),
          new Seqner({ code: "0A", raw: new Uint8Array(16) }),
          new Diger({ qb64: issuance.said! }),
        );
        for (const runtime of runtimes.slice(0, 2)) {
          yield* runtime.reactor.processBytes(issuedWire, { local: true });
          yield* runtime.protocol.processEscrowsOnce();
          assertEquals(runtime.vdr!.reger.saved.get([issued.said!])?.qb64, issued.said);
        }
        // Local naming metadata selects an already protocol-accepted registry;
        // it supplies no TEL acceptance or signature evidence.
        for (const runtime of runtimes.slice(0, 2)) {
          runtime.vdr!.reger.regs.pin("registry", new RegistryRecord({ registryKey: registry.pre!, prefix: group }));
        }
        const issuedPath = `${headDirPath}/original-issuance.cesr`;
        yield* call(() =>
          Deno.writeFile(issuedPath, credentialStreamBytes(hbys[0], runtimes[0].vdr!.reger, issued, peer.pre))
        );
        const observer = yield* createHabery({ name: "verifier", headDirPath, skipConfig: true });
        try {
          observer.db.schema.pin(schema.said, schema);
        } finally {
          yield* observer.close();
        }
        const peerRegistry = registryIncept(peer.pre, { cnfg: ["NB"] });
        const groupCredential = credential({
          issuer: peer.pre,
          registry: peerRegistry.pre!,
          schema: schema.said,
          recipient: group,
          data: {},
        });
        const peerIssuance = credentialIssue(groupCredential.said!, peerRegistry.pre!);
        for (const tel of [peerRegistry, peerIssuance]) {
          const anchorWire = peer.interact({ data: [{ i: tel.pre, s: "0", d: tel.said }] });
          const anchor = new SerderKERI({ raw: anchorWire });
          const seal = [anchor.sner!.qb64b, new Diger({ qb64: anchor.said! }).qb64b];
          yield* runtimes[2].reactor.processBytes(
            concatBytes(tel.raw, attachmentCounterPayloadQb64b("SealSourceCouples", 1, seal, Vrsn_1_0), ...seal),
            { local: true },
          );
        }
        yield* runtimes[2].reactor.processBytes(
          serializeCredential(
            groupCredential,
            new Prefixer({ qb64: groupCredential.said! }),
            new Seqner({ code: "0A", raw: new Uint8Array(16) }),
            new Diger({ qb64: peerIssuance.said! }),
          ),
          { local: true },
        );
        assertEquals(runtimes[2].vdr!.reger.saved.get([groupCredential.said!])?.qb64, groupCredential.said);
        const creder = credential({
          issuer: group,
          registry: registryIncept(group, { cnfg: ["NB"] }).pre!,
          schema: peer.pre,
          data: {},
        });
        const path = `${headDirPath}/offer.cesr`;
        yield* call(() => Deno.writeFile(path, creder.raw));
        const offer = createExchangeMessage(peer, {
          dest: group,
          route: "/ipex/offer",
          payload: { m: "offer" },
          embeds: { acdc: creder.raw },
        });
        const apply = createExchangeMessage(peer, {
          dest: group,
          route: "/ipex/apply",
          payload: { m: "request", s: peer.pre, a: {} },
        });
        for (const runtime of runtimes) {
          for (const wire of [offer.msg, apply.msg]) yield* runtime.reactor.processBytes(wire);
        }
        return {
          credential: issued.said!,
          issuedPath,
          groupCredential: groupCredential.said!,
          group,
          schema: schema.said,
          schemaFile,
          peer: peer.pre,
          other: members[1].pre,
          path,
          offer: offer.serder.said!,
          apply: apply.serder.said!,
        };
      } finally {
        for (const runtime of runtimes.reverse()) yield* runtime.close();
        for (const hby of hbys.reverse()) yield* hby.close();
      }
    });
    await run(function*() {
      const hbys: Habery[] = [];
      const runtimes: AgentRuntime[] = [];
      try {
        for (const name of stores) {
          const hby = yield* createHabery({ name, headDirPath, skipConfig: true });
          hbys.push(hby);
          const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
          runtimes.push(runtime);
          receivers.set(name, { hby, runtime });
        }
        yield* call(async () => {
          const refused = await execute("left", [
            "agree",
            "--alias",
            "group",
            "--recipient",
            fixture.other,
            "--offer",
            fixture.offer,
          ]);
          assertEquals(refused.code !== 0, true);
          assertEquals(new TextDecoder().decode(refused.stderr).includes("parties do not match"), true);
          assertEquals(transmissions, 0, "Mismatched conversation parties must not publish work");
          const wrongPrior = await execute("left", [
            "grant",
            "--alias",
            "group",
            "--recipient",
            fixture.peer,
            "--said",
            fixture.credential,
            "--agree",
            fixture.offer,
            "--approval-timeout",
            "0",
          ]);
          assertEquals(wrongPrior.code !== 0, true);
          assertEquals(new TextDecoder().decode(wrongPrior.stderr).includes("wrong route"), true);
          assertEquals(transmissions, 0, "An invalid selected predecessor must fail before fanout");
          let groupGrant = "";
          for (
            const [verb, args] of [
              ["apply", ["--schema", fixture.peer]],
              ["offer", ["--acdc", fixture.path]],
              ["agree", ["--offer", fixture.offer]],
              ["spurn", ["--prior", fixture.apply]],
              ["grant", ["--said", fixture.credential]],
            ] as const
          ) {
            const output = `${headDirPath}/grant.cesr`;
            const outputArgs: string[] = [];
            if (verb === "grant") outputArgs.push("--out", output);
            const authored = await command("left", [
              verb,
              "--alias",
              "group",
              "--recipient",
              fixture.peer,
              "--approval-timeout",
              "0",
              ...args,
              ...outputArgs,
            ]);
            if (verb === "grant") {
              groupGrant = authored.said;
              await assertRejects(() => Deno.stat(output), Deno.errors.NotFound);
            }
            assertEquals(authored.status, "multisig-pending");
            assertEquals(authored.messages.length, 1);
            const selected = authored.messages[0].exnSaid;
            const beforeDelivery = businessDeliveries;
            const joined = await command("right", ["join", "--said", selected, "--auto"]);
            assertEquals(joined.status, "multisig-approved");
            assertEquals(joined.approved, true);
            assertEquals(joined.lead, false);
            assertEquals(businessDeliveries, beforeDelivery, "The other member must only fan out approval");
            const completed = await command("left", ["join", "--said", selected, "--auto"]);
            assertEquals(completed.status, "multisig-approved");
            assertEquals(completed.lead, true);
            assertEquals(businessDeliveries, beforeDelivery + 1, "The elected member sends the business EXN once");
            const received = receivers.get("peer")!.hby.db.exns.get([authored.said]);
            assertExists(received);
            assertEquals(received.route, `/ipex/${verb}`);
          }
          const observedIssuance = await execute("verifier", ["import", "--in", fixture.issuedPath], "vc");
          assertEquals(observedIssuance.code, 0, new TextDecoder().decode(observedIssuance.stderr));
          const settled = await command("peer", ["admit", "--alias", "member", "--said", groupGrant, "--timeout", "0"]);
          assertEquals(settled.saved, true);
          assertEquals(settled.credential, fixture.credential);
          for (const name of stores.slice(0, 2)) {
            const received = receivers.get(name)!.hby.db.exns.get([settled.said]);
            assertExists(received);
            assertEquals(received.ked?.p, groupGrant);
          }
          const exported = await command("peer", [
            "grant",
            "--alias",
            "member",
            "--recipient",
            fixture.other,
            "--said",
            fixture.credential,
            "--out",
            `${headDirPath}/holder-grant.cesr`,
          ]);
          assertEquals(exported.deliveries, []);
          const presentation = receivers.get("peer")!.hby.db.exns.get([exported.said]);
          assertExists(presentation);
          assertEquals(presentation.pre, fixture.peer);
          assertEquals(presentation.ked?.a, { m: "", i: fixture.other });
          // Withhold one member's schema for the reciprocal group-holder exchange.
          receivers.get("right")!.hby.db.schema.rem(fixture.schema);
          const incoming = await command("peer", [
            "grant",
            "--alias",
            "member",
            "--recipient",
            fixture.group,
            "--said",
            fixture.groupCredential,
          ]);
          const refusedAdmit = await execute("left", [
            "admit",
            "--alias",
            "member",
            "--said",
            incoming.said,
            "--timeout",
            "0",
          ]);
          assertEquals(refusedAdmit.code !== 0, true);
          assertEquals(new TextDecoder().decode(refusedAdmit.stderr).includes("parties do not match"), true);
          const pendingWalletFile = `${headDirPath}/wallet-pending-admit.cesr`;
          const waiting = await command("right", [
            "admit",
            "--alias",
            "group",
            "--said",
            incoming.said,
            "--timeout",
            "0",
            "--out",
            pendingWalletFile,
          ]);
          assertEquals(waiting.status, "credential-pending");
          assertEquals(waiting.saved, false);
          await assertRejects(() => Deno.stat(pendingWalletFile), Deno.errors.NotFound);
          const pendingFile = `${headDirPath}/group-admit.cesr`;
          const started = await command("left", [
            "admit",
            "--alias",
            "group",
            "--said",
            incoming.said,
            "--timeout",
            "0",
            "--approval-timeout",
            "0",
            "--out",
            pendingFile,
          ]);
          assertEquals(started.saved, true);
          assertEquals(started.status, "multisig-pending");
          await assertRejects(() => Deno.stat(pendingFile), Deno.errors.NotFound);
          const selected = started.messages[0].exnSaid;
          const beforeAdmit = businessDeliveries;
          const missing = await command("right", ["join", "--said", selected, "--auto", "--approval-timeout", "0"]);
          assertEquals(missing.saved, false);
          assertEquals(missing.approved, false);
          assertEquals(missing.status, "credential-pending");
          assertEquals(businessDeliveries, beforeAdmit);
          for (const [, signature] of receivers.get("right")!.hby.db.esigs.getTopItemIter([started.said])) {
            assertEquals(signature.index === 1, false);
          }
          const imported = await execute("right", ["schema", "import", "--schema", fixture.schemaFile], "vc");
          assertEquals(imported.code, 0, new TextDecoder().decode(imported.stderr));
          const approved = await command("right", ["join", "--said", selected, "--auto"]);
          assertEquals(approved.saved, true);
          assertEquals(approved.lead, false);
          assertEquals(businessDeliveries, beforeAdmit);
          const completed = await command("left", ["join", "--said", selected, "--auto"]);
          assertEquals(completed.saved, true);
          assertEquals(completed.lead, true);
          assertEquals(businessDeliveries, beforeAdmit + 1);
          for (const name of stores) {
            const { hby, runtime } = receivers.get(name)!;
            const received = hby.db.exns.get([started.said]);
            assertExists(received);
            assertEquals(received.route, "/ipex/admit");
            assertEquals(received.ked?.p, incoming.said);
            assertEquals(runtime.vdr!.reger.saved.get([fixture.groupCredential])?.qb64, fixture.groupCredential);
          }
          // Each command is a fresh subprocess. Approval resumes durable
          // notification/EXN evidence rather than keeping an initiating CLI alive.
          async function revoke(name: string, extra: string[] = []) {
            const output = await execute(name, [
              "revoke",
              "--alias",
              "group",
              "--registry-name",
              "registry",
              "--said",
              fixture.credential,
              "--timeout",
              "0",
              ...extra,
            ], "vc");
            assertEquals(output.code, 0, new TextDecoder().decode(output.stderr));
            return JSON.parse(new TextDecoder().decode(output.stdout).trim().split("\n").at(-1)!) as {
              tel: string;
              accepted: boolean;
              publicationComplete: boolean;
              messages: { exnSaid: string }[];
              deliveries: string[];
            };
          }
          const revocationPath = `${headDirPath}/revocation.cesr`;
          const pendingRev = await revoke("left", ["--out", revocationPath]);
          assertEquals(pendingRev.accepted, false);
          assertEquals(pendingRev.publicationComplete, false);
          assertEquals(pendingRev.deliveries, []);
          await assertRejects(() => Deno.stat(revocationPath), Deno.errors.NotFound);
          const joinRev = await execute("right", [
            "join",
            "--said",
            pendingRev.messages[0].exnSaid,
            "--auto",
            "--approval-timeout",
            "0",
          ], "multisig");
          assertEquals(joinRev.code, 0, new TextDecoder().decode(joinRev.stderr));
          const joinedRev = JSON.parse(new TextDecoder().decode(joinRev.stdout).trim().split("\n").at(-1)!);
          assertEquals(joinedRev.route, "/multisig/rev");
          assertEquals(joinedRev.accepted, true);
          const beforeRevDelivery = transmissions;
          const nonLeadRev = await revoke("right");
          assertEquals(nonLeadRev.accepted, true);
          assertEquals(nonLeadRev.deliveries, []);
          const completedRev = await revoke("left", ["--out", revocationPath]);
          assertEquals(completedRev.tel, pendingRev.tel);
          assertEquals(completedRev.accepted, true);
          assertEquals(completedRev.publicationComplete, true);
          assertEquals(completedRev.messages, pendingRev.messages);
          assertEquals(completedRev.deliveries.length > 0, true);
          assertEquals(transmissions > beforeRevDelivery, true);
          const holder = receivers.get("peer")!.runtime.vdr!;
          assertEquals(
            holder.tvy.tevers.get(holder.reger.creds.get(fixture.credential)!.regid!)!.vcState(fixture.credential)!.et,
            "rev",
          );
          const issuer = receivers.get("left")!.hby;
          const anchorSaid = issuer.db.getKever(fixture.group)!.said;
          const repeatedRev = await revoke("left");
          assertEquals(repeatedRev.tel, completedRev.tel);
          assertEquals(issuer.db.getKever(fixture.group)!.said, anchorSaid);
          for (const path of [revocationPath, fixture.issuedPath]) {
            const imported = await execute("verifier", ["import", "--in", path], "vc");
            assertEquals(imported.code, 0, new TextDecoder().decode(imported.stderr));
            const listed = await execute("verifier", ["list"], "vc");
            assertEquals(listed.code, 0, new TextDecoder().decode(listed.stderr));
            const row = new TextDecoder().decode(listed.stdout).trim().split("\n").map(line => JSON.parse(line))
              .find(row => row.said === fixture.credential);
            assertEquals(row.status, "rev", "Reopen and stale issuance replay must not revive a revoked credential");
          }
        });
      } finally {
        yield* call(() => server.shutdown());
        for (const runtime of runtimes.reverse()) yield* runtime.close();
        for (const hby of hbys.reverse()) yield* hby.close();
      }
    });
  } finally {
    await server.shutdown();
    await Deno.remove(headDirPath, { recursive: true });
  }
});
