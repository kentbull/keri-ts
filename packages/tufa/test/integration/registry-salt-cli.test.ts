/** Separate Tufa processes exchange signed ciphertext using Keeper-owned salts. */
import { RegistryCustody } from "@keri-ts/wallet";
import { concatBytes, Counter, Vrsn_2_0 } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { createAgentRuntime, createHabery, FetchHttpClient, systemClock } from "keri-ts/runtime";
import { runTufa, spawnTufa } from "../test-helpers.ts";

Deno.test("tufa salt replies retain matching derivation across separate commands", async () => {
  const directory = await Deno.makeTempDir({ prefix: "salt-cli-" });
  const passcode = "RegistrySaltCliPasscode";
  try {
    const fixture = await run(function* () {
      const issuer = yield* createHabery({ name: "issuer", headDirPath: directory, bran: passcode, skipConfig: true });
      const holder = yield* createHabery({ name: "holder", headDirPath: directory, bran: passcode, skipConfig: true });
      const runtime = yield* createAgentRuntime(issuer, new FetchHttpClient(), systemClock);
      try {
        const author = issuer.makeHab("issuer"), recipient = holder.makeHab("holder");
        for (const wire of holder.db.clonePreIter(recipient.pre)) yield* runtime.reactor.processBytes(wire);
        const registry = runtime.acdc!.makeRegistry("shared", author.pre);
        const rip = runtime.acdc!.store.event(registry.regk!)!;
        author.interact({ data: [{ i: registry.regk, s: "0", d: rip.said }] });
        assertEquals(registry.anchorMsg(rip.said!).kind, "accept");
        const custody = new RegistryCustody({ hby: issuer, registry: runtime.acdc!.store });
        custody.createCustody(registry.regk!, recipient.pre);
        const evidence = concatBytes(
          Counter.makeGVC(Vrsn_2_0),
          ...issuer.db.clonePreIter(author.pre, 0, Vrsn_2_0),
          ...holder.db.clonePreIter(recipient.pre, 0, Vrsn_2_0),
          runtime.acdc!.store.cloneTel(registry.regk!),
        );
        yield* call(() => Deno.writeFile(`${directory}/evidence.cesr`, evidence));
        return {
          registry: registry.regk!,
          recipient: recipient.pre,
          opening: custody.derive(registry.regk!, 17, rip.said!, "revoked"),
        };
      } finally {
        yield* runtime.close();
        yield* holder.close();
        yield* issuer.close();
      }
    });
    const args = (
      name: string,
      operation: string,
    ) => [
      "vc",
      "registry",
      "salt",
      operation,
      "--name",
      name,
      "--alias",
      name,
      "--head-dir",
      directory,
      "--passcode",
      passcode,
      "--registry",
      fixture.registry,
    ];
    const reply = `${directory}/salt.cesr`;
    const sent = await runTufa([
      ...args("issuer", "send"),
      "--party",
      fixture.recipient,
      "--evidence",
      `${directory}/evidence.cesr`,
      "--output",
      reply,
    ]);
    assertEquals(sent.code, 0, sent.stderr);
    assertEquals(JSON.parse(sent.stdout).submitted, false);
    const server = spawnTufa([...args("holder", "serve"), "--port", "0", "--evidence", `${directory}/evidence.cesr`]);
    const errors = new Response(server.stderr).text();
    const reader = server.stdout.pipeThrough(new TextDecoderStream()).getReader();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Salt listener did not start")), 15000);
      });
      let text = "", port: number | undefined;
      while (port === undefined) {
        const chunk = await Promise.race([reader.read(), timeout]);
        if (chunk.done) throw new Error(`Salt listener stopped: ${text}`);
        text += chunk.value;
        for (const line of text.split("\n")) {
          if (line.startsWith('{"listening":') && line.endsWith("}")) port = JSON.parse(line).listening.port;
        }
      }
      clearTimeout(timer);
      const submitted = await runTufa([
        ...args("issuer", "send"),
        "--party",
        fixture.recipient,
        "--essr",
        "--endpoint",
        `http://127.0.0.1:${port}/`,
        "--timeout",
        "5",
      ]);
      assertEquals(submitted.code, 0, submitted.stderr);
      assertEquals(JSON.parse(submitted.stdout).submitted, true);
    } finally {
      clearTimeout(timer);
      server.kill("SIGTERM");
      // Drain output while the existing server owner joins listener/worker cleanup.
      while (!(await reader.read()).done) { /* diagnostic output only */ }
      reader.releaseLock();
      assertEquals((await server.status).code, 0, await errors);
    }
    // Reopen after HTTP delivery: successful submission alone is not acceptance.
    const delivered = await runTufa(args("holder", "status"));
    assertEquals(delivered.code, 0, delivered.stderr);
    assertEquals(JSON.parse(delivered.stdout).custody_present, true);
    const received = await runTufa([
      ...args("holder", "receive"),
      "--evidence",
      `${directory}/evidence.cesr`,
      "--input",
      reply,
    ]);
    assertEquals(received.code, 0, received.stderr);
    assertEquals(JSON.parse(received.stdout).custody_present, true);
    const status = await runTufa(args("holder", "status"));
    assertEquals(status.code, 0, status.stderr);
    assertEquals(JSON.parse(status.stdout).custody_present, true);
    const refused = await runTufa([...args("issuer", "send"), "--party", fixture.recipient, "--output", reply]);
    assertEquals(refused.code === 0, false);
    await run(function* () {
      const hby = yield* createHabery({ name: "holder", headDirPath: directory, bran: passcode, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const custody = new RegistryCustody({ hby, registry: runtime.acdc!.store });
        assertEquals(custody.derive(fixture.registry, 17, fixture.registry, "revoked"), fixture.opening);
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("tufa group salt send emits a threshold-verified reply", async () => {
  const directory = await Deno.makeTempDir({ prefix: "group-salt-cli-" });
  const passcode = "GroupRegistrySaltCliPasscode";
  try {
    const fixture = await run(function* () {
      const hby = yield* createHabery({ name: "group", headDirPath: directory, bran: passcode, skipConfig: true });
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        const member = hby.makeHab("member"), holder = hby.makeHab("holder");
        // One current signer is a valid group threshold. The separate wallet
        // fixture covers insufficient and sufficient two-of-three signatures.
        const group = hby.makeGroupHab("issuer", member, [member.pre], [member.pre], undefined, {
          isith: "1",
          nsith: "1",
        });
        const registry = runtime.acdc!.makeRegistry("shared", group.hab.pre);
        const rip = runtime.acdc!.store.event(registry.regk!)!;
        hby.interactGroupHab("issuer", undefined, { data: [{ i: registry.regk, s: "0", d: rip.said }] });
        assertEquals(registry.anchorMsg(rip.said!).kind, "accept");
        const custody = new RegistryCustody({ hby, registry: runtime.acdc!.store });
        custody.createCustody(registry.regk!, holder.pre);
        return { registry: registry.regk!, recipient: holder.pre };
      } finally {
        yield* runtime.close();
        yield* hby.close();
      }
    });
    const output = `${directory}/group-reply.cesr`;
    const sent = await runTufa([
      "vc",
      "registry",
      "salt",
      "send",
      "--name",
      "group",
      "--alias",
      "issuer",
      "--head-dir",
      directory,
      "--passcode",
      passcode,
      "--registry",
      fixture.registry,
      "--party",
      fixture.recipient,
      "--output",
      output,
      "--timeout",
      "2",
    ]);
    assertEquals(sent.code, 0, sent.stderr);
    assertEquals(JSON.parse(sent.stdout).submitted, false);
    assertEquals((await Deno.readFile(output)).length > 0, true);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
