/** Real member processes approve one salt reply through the existing mailbox. */
import { startServer } from "@keri-ts/hosting";
import { RegistryCustody } from "@keri-ts/wallet";
import { concatBytes, Counter, Vrsn_2_0 } from "cesr-ts";
import { call, run, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  approveAcdcV2Registry,
  createAgentRuntime,
  createHabery,
  EndpointRoles,
  FetchHttpClient,
  messagize,
  regcept,
  runAgentRuntime,
  systemClock,
} from "keri-ts/runtime";
import { acdcV2RegistryProposal } from "../../../keri/src/app/multisig/grouping.ts";
import { loadNests } from "../../../keri/src/db/exchange/exchange-nests.ts";
import { reserveTcpPort, runTufa, spawnTufa, waitForServer } from "../test-helpers.ts";

Deno.test("tufa group salt reply collects two of three approvals over the mailbox", async () => {
  const root = await Deno.makeTempDir({ prefix: "salt-group-processes-" });
  const passcode = "GroupRegistrySaltCliPasscode";
  try {
    await run(function* () {
      const hby = yield* createHabery({ name: "mailbox", headDirPath: root, skipConfig: true });
      const provider = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
      const mailbox = hby.makeHab("mailbox", undefined, { transferable: false });
      const port = reserveTcpPort();
      const location = mailbox.makeLocScheme(`http://127.0.0.1:${port}`, mailbox.pre, "http");
      const identities = [], runtimes = [];
      try {
        for (let index = 0; index < 3; index++) {
          const owner = yield* createHabery({
            name: `member-${index}`,
            headDirPath: root,
            bran: passcode,
            skipConfig: true,
          });
          identities.push(owner);
          runtimes.push(yield* createAgentRuntime(owner, new FetchHttpClient(), systemClock));
        }
        const members = identities.map((owner) => owner.makeHab("member"));
        const bootstrap = [
          location,
          ...hby.db.clonePreIter(mailbox.pre),
          ...identities.flatMap((owner, index) => [...owner.db.clonePreIter(members[index].pre)]),
          ...members.map((member) => member.makeEndRole(mailbox.pre, EndpointRoles.mailbox, true)),
        ];
        for (const runtime of [provider, ...runtimes]) {
          for (const wire of bootstrap) yield* runtime.reactor.processBytes(wire);
        }
        const mids = members.map((member) => member.pre);
        const groups = identities.slice(0, 2).map((owner, index) =>
          owner.makeGroupHab("issuer", members[index], mids, mids, undefined, { isith: "2", nsith: "2" })
        );
        const inception = messagize(groups[0].serder, { sigers: [...groups[0].sigers, ...groups[1].sigers] });
        for (const runtime of runtimes) yield* runtime.reactor.processBytes(inception, { local: true });
        const rip = regcept(groups[0].hab.pre);
        const first = yield* approveAcdcV2Registry(identities[0], runtimes[0].protocol, groups[0].hab, rip);
        yield* runtimes[1].reactor.processBytes(concatBytes(first[0].raw, first[1]));
        const proposal = acdcV2RegistryProposal(first[0], loadNests(identities[1].db, first[0].said!))!;
        const second = yield* approveAcdcV2Registry(identities[1], runtimes[1].protocol, groups[1].hab, rip, {
          anchor: proposal.anchor,
        });
        yield* runtimes[0].reactor.processBytes(concatBytes(second[0].raw, second[1]));
        for (const runtime of runtimes.slice(0, 2)) yield* runtime.protocol.processEscrowsOnce();
        const custody = new RegistryCustody({ hby: identities[0], registry: runtimes[0].acdc!.store });
        custody.createCustody(rip.said!, members[2].pre);
        const expected = custody.derive(rip.said!, 17, rip.said!, "revoked");
        const evidence = concatBytes(
          Counter.makeGVC(Vrsn_2_0),
          ...identities[0].db.clonePreIter(groups[0].hab.pre, 0, Vrsn_2_0),
          runtimes[0].acdc!.store.cloneTel(rip.said!),
        );
        yield* call(() => Deno.writeFile(`${root}/evidence.cesr`, evidence));
        // Independent CLI owners reopen the actual stores; the third member stays offline.
        for (const runtime of runtimes) yield* runtime.close();
        for (const owner of identities) yield* owner.close();
        runtimes.length = 0;
        identities.length = 0;
        const server = yield* spawn(() => startServer(port, undefined, provider));
        yield* waitForServer(port);
        const worker = yield* spawn(() => runAgentRuntime(provider, { hab: mailbox }));
        const storeArgs = (index: number) => ["--name", `member-${index}`, "--head-dir", root, "--passcode", passcode];
        const child = spawnTufa([
          "vc",
          "registry",
          "salt",
          "send",
          ...storeArgs(0),
          "--alias",
          "issuer",
          "--registry",
          rip.said!,
          "--party",
          members[2].pre,
          "--output",
          `${root}/reply.cesr`,
          "--timeout",
          "15",
        ]);
        const stderr = new Response(child.stderr).text();
        const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("No salt proposal")), 15000);
          });
          let text = "", selected: string | undefined;
          while (!selected) {
            const next = yield* call(() => Promise.race([reader.read(), deadline]));
            if (next.done) throw new Error(`Sender exited before proposal: ${text} ${yield* call(() => stderr)}`);
            text += next.value;
            for (const line of text.split("\n")) {
              if (!line.startsWith('{"proposals":') || !line.endsWith("}")) continue;
              selected = JSON.parse(line).proposals.find((entry: { recipient: string }) =>
                entry.recipient === members[1].pre
              )?.exnSaid;
              if (selected) break;
            }
          }
          clearTimeout(timer);
          const approved = yield* call(() =>
            runTufa([
              "multisig",
              "join",
              "--v2",
              ...storeArgs(1),
              "--group",
              "issuer",
              "--said",
              selected!,
              "--auto",
              "--approval-timeout",
              "12",
            ])
          );
          assertEquals(approved.code, 0, approved.stderr);
          assertEquals(JSON.parse(approved.stdout.trim().split("\n").at(-1)!).approved, true);
          while (!(yield* call(() => reader.read())).done) { /* Drain ordinary progress output. */ }
          assertEquals((yield* call(() => child.status)).code, 0, yield* call(() => stderr));
          const received = yield* call(() =>
            runTufa([
              "vc",
              "registry",
              "salt",
              "receive",
              ...storeArgs(2),
              "--alias",
              "member",
              "--registry",
              rip.said!,
              "--evidence",
              `${root}/evidence.cesr`,
              "--input",
              `${root}/reply.cesr`,
            ])
          );
          assertEquals(received.code, 0, received.stderr);
          const recipient = yield* createHabery({
            name: "member-2",
            headDirPath: root,
            bran: passcode,
            skipConfig: true,
          });
          const recipientRuntime = yield* createAgentRuntime(recipient, new FetchHttpClient(), systemClock);
          try {
            assertEquals(
              new RegistryCustody({ hby: recipient, registry: recipientRuntime.acdc!.store })
                .derive(rip.said!, 17, rip.said!, "revoked"),
              expected,
            );
          } finally {
            yield* recipientRuntime.close();
            yield* recipient.close();
          }
        } finally {
          clearTimeout(timer);
          try {
            child.kill("SIGTERM");
          } catch { /* Already exited. */ }
          yield* call(() => child.status);
          yield* call(() => stderr);
          reader.releaseLock();
          yield* worker.halt();
          yield* server.halt();
        }
      } finally {
        for (const runtime of runtimes) yield* runtime.close();
        for (const owner of identities) yield* owner.close();
        yield* provider.close();
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});
