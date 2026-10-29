/** Real member ciphertexts follow ordinary two-of-three registry approval. */
import { concatBytes, Counter, MtrDex, Salter, Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import {
  type AgentRuntime,
  approveAcdcV2Registry,
  createAgentRuntime,
  createHabery,
  FetchHttpClient,
  type Habery,
  messagize,
  regcept,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import { acdcV2RegistryProposal } from "../../keri/src/app/multisig/grouping.ts";
import { loadNests } from "../../keri/src/db/exchange/exchange-nests.ts";
import { RegistryCustody, RegistrySaltService } from "../mod.ts";

Deno.test("group salt copies remain private and follow two-of-three accepted registry inception", async () => {
  await run(function* () {
    const identities: Habery[] = [], runtimes: AgentRuntime[] = [];
    try {
      for (let index = 0; index < 3; index++) {
        identities.push(
          yield* createHabery({
            name: `salt-member-${index}`,
            temp: true,
            skipConfig: true,
            bran: `PrivateGroupMemberPasscode${index}`,
          }),
        );
      }
      const members = identities.map((hby, index) => hby.makeHab(`member-${index}`));
      for (const hby of identities) runtimes.push(yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock));
      for (let sender = 0; sender < identities.length; sender++) {
        for (const runtime of runtimes) {
          for (const wire of identities[sender].db.clonePreIter(members[sender].pre, 0)) {
            yield* runtime.reactor.processBytes(wire);
          }
        }
      }
      const mids = members.map((member) => member.pre);
      const groups = identities.map((hby, index) =>
        hby.makeGroupHab("issuer", members[index], mids, mids, undefined, { isith: "2", nsith: "2" })
      );
      const inception = messagize(groups[0].serder, { sigers: [...groups[0].sigers, ...groups[1].sigers] });
      for (const runtime of runtimes) yield* runtime.reactor.processBytes(inception, { local: true });
      const custody = identities.map((hby, index) =>
        new RegistryCustody({ hby, registry: runtimes[index].acdc!.store })
      );
      const root = new Salter({ code: MtrDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) });
      const copies = custody[0].sealMembers(groups[0].hab, root);
      for (let index = 0; index < 3; index++) {
        assertEquals(custody[index].openMemberCopy(groups[index].hab, copies).qb64, root.qb64);
      }
      assertThrows(
        () =>
          custody[1].openMemberCopy(groups[1].hab, {
            ...copies,
            [members[1].pre]: copies[members[0].pre],
          }),
        ValidationError,
        "authenticate",
      );
      const rip = regcept(groups[0].hab.pre);
      assertThrows(() => custody[0].retainMemberCopy(rip.said!, groups[0].hab, copies), ValidationError, "controller");
      const first = yield* approveAcdcV2Registry(identities[0], runtimes[0].protocol, groups[0].hab, rip, {
        salts: copies,
      });
      yield* runtimes[1].reactor.processBytes(concatBytes(first[0].raw, first[1]));
      const proposal = acdcV2RegistryProposal(first[0], loadNests(identities[1].db, first[0].said!))!;
      assertEquals(custody[1].openMemberCopy(groups[1].hab, proposal.salts!).qb64, root.qb64);
      const second = yield* approveAcdcV2Registry(identities[1], runtimes[1].protocol, groups[1].hab, rip, {
        anchor: proposal.anchor,
        salts: proposal.salts,
      });
      yield* runtimes[0].reactor.processBytes(concatBytes(second[0].raw, second[1]));
      for (let index = 0; index < 2; index++) {
        yield* runtimes[index].protocol.processEscrowsOnce();
        assertEquals(runtimes[index].acdc!.store.seqEvent(rip.said!, 0)?.said, rip.said);
        custody[index].retainMemberCopy(rip.said!, groups[index].hab, copies);
      }
      // The third signer never approved. Its absence does not block the ordinary threshold.
      assertEquals(runtimes[2].acdc!.store.seqEvent(rip.said!, 0), null);
      const future = custody[0].derive(rip.said!, 17, rip.said!, "revoked");
      assertEquals(custody[1].derive(rip.said!, 17, rip.said!, "revoked"), future);
      yield* identities[1].ks.close();
      yield* identities[1].ks.reopen();
      assertEquals(custody[1].derive(rip.said!, 17, rip.said!, "revoked"), future);

      // A nonapproving member can accept quorum-authorized evidence and later
      // receive its salt. No inception approval or delivery receipt is invented.
      for (const wire of identities[0].db.clonePreIter(groups[0].hab.pre, 0, Vrsn_2_0)) {
        yield* runtimes[2].reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire), { local: true });
      }
      yield* runtimes[2].reactor.processBytes(
        concatBytes(Counter.makeGVC(Vrsn_2_0), runtimes[0].acdc!.store.cloneTel(rip.said!)),
      );
      assertEquals(runtimes[2].acdc!.store.seqEvent(rip.said!, 0)?.said, rip.said);
      const services = custody.map((owner, index) => new RegistrySaltService(owner, runtimes[index].protocol.rvy));
      for (const service of services) service.register();
      const reply = services[0].makeReply(groups[0].hab, rip.said!, groups[0].hab.pre, members[2].pre);
      yield* runtimes[2].reactor.processBytes(groups[0].hab.endorse(reply));
      assertEquals(identities[2].ks.custody.get([rip.said!]), null);
      yield* runtimes[2].reactor.processBytes(groups[1].hab.endorse(reply));
      yield* runtimes[2].protocol.processEscrowsOnce();
      assertEquals(custody[2].derive(rip.said!, 17, rip.said!, "revoked"), future);
      yield* identities[2].ks.close();
      yield* identities[2].ks.reopen();
      assertEquals(custody[2].derive(rip.said!, 17, rip.said!, "revoked"), future);

      // Replace the original lead using the remaining prior-next quorum. The
      // newcomer learns accepted evidence before joining the local group.
      const joining = yield* createHabery({
        name: "salt-new-member",
        temp: true,
        skipConfig: true,
        bran: "PrivateNewMemberPasscode",
      });
      identities.push(joining);
      const joinedRuntime = yield* createAgentRuntime(joining, new FetchHttpClient(), systemClock);
      runtimes.push(joinedRuntime);
      const newMember = joining.makeHab("new-member");
      for (const runtime of runtimes) {
        for (const wire of joining.db.clonePreIter(newMember.pre)) yield* runtime.reactor.processBytes(wire);
      }
      for (const index of [1, 2]) {
        members[index].rotate();
        for (const runtime of runtimes) {
          for (const wire of identities[index].db.clonePreIter(members[index].pre)) {
            yield* runtime.reactor.processBytes(wire, { local: true });
          }
        }
      }
      for (const wire of identities[1].db.clonePreIter(groups[1].hab.pre, 0, Vrsn_2_0)) {
        yield* joinedRuntime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire));
      }
      const replacement = [members[1].pre, members[2].pre, newMember.pre];
      const rotations = [1, 2].map((index) =>
        identities[index].rotateGroupHab("issuer", replacement, replacement, { isith: "2", nsith: "2" })
      );
      assertEquals(rotations[0].serder.said, rotations[1].serder.said);
      const rotated = messagize(rotations[0].serder, { sigers: [...rotations[0].sigers, ...rotations[1].sigers] });
      for (const index of [1, 2, 3]) {
        yield* runtimes[index].reactor.processBytes(rotated, { local: true });
        assertEquals(identities[index].db.getKever(groups[0].hab.pre)?.serder.said, rotations[0].serder.said);
      }
      for (const index of [1, 2]) {
        identities[index].commitGroupHabMembers(groups[index].hab.pre, replacement, replacement);
      }
      joining.joinGroupHab(groups[0].hab.pre, "issuer", newMember, replacement, replacement);
      yield* joinedRuntime.reactor.processBytes(
        concatBytes(Counter.makeGVC(Vrsn_2_0), runtimes[1].acdc!.store.cloneTel(rip.said!)),
      );
      const joinedCustody = new RegistryCustody({ hby: joining, registry: joinedRuntime.acdc!.store });
      new RegistrySaltService(joinedCustody, joinedRuntime.protocol.rvy).register();
      const newReply = services[1].makeReply(groups[1].hab, rip.said!, groups[1].hab.pre, newMember.pre);
      yield* joinedRuntime.reactor.processBytes(groups[1].hab.endorse(newReply));
      assertEquals(joining.ks.custody.get([rip.said!]), null);
      yield* joinedRuntime.reactor.processBytes(groups[2].hab.endorse(newReply));
      yield* joinedRuntime.protocol.processEscrowsOnce();
      assertEquals(joinedCustody.derive(rip.said!, 17, rip.said!, "revoked"), future);
      yield* joining.ks.close();
      yield* joining.ks.reopen();
      assertEquals(joinedCustody.derive(rip.said!, 17, rip.said!, "revoked"), future);
    } finally {
      for (const runtime of runtimes.reverse()) yield* runtime.close();
      for (const hby of identities.reverse()) yield* hby.close(true);
    }
  });
});
