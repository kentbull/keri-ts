/** Public CLI group conversation authoring and exact approval resume over real HTTP intake. */
import { call, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { concatBytes, Diger, parseBytes, Prefixer, Seqner, SerderKERI, Vrsn_1_0 } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { createExchangeMessage } from "../../../src/app/exchange-messaging.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { attachmentCounterPayloadQb64b } from "../../../src/core/attachment-countering.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { incept as registryIncept, issue as credentialIssue } from "../../../src/core/protocol-vdr-eventing.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { credential, serializeCredential } from "../../../src/vdr/credentialing.ts";

Deno.test("IPEX group CLI authors conversations and grants through independent member stores", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "ipex-group-cli-" });
  const stores = ["left", "right", "peer"];
  let transmissions = 0;
  let businessDeliveries = 0;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async request => {
    const name = new URL(request.url).pathname.slice(1);
    if (!stores.includes(name)) return new Response(null, { status: 404 });
    transmissions++;
    const bytes = await readCesrRequestBytes(request);
    if (name === "peer") {
      businessDeliveries += parseBytes(bytes).filter(frame =>
        frame.body instanceof SerderKERI && frame.body.route?.startsWith("/ipex/")
      ).length;
    }
    await run(function*() {
      const hby = yield* createHabery({ name, headDirPath, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        yield* runtime.reactor.processBytes(bytes);
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
    return new Response(null, { status: 204 });
  });
  const root = new URL("../../../../../", import.meta.url).pathname;
  async function execute(name: string, args: string[]) {
    return await new Deno.Command(Deno.execPath(), {
      cwd: root,
      args: ["run", "-A", "packages/tufa/mod.ts", "ipex", ...args, "--name", name, "--head-dir", headDirPath],
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
      messages: { exnSaid: string }[];
      saved?: string[];
      deliveries: string[];
    };
  }
  try {
    const fixture = await run(function*() {
      const hbys = [];
      for (const name of stores) hbys.push(yield* createHabery({ name, headDirPath, skipConfig: true }));
      const runtimes = [];
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
        const schema = new Schemer({ sed: { $id: "", type: "object" } });
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
      if (verb === "grant") await assertRejects(() => Deno.stat(output), Deno.errors.NotFound);
      assertEquals(authored.status, "multisig-pending");
      assertEquals(authored.messages.length, 1);
      const selected = authored.messages[0].exnSaid;
      const beforeDelivery = businessDeliveries;
      const joined = await command("right", ["join", "--said", selected, "--auto"]);
      assertEquals(joined.status, "multisig-approved");
      assertEquals(joined.lead, false);
      assertEquals(businessDeliveries, beforeDelivery, "The other member must only fan out approval");
      const completed = await command("left", ["join", "--said", selected, "--auto"]);
      assertEquals(completed.status, "multisig-approved");
      assertEquals(completed.lead, true);
      assertEquals(businessDeliveries, beforeDelivery + 1, "The elected member sends the business EXN once");
      await run(function*() {
        const hby = yield* createHabery({ name: "peer", headDirPath, skipConfig: true });
        try {
          const received = hby.db.exns.get([authored.said]);
          assertExists(received);
          assertEquals(received.route, `/ipex/${verb}`);
        } finally {
          yield* hby.close();
        }
      });
    }
    const settled = await command("peer", ["poll", "--alias", "member", "--timeout", "0"]);
    assertEquals(settled.saved, [fixture.credential]);
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
    await run(function*() {
      const hby = yield* createHabery({ name: "peer", headDirPath, skipConfig: true });
      try {
        const grant = hby.db.exns.get([exported.said]);
        assertExists(grant);
        assertEquals(grant.pre, fixture.peer);
        assertEquals(grant.ked?.a, { m: "", i: fixture.other });
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await server.shutdown();
    await Deno.remove(headDirPath, { recursive: true });
  }
});
