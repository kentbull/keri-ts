/** Native CLI approval retains member custody through the real HTTP sender. */
import { createProtocolHandler } from "@keri-ts/hosting";
import { createWalletBaser, RegistryCustody } from "@keri-ts/wallet";
import { concatBytes, MtrDex, Salter } from "cesr-ts";
import { call, run, sleep, spawn } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { loadNests } from "keri-ts/db";
import {
  acdcV2RegistryProposal,
  approveAcdcV2Registry,
  createAgentRuntime,
  createHabery,
  EndpointRoles,
  FetchHttpClient,
  messagize,
  publishAcdcV2Registry,
  regcept,
  runAgentRuntime,
  systemClock,
} from "keri-ts/runtime";
import { runTufa } from "../test-helpers.ts";

Deno.test("tufa native registry join decrypts the selected proposal and persists custody after approval", async () => {
  const directory = await Deno.makeTempDir({ prefix: "native-registry-join-" });
  const passcode = "NativeRegistryJoinPasscode";
  try {
    await run(function*() {
      const left = yield* createHabery({
        name: "issuer-left",
        headDirPath: directory,
        skipConfig: true,
        bran: passcode,
      });
      const right = yield* createHabery({
        name: "issuer-right",
        headDirPath: directory,
        skipConfig: true,
        bran: passcode,
      });
      const receiver = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock);
      const joiner = yield* createAgentRuntime(right, new FetchHttpClient(), systemClock);
      const db = yield* createWalletBaser({ name: left.name, headDirPath: directory });
      const handler = createProtocolHandler(receiver);
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
      try {
        const alice = left.makeHab("alice"), bob = right.makeHab("bob");
        for (const wire of left.db.clonePreIter(alice.pre)) yield* joiner.reactor.processBytes(wire);
        for (const wire of right.db.clonePreIter(bob.pre)) yield* receiver.reactor.processBytes(wire);
        const mids = [alice.pre, bob.pre];
        const first = left.makeGroupHab("issuer", alice, mids, mids, undefined, { isith: "2", nsith: "2" });
        const second = right.makeGroupHab("issuer", bob, mids, mids, undefined, { isith: "2", nsith: "2" });
        const inception = messagize(first.serder, { sigers: [...first.sigers, ...second.sigers] });
        for (const runtime of [receiver, joiner]) yield* runtime.reactor.processBytes(inception, { local: true });
        // Authenticate the ordinary controller endpoint used for the approval's return trip.
        for (
          const wire of [
            alice.makeLocScheme(`http://127.0.0.1:${server.addr.port}`, alice.pre, "http"),
            alice.makeEndRole(alice.pre, EndpointRoles.controller, true),
          ]
        ) {
          yield* joiner.reactor.processBytes(wire);
        }
        const custody = new RegistryCustody({ hby: left, registry: receiver.acdc!.store, db });
        const root = new Salter({ code: MtrDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) });
        const salts = custody.sealMembers(first.hab, root), rip = regcept(first.hab.pre);
        const proposal = yield* approveAcdcV2Registry(left, receiver.protocol, first.hab, rip, { salts });
        yield* joiner.reactor.processBytes(concatBytes(proposal[0].raw, proposal[1]));
        yield* joiner.close();
        yield* right.close();
        const result = yield* call(() =>
          runTufa([
            "multisig",
            "join",
            "--v2",
            "--name",
            "issuer-right",
            "--head-dir",
            directory,
            "--passcode",
            passcode,
            "--group",
            "issuer",
            "--said",
            proposal[0].said!,
            "--auto",
            "--approval-timeout",
            "15",
          ])
        );
        assertEquals(result.code, 0, result.stderr);
        assertEquals(JSON.parse(result.stdout.trim().split("\n").at(-1)!).accepted, true);
        const reopened = yield* createHabery({
          name: "issuer-right",
          headDirPath: directory,
          skipConfig: true,
          bran: passcode,
        });
        const runtime = yield* createAgentRuntime(reopened, new FetchHttpClient(), systemClock);
        const received = yield* createWalletBaser({ name: reopened.name, headDirPath: directory });
        try {
          const retained = new RegistryCustody({ hby: reopened, registry: runtime.acdc!.store, db: received });
          custody.retainMemberCopy(rip.said!, first.hab, salts);
          assertEquals(
            retained.derive(rip.said!, 1, rip.said!, "issued"),
            custody.derive(rip.said!, 1, rip.said!, "issued"),
          );
        } finally {
          yield* received.close();
          yield* runtime.close();
          yield* reopened.close();
        }
      } finally {
        yield* call(() => server.shutdown());
        yield* call(() => handler.close?.());
        yield* db.close();
        yield* joiner.close();
        yield* right.close();
        yield* receiver.close();
        yield* left.close();
      }
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("tufa native group inception distributes one salt and refuses recreation", async () => {
  const directory = await Deno.makeTempDir({ prefix: "native-registry-author-" });
  const passcode = "NativeRegistryAuthorPasscode";
  try {
    await run(function*() {
      const left = yield* createHabery({ name: "author", headDirPath: directory, skipConfig: true, bran: passcode });
      const right = yield* createHabery({ name: "peer", headDirPath: directory, skipConfig: true, bran: passcode });
      const local = yield* createAgentRuntime(left, new FetchHttpClient(), systemClock);
      const remote = yield* createAgentRuntime(right, new FetchHttpClient(), systemClock, { enableMailboxStore: true });
      const db = yield* createWalletBaser({ name: right.name, headDirPath: directory });
      const handler = createProtocolHandler(remote);
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
      let workers;
      try {
        const alice = left.makeHab("alice"), bob = right.makeHab("bob");
        for (const wire of left.db.clonePreIter(alice.pre)) yield* remote.reactor.processBytes(wire);
        for (const wire of right.db.clonePreIter(bob.pre)) yield* local.reactor.processBytes(wire);
        const mids = [alice.pre, bob.pre];
        const a = left.makeGroupHab("issuer", alice, mids, mids, undefined, { isith: "2", nsith: "2" });
        const b = right.makeGroupHab("issuer", bob, mids, mids, undefined, { isith: "2", nsith: "2" });
        for (const runtime of [local, remote]) {
          yield* runtime.reactor.processBytes(messagize(a.serder, { sigers: [...a.sigers, ...b.sigers] }), {
            local: true,
          });
        }
        const routes = [
          bob.makeLocScheme(`http://127.0.0.1:${server.addr.port}`),
          bob.makeEndRole(bob.pre, EndpointRoles.controller, true),
          alice.makeEndRole(bob.pre, EndpointRoles.mailbox, true),
        ];
        for (const runtime of [local, remote]) for (const wire of routes) yield* runtime.reactor.processBytes(wire);
        yield* local.close();
        yield* left.close();
        workers = yield* spawn(() => runAgentRuntime(remote, { hab: bob }));
        const command = [
          "vc",
          "registry",
          "incept",
          "--acdc-v2",
          "--with-custody",
          "--name",
          "author",
          "--head-dir",
          directory,
          "--passcode",
          passcode,
          "--alias",
          "issuer",
          "--registry-name",
          "private",
          "--timeout",
          "15",
        ];
        const author = yield* spawn(() => call(() => runTufa(command)));
        const deadline = Date.now() + 10_000;
        let said: string | undefined;
        while (!said && Date.now() < deadline) {
          const note = remote.notifier?.list(0, 100).find((note) => note.attrs.r === "/multisig/rip");
          if (note && typeof note.attrs.d === "string") said = note.attrs.d;
          if (!said) yield* sleep(25);
        }
        if (!said) throw new Error("Native inception proposal did not arrive");
        const wrapper = right.db.exns.get([said])!;
        const selected = acdcV2RegistryProposal(wrapper, loadNests(right.db, said))!;
        const custody = new RegistryCustody({ hby: right, registry: remote.acdc!.store, db });
        custody.openMemberCopy(b.hab, selected.salts!);
        const approval = yield* approveAcdcV2Registry(right, remote.protocol, b.hab, selected.tel, {
          anchor: selected.anchor,
          salts: selected.salts,
        });
        yield* publishAcdcV2Registry(right, remote.postman, b.hab, approval);
        custody.retainMemberCopy(selected.tel.said!, b.hab, selected.salts!);
        const result = yield* author;
        assertEquals(result.code, 0, result.stderr);
        const regid = JSON.parse(result.stdout.trim().split("\n").at(-1)!).registry;
        assertEquals(regid, selected.tel.said);
        const again = yield* call(() => runTufa(command));
        assertEquals(again.code === 0, false);
        assertEquals(again.stderr.includes("retained proposal"), true, again.stderr);
        const reopened = yield* createHabery({
          name: "author",
          headDirPath: directory,
          skipConfig: true,
          bran: passcode,
        });
        const runtime = yield* createAgentRuntime(reopened, new FetchHttpClient(), systemClock);
        const retainedDb = yield* createWalletBaser({ name: reopened.name, headDirPath: directory });
        try {
          const retained = new RegistryCustody({ hby: reopened, registry: runtime.acdc!.store, db: retainedDb });
          assertEquals(retained.derive(regid, 7, regid, "revoked"), custody.derive(regid, 7, regid, "revoked"));
        } finally {
          yield* retainedDb.close();
          yield* runtime.close();
          yield* reopened.close();
        }
      } finally {
        if (workers) yield* workers.halt();
        yield* call(() => server.shutdown());
        yield* call(() => handler.close?.());
        yield* db.close();
        yield* local.close();
        yield* left.close();
        yield* remote.close();
        yield* right.close();
      }
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
