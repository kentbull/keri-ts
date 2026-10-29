/** Real member ciphertexts follow ordinary two-of-three registry approval. */
import { concatBytes, MtrDex, Salter } from "cesr-ts";
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
import { createWalletBaser, RegistryCustody, type WalletBaser } from "../mod.ts";

Deno.test("group salt copies remain private and follow two-of-three accepted registry inception", async () => {
  await run(function* () {
    const identities: Habery[] = [], runtimes: AgentRuntime[] = [], stores: WalletBaser[] = [];
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
      for (const hby of identities) stores.push(yield* createWalletBaser({ name: hby.name, temp: true }));
      const custody = identities.map((hby, index) =>
        new RegistryCustody({ hby, registry: runtimes[index].acdc!.store, db: stores[index] })
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
      yield* stores[1].close();
      yield* stores[1].reopen();
      assertEquals(custody[1].derive(rip.said!, 17, rip.said!, "revoked"), future);
    } finally {
      for (const store of stores.reverse()) yield* store.close(true);
      for (const runtime of runtimes.reverse()) yield* runtime.close();
      for (const hby of identities.reverse()) yield* hby.close(true);
    }
  });
});
