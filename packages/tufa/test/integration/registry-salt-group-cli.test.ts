/** Real member processes approve one salt reply through the existing mailbox. */
import { startServer } from "@keri-ts/hosting";
import { RegistryCustody, RegistrySaltService } from "@keri-ts/wallet";
import { concatBytes, Counter, Vrsn_2_0 } from "cesr-ts";
import { call, run, sleep, spawn } from "effection";
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
import { acdcmap, blindate } from "../../../keri/src/acdc/messaging.ts";
import { acdcV2RegistryProposal } from "../../../keri/src/app/multisig/grouping.ts";
import { loadNests } from "../../../keri/src/db/exchange/exchange-nests.ts";
import { reserveTcpPort, runTufa, spawnTufa, waitForServer } from "../test-helpers.ts";

/** Exercise manual reply approval and the application-triggered rotation handoff. */
async function groupSaltFlow(automatic: boolean) {
  const root = await Deno.makeTempDir({ prefix: "salt-group-processes-" });
  const passcode = "GroupRegistrySaltCliPasscode";
  try {
    await run(function*() {
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
        const allMembers = members.map((member) => member.pre);
        const mids = automatic ? allMembers.slice(0, 2) : allMembers;
        const recipientPort = reserveTcpPort();
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
        if (automatic) {
          // Fixture RIP approvals were already performed explicitly above. Clear
          // only their notices so ordinary join selects the new rotation.
          for (const runtime of runtimes.slice(0, 2)) {
            for (const notice of runtime.notifier!.list(0, 100)) {
              if ([first[0].said, second[0].said].includes(notice.attrs.d as string)) {
                runtime.notifier!.remove(notice.rid);
              }
            }
          }
          for (const index of [0, 1]) {
            members[index].rotate();
            for (const runtime of [provider, ...runtimes]) {
              for (const wire of identities[index].db.clonePreIter(members[index].pre)) {
                yield* runtime.reactor.processBytes(wire, { local: true });
              }
            }
          }
        }
        // Independent CLI owners reopen the actual stores; the third member stays offline.
        for (const runtime of runtimes) yield* runtime.close();
        for (const owner of identities) yield* owner.close();
        runtimes.length = 0;
        identities.length = 0;
        const server = yield* spawn(() => startServer(port, undefined, provider));
        yield* waitForServer(port);
        const worker = yield* spawn(() => runAgentRuntime(provider, { hab: mailbox }));
        const storeArgs = (index: number) => ["--name", `member-${index}`, "--head-dir", root, "--passcode", passcode];
        const rotationArgs = [
          "multisig",
          "rotate",
          ...storeArgs(0),
          "--group",
          "issuer",
          ...allMembers.flatMap((member) => ["--smids", member]),
          ...allMembers.flatMap((member) => ["--rmids", member]),
          "--isith",
          "2",
          "--nsith",
          "2",
        ];
        const child = spawnTufa(
          automatic ? rotationArgs : [
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
          ],
        );
        const stderr = new Response(child.stderr).text();
        const reader = child.stdout.pipeThrough(new TextDecoderStream()).getReader();
        let timer: ReturnType<typeof setTimeout> | undefined;
        let recipientServer: import("effection").Task<void> | undefined;
        let recipientWorker: import("effection").Task<void> | undefined;
        try {
          if (automatic) {
            const rotationApproval = yield* call(() =>
              runTufa([
                "multisig",
                "join",
                ...storeArgs(1),
                "--group",
                "issuer",
                "--auto",
                "--approval-timeout",
                "12",
              ])
            );
            assertEquals(rotationApproval.code, 0, rotationApproval.stderr);
            const joined = JSON.parse(rotationApproval.stdout.trim().split("\n").at(-1)!);
            assertEquals(joined.route, "/multisig/rot");
            assertEquals(joined.accepted, true);
            const approver = yield* createHabery({
              name: "member-1",
              headDirPath: root,
              bran: passcode,
              skipConfig: true,
            });
            const newcomer = yield* createHabery({
              name: "member-2",
              headDirPath: root,
              bran: passcode,
              skipConfig: true,
            });
            identities.push(newcomer);
            const receiver = yield* createAgentRuntime(newcomer, new FetchHttpClient(), systemClock);
            runtimes.push(receiver);
            try {
              for (const wire of approver.db.clonePreIter(groups[0].hab.pre, 0, Vrsn_2_0)) {
                yield* receiver.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire));
              }
            } finally {
              yield* approver.close();
            }
            const member = newcomer.habByName("member")!;
            newcomer.joinGroupHab(groups[0].hab.pre, "issuer", member, allMembers, allMembers);
            const salts = new RegistrySaltService(
              new RegistryCustody({ hby: newcomer, registry: receiver.acdc!.store }),
              receiver.protocol.rvy,
            );
            salts.register();
            salts.registerEnvelope(member, receiver.exc, receiver.reactor);
            assertEquals(newcomer.ks.custody.get(rip.said!), null);
            recipientServer = yield* spawn(() => startServer(recipientPort, undefined, receiver));
            yield* waitForServer(recipientPort);
            recipientWorker = yield* spawn(() => runAgentRuntime(receiver, { hab: member, pollMailbox: true }));
          }
          const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("No salt proposal")), 15000);
          });
          let text = "", selected: string | undefined;
          while (!selected) {
            const next = yield* call(() => Promise.race([reader.read(), deadline]));
            if (next.done) throw new Error(`Sender exited before proposal: ${text} ${yield* call(() => stderr)}`);
            text += next.value;
            for (const line of text.split("\n")) {
              if (!line.startsWith("{\"proposals\":") || !line.endsWith("}")) continue;
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
          if (automatic) {
            const until = performance.now() + 12000;
            while (!identities[0].ks.custody.get(rip.said!) && performance.now() < until) yield* sleep(100);
            assertEquals(identities[0].ks.custody.get(rip.said!) !== null, true);
            // Close the real receiver before proving durable custody by reopening below.
            yield* recipientWorker!.halt();
            yield* recipientServer!.halt();
            recipientWorker = recipientServer = undefined;
            yield* runtimes.pop()!.close();
            yield* identities.pop()!.close();
          }
          const received = automatic ? { code: 0, stderr: "" } : yield* call(() =>
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
            if (automatic) {
              // Member 1 stays offline. Issuance requires member 0 plus the
              // newcomer at signing index 2; salt receipt alone is insufficient.
              const lead = yield* createHabery({
                name: "member-0",
                headDirPath: root,
                bran: passcode,
                skipConfig: true,
              });
              const leadRuntime = yield* createAgentRuntime(lead, new FetchHttpClient(), systemClock);
              try {
                const credential = acdcmap(groups[0].hab.pre, {
                  regid: rip.said!,
                  attribute: { d: "", i: members[1].pre, name: "Newcomer issuance" },
                });
                const opening = new RegistryCustody({ hby: recipient, registry: recipientRuntime.acdc!.store })
                  .derive(rip.said!, 1, credential.said!, "issued");
                const update = blindate(rip.said!, rip.said!, opening.d.nonce);
                const proposed = yield* approveAcdcV2Registry(
                  lead,
                  leadRuntime.protocol,
                  lead.habByName("issuer")!,
                  update,
                  { opening },
                );
                assertEquals(leadRuntime.acdc!.store.head(rip.said!)?.qb64, rip.said);
                yield* recipientRuntime.reactor.processBytes(concatBytes(proposed[0].raw, proposed[1]));
                const exact = acdcV2RegistryProposal(proposed[0], loadNests(recipient.db, proposed[0].said!))!;
                const approved = yield* approveAcdcV2Registry(
                  recipient,
                  recipientRuntime.protocol,
                  recipient.habByName("issuer")!,
                  update,
                  { anchor: exact.anchor, opening },
                );
                yield* leadRuntime.reactor.processBytes(concatBytes(approved[0].raw, approved[1]));
                for (const runtime of [leadRuntime, recipientRuntime]) {
                  yield* runtime.protocol.processEscrowsOnce();
                  assertEquals(runtime.acdc!.store.head(rip.said!)?.qb64, update.said);
                }
              } finally {
                yield* leadRuntime.close();
                yield* lead.close();
              }
            }
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
          if (recipientWorker) yield* recipientWorker.halt();
          if (recipientServer) yield* recipientServer.halt();
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
}
Deno.test("tufa group salt reply collects two of three approvals over the mailbox", () => groupSaltFlow(false));
Deno.test("tufa accepted rotation automatically provisions a newcomer through multisync v2", () => groupSaltFlow(true));
