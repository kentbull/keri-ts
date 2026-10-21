/** Public CLI group conversation authoring and exact approval resume over real HTTP intake. */
import { call, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { concatBytes } from "../../../../cesr/mod.ts";
import { createAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { readCesrRequestBytes } from "../../../src/app/cesr-http.ts";
import { createExchangeMessage } from "../../../src/app/exchange-messaging.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { messagize } from "../../../src/core/protocol-serialization.ts";
import { incept as registryIncept } from "../../../src/core/protocol-vdr-eventing.ts";
import { credential } from "../../../src/vdr/credentialing.ts";

Deno.test("IPEX group CLI authors apply, offer, agree and spurn through independent member stores", async () => {
  const headDirPath = await Deno.makeTempDir({ prefix: "ipex-group-cli-" });
  const stores = ["left", "right", "peer"];
  let transmissions = 0;
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async request => {
    const name = new URL(request.url).pathname.slice(1);
    if (!stores.includes(name)) return new Response(null, { status: 404 });
    transmissions++;
    const bytes = await readCesrRequestBytes(request);
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
        return { peer: peer.pre, other: members[1].pre, path, offer: offer.serder.said!, apply: apply.serder.said! };
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
    for (
      const [verb, args] of [
        ["apply", ["--schema", fixture.peer]],
        ["offer", ["--acdc", fixture.path]],
        ["agree", ["--offer", fixture.offer]],
        ["spurn", ["--prior", fixture.apply]],
      ] as const
    ) {
      const authored = await command("left", [
        verb,
        "--alias",
        "group",
        "--recipient",
        fixture.peer,
        "--approval-timeout",
        "0",
        ...args,
      ]);
      assertEquals(authored.status, "multisig-pending");
      assertEquals(authored.messages.length, 1);
      const selected = authored.messages[0].exnSaid;
      const joined = await command("right", ["join", "--said", selected, "--auto"]);
      assertEquals(joined.status, "multisig-approved");
      const completed = await command("left", ["join", "--said", selected, "--auto"]);
      assertEquals(completed.status, "multisig-approved");
      assertEquals(completed.lead, true);
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
  } finally {
    await server.shutdown();
    await Deno.remove(headDirPath, { recursive: true });
  }
});
