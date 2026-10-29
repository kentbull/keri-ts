/** A holder acting as discloser and a separate discloser share this same wire role. */
import { concatBytes, Counter, Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  type AgentRuntime,
  createAgentRuntime,
  createHabery,
  FetchHttpClient,
  type Habery,
  messagize,
  regcept,
  systemClock,
} from "keri-ts/runtime";
import { acdcmap, blindate } from "../../keri/src/acdc/messaging.ts";
import { replicationRequests } from "../../multisync/v2/mod.ts";
import { RegistryCustody, RegistrySaltService } from "../mod.ts";

Deno.test("recipient group replaces its lead and provisions the same issuer root to a newcomer", async () => {
  await run(function*() {
    const owners: Habery[] = [], runtimes: AgentRuntime[] = [];
    try {
      for (let index = 0; index < 5; index++) {
        owners.push(
          yield* createHabery({
            name: `discloser-${index}`,
            temp: true,
            bran: `DiscloserRotationPasscode${index}`,
            skipConfig: true,
          }),
        );
        runtimes.push(yield* createAgentRuntime(owners[index], new FetchHttpClient(), systemClock));
      }
      const people = owners.map(owner => owner.makeHab("member"));
      const issuer = people[0], members = people.slice(1, 4), newcomer = people[4];
      for (const runtime of runtimes) {
        for (const owner of owners) {
          for (const wire of owner.db.clonePreIter(owner.habByName("member")!.pre)) {
            yield* runtime.reactor.processBytes(wire);
          }
        }
      }
      const original = members.map(member => member.pre);
      const groups = owners.slice(1, 4).map((owner, index) =>
        owner.makeGroupHab("discloser", members[index], original, original, undefined, { isith: "2", nsith: "2" })
      );
      const inception = messagize(groups[0].serder, { sigers: [...groups[0].sigers, ...groups[1].sigers] });
      for (const runtime of runtimes) yield* runtime.reactor.processBytes(inception, { local: true });
      const rip = regcept(issuer.pre);
      issuer.interact({ data: [{ s: "0", d: rip.said! }] });
      const empty = Counter.enclose({ code: "AttachmentGroup", version: Vrsn_2_0, qb64: new Uint8Array() });
      for (const runtime of runtimes) {
        for (const wire of owners[0].db.clonePreIter(issuer.pre, 0, Vrsn_2_0)) {
          yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire));
        }
        yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), rip.raw, empty));
        assertEquals(runtime.acdc!.store.head(rip.said!)?.qb64, rip.said);
      }
      const custody = owners.map((hby, index) => new RegistryCustody({ hby, registry: runtimes[index].acdc!.store }));
      const services = custody.map((owner, index) => new RegistrySaltService(owner, runtimes[index].protocol.rvy));
      for (const service of services) service.register();
      custody[0].createCustody(rip.said!, groups[0].hab.pre);
      for (let index = 1; index < 4; index++) {
        const reply = services[0].makeReply(issuer, rip.said!, groups[0].hab.pre, people[index].pre);
        yield* runtimes[index].reactor.processBytes(issuer.endorse(reply, { gvrsn: Vrsn_2_0 }));
      }
      assertEquals(owners[4].ks.custody.get(rip.said!), null);
      const credential = acdcmap(issuer.pre, { regid: rip.said!, attribute: { d: "", example: true } });
      const historical = custody[0].derive(rip.said!, 1, credential.said!, "issued");
      const issued = blindate(rip.said!, rip.said!, historical.d.nonce);
      issuer.interact({ data: [{ s: "1", d: issued.said! }] });
      for (const runtime of runtimes) {
        for (const wire of owners[0].db.clonePreIter(issuer.pre, 0, Vrsn_2_0)) {
          yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), wire));
        }
        yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), issued.raw, empty));
      }
      for (const index of [2, 3]) {
        people[index].rotate();
        for (const runtime of runtimes) {
          for (const wire of owners[index].db.clonePreIter(people[index].pre)) {
            yield* runtime.reactor.processBytes(wire);
          }
        }
      }
      const replacement = [people[2].pre, people[3].pre, newcomer.pre];
      const rotations = [2, 3].map(index =>
        owners[index].rotateGroupHab("discloser", replacement, replacement, { isith: "2", nsith: "2" })
      );
      assertEquals(rotations[0].serder.said, rotations[1].serder.said);
      const accepted = messagize(rotations[0].serder, { sigers: [...rotations[0].sigers, ...rotations[1].sigers] });
      for (const runtime of runtimes) yield* runtime.reactor.processBytes(accepted, { local: true });
      for (const index of [2, 3]) owners[index].commitGroupHabMembers(groups[0].hab.pre, replacement, replacement);
      const joined = owners[4].joinGroupHab(groups[0].hab.pre, "discloser", newcomer, replacement, replacement);
      const current = owners[2].habByName("discloser")!;
      const requests = replicationRequests(custody[2], current, {
        accepted: true,
        previousSigningMembers: original,
        signingMembers: replacement,
        rotation: rotations[0].serder.said!,
      });
      assertEquals(requests, [{ registry: rip.said, recipient: current.pre, target: newcomer.pre }]);
      const reply = services[2].makeReply(current, rip.said!, current.pre, newcomer.pre);
      yield* runtimes[4].reactor.processBytes(current.endorse(reply, { gvrsn: Vrsn_2_0 }));
      assertEquals(owners[4].ks.custody.get(rip.said!), null, "one signature cannot authorize replication");
      yield* runtimes[4].reactor.processBytes(owners[3].habByName("discloser")!.endorse(reply, { gvrsn: Vrsn_2_0 }));
      yield* runtimes[4].protocol.processEscrowsOnce();
      assertEquals(joined.pre, groups[0].hab.pre);
      assertEquals(custody[4].derive(rip.said!, 1, credential.said!, "issued"), historical);
      assertEquals(
        custody[4].derive(rip.said!, 17, credential.said!, "revoked"),
        custody[0].derive(rip.said!, 17, credential.said!, "revoked"),
      );
      yield* owners[4].ks.close();
      yield* owners[4].ks.reopen();
      assertEquals(custody[4].derive(rip.said!, 1, credential.said!, "issued"), historical);
      // Departure does not revoke previously disclosed roots under the accepted policy.
      assertEquals(custody[1].derive(rip.said!, 1, credential.said!, "issued"), historical);
    } finally {
      for (const runtime of runtimes.reverse()) yield* runtime.close();
      for (const owner of owners.reverse()) yield* owner.close(true);
    }
  });
});
