/** Registry anchor resume after a crash, and direct approval of iss, rev and bup proposals. */
import { concatBytes, makeBlindState, SerderKERI } from "cesr-ts";
import { call, run } from "effection";
import { assertEquals, assertRejects } from "jsr:@std/assert";
import {
  acdcmap as acdcV2Map,
  blindate as acdcV2Blindate,
  regcept as acdcV2Regcept,
} from "../../../../src/acdc/messaging.ts";
import { revokeCredential } from "../../../../src/app/credentials/credential-revoking.ts";
import { createCredential, inceptCredentialRegistry } from "../../../../src/app/credentials/credential-workflows.ts";
import type { GroupEventRef } from "../../../../src/app/multisig/counseling.ts";
import { approveAcdcV2Registry } from "../../../../src/app/multisig/multisig-workflows.ts";
import { approveGroupProposal } from "../../../../src/app/multisig/proposals.ts";
import { proposeRegistryEvent } from "../../../../src/app/multisig/proposing.ts";
import { Reactor } from "../../../../src/app/protocol/reactor.ts";
import { Schemer } from "../../../../src/core/scheming.ts";
import { depsFor, type Pair, pair, ripProposal } from "./registry-fixture.ts";

/** Record what a runtime publishes as a stream, without delivering it. */
function capture(runtime: Pair["receiver"], sink: Uint8Array[]) {
  runtime.postman.sendStream =
    ((evt: { msgs: Uint8Array[] }) => (sink.push(...evt.msgs), { ...evt, kin: "msg" })) as never;
}

Deno.test("a registry proposal resumes its anchor from recorded signatures after a crash", async () => {
  await run(function*() {
    yield* pair("2", function*(p) {
      let signs = 0;
      const sign = p.alice.mgr.sign.bind(p.alice.mgr);
      p.alice.mgr.sign = ((...args: Parameters<typeof sign>) => {
        if ((args[1] as { indices?: number[] } | undefined)?.indices) signs++;
        return sign(...args);
      }) as typeof sign;
      const deps = depsFor(p.left, p.receiver, []);
      const rip = acdcV2Regcept(p.group.pre);
      const original = Reactor.prototype.processBytes;
      let calls = 0;
      Reactor.prototype.processBytes = function*(this: Reactor, bytes: Uint8Array, options?: { local?: boolean }) {
        // tel, own anchor, then the wrapper: crash after signing and before the wrapper is stored.
        if (++calls === 3) throw new Error("crash before the wrapper is stored");
        return yield* original.call(this, bytes, options);
      } as typeof original;
      try {
        yield* call(() =>
          assertRejects(() => run(() => proposeRegistryEvent(deps, p.group, rip)), Error, "crash before")
        );
      } finally {
        Reactor.prototype.processBytes = original;
      }
      const afterCrash = signs;
      const result = yield* proposeRegistryEvent(deps, p.group, rip);
      assertEquals(signs, afterCrash, "the recorded anchor signature is reused");
      assertEquals(result.event.sn, 1);
    });
  });
});

Deno.test("approveGroupProposal approves a bup proposal and counsels its anchor", async () => {
  await run(function*() {
    yield* pair("2", function*(p) {
      const toSender: Uint8Array[] = [], toReceiver: Uint8Array[] = [];
      const left = depsFor(p.left, p.receiver, []);
      const started: GroupEventRef[] = [];
      const right = depsFor(p.right, p.sender, started);
      capture(p.receiver, toSender);
      capture(p.sender, toReceiver);
      // The registry exists on both sides first.
      const { rip, anchor, wrapper, candidate } = ripProposal(p);
      yield* p.receiver.exc.processEvent(candidate);
      yield* approveGroupProposal(left, wrapper.said!);
      yield* p.sender.reactor.processBytes(toSender[0]);
      const [peer, peerFoot] = yield* approveAcdcV2Registry(
        p.right,
        p.sender.protocol,
        p.right.habs.get(p.group.pre)!,
        rip,
        {
          anchor,
        },
      );
      yield* p.receiver.reactor.processBytes(concatBytes(peer.raw, peerFoot));
      assertEquals(p.sender.acdc!.store.head(rip.said!)?.qb64, rip.said);

      const credential = acdcV2Map(p.group.pre, {
        regid: rip.said!,
        attribute: { d: "", i: p.alice.pre, role: "group holder" },
      });
      const opening = makeBlindState({ acdc: credential.said!, state: "issued", sn: 1n });
      const update = acdcV2Blindate(rip.said!, rip.said!, opening.d.nonce, { sn: 1 });
      const proposed = yield* proposeRegistryEvent(
        { ...right, registryStore: p.sender.acdc!.store },
        p.right.habs.get(p.group.pre)!,
        update,
        opening,
      );
      yield* p.receiver.reactor.processBytes(toReceiver[0]);
      const startedLeft: GroupEventRef[] = [];
      const result = yield* approveGroupProposal(
        { ...depsFor(p.left, p.receiver, startedLeft), registryStore: p.receiver.acdc!.store },
        proposed.said,
      );
      assertEquals(result.route, "/multisig/bup");
      assertEquals(result.embedded, update.said);
      assertEquals(result.event, proposed.event);
      assertEquals(startedLeft, [proposed.event]);
    });
  });
});

Deno.test("approveGroupProposal approves iss and rev after the registry exists", async () => {
  await run(function*() {
    yield* pair("1", function*(p) {
      const wires: Uint8Array[] = [];
      p.receiver.postman.send = evt => (wires.push(evt.msg), { ...evt, kin: "msg" });
      p.receiver.postman.wait = function*(evt) {
        return { kin: "sent", evt, deliveries: ["peer"] };
      };
      const schema = new Schemer({ sed: { type: "object" } });
      for (const hby of [p.left, p.right]) hby.db.schema.pin(schema.said, schema);
      yield* inceptCredentialRegistry(p.receiver.vdr!, p.receiver.reactor, p.receiver.postman, p.group, {
        registryName: "tel",
      });
      const issued = yield* createCredential(p.receiver.vdr!, p.receiver.reactor, p.receiver.postman, {
        registryName: "tel",
        schema: schema.said,
        recipient: p.bob.pre,
        data: { role: "holder" },
      });
      yield* revokeCredential(p.receiver.vdr!, p.receiver.reactor, p.receiver.postman, {
        registryName: "tel",
        credentialSaid: issued.creder.said!,
      });
      const started: GroupEventRef[] = [];
      const deps = depsFor(p.right, p.sender, started);
      const names = ["vcp", "iss", "rev"];
      const results = [];
      for (const [index, wire] of wires.slice(0, 3).entries()) {
        yield* p.sender.reactor.processBytes(wire, { local: true });
        const said = new SerderKERI({ raw: wire }).said!;
        results.push(yield* approveGroupProposal(deps, said, { registryName: `tel-${names[index]}` }));
      }
      assertEquals(results.map(r => r.route), ["/multisig/vcp", "/multisig/iss", "/multisig/rev"]);
      assertEquals(started.length, 3);
      assertEquals(p.sender.vdr!.reger.tels.getOn(issued.creder.said!, 1) !== null, true);
    });
  });
});
