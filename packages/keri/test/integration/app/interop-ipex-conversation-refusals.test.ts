/** Authenticated invalid replies cross real pairwise ingress; builders are not receiver validation. */
import { assertEquals, assertExists, assertNotEquals } from "jsr:@std/assert";
import { type IpexPeer, observed, type ReplyDefect, withIpexPeers } from "./ipex/peers.ts";

/** Scenario steps wait for actual receiving-store acceptance. */
async function exchange(sender: IpexPeer, receiver: IpexPeer, verb: Parameters<IpexPeer["send"]>[0], prior?: string) {
  const said = await sender.send(verb, prior);
  await observed(
    `${receiver.implementation} accepted ${verb}`,
    async () => (await receiver.snapshot()).messages.find((message) => message.d === said),
  );
  return said;
}

/** Assert delivered refusal at both stores; a claimed unknown sender is not a party test. */
async function refused(
  sender: IpexPeer,
  receiver: IpexPeer,
  said: string,
  foreign?: string,
  unknownThread = false,
): Promise<void> {
  await observed(
    "invalid reply crossed HTTP ingress",
    async () => (await receiver.snapshot()).received.includes(said) ? true : undefined,
  );
  for (const peer of [sender, receiver]) {
    const snapshot = await peer.snapshot(said);
    assertExists(snapshot.inspected);
    assertEquals([snapshot.inspected.accepted, snapshot.inspected.escrowed, snapshot.inspected.nests], [
      false,
      false,
      0,
    ]);
    if (peer === receiver && peer.implementation === "TypeScript") {
      assertEquals(snapshot.inspected.decision, unknownThread ? "drop" : "reject");
      if (unknownThread) {
        assertEquals(
          snapshot.inspected.reason,
          "unknownThread",
          "KRAM refuses the unknown exchange before route verification",
        );
      }
    }
    if (foreign) {
      assertNotEquals(foreign, sender.info.pre);
      assertEquals(snapshot.known.includes(foreign), true, "the actual foreign signer KEL crossed public intake");
    }
  }
}

for (const implementation of ["TypeScript", "KERIpy"] as const) {
  for (const kind of ["prior", "exchange-id", "recipient", "sender"] as const) {
    Deno.test(`IPEX ${implementation} discloser: refuse grant ${kind} mismatch, then admit valid grant`, () =>
      withIpexPeers({ issuer: implementation, graph: "I2I" }, async ({ issuer, holder }) => {
        const apply = await exchange(holder, issuer, "apply");
        const offer = await exchange(issuer, holder, "offer", apply);
        const agree = await exchange(holder, issuer, "agree", offer);
        const defect: ReplyDefect = kind === "prior" ? { kind, said: offer } : { kind };
        const bad = await issuer.invalidReply("grant", agree, defect);
        await refused(issuer, holder, bad.said, kind === "sender" ? bad.sender : undefined, kind === "exchange-id");
        const grant = await exchange(issuer, holder, "grant", agree);
        await exchange(holder, issuer, "admit", grant);
        for (const peer of [issuer, holder]) {
          const snapshot = await peer.snapshot(grant);
          assertEquals(snapshot.messages.length, 5);
          assertEquals(snapshot.nodes.length, 2);
          assertEquals(snapshot.nodes[0].said, issuer.info.commitment);
          assertEquals(snapshot.messages.find((message) => message.d === grant)!.p, agree);
          for (const node of snapshot.nodes) assertEquals(node.independentlyAccepted, false);
        }
        await refused(issuer, holder, bad.said, undefined, kind === "exchange-id");
      }));

    Deno.test(`IPEX ${implementation} discloser: refuse spurn ${kind} mismatch, then accept matching spurn`, () =>
      withIpexPeers({ issuer: implementation, graph: "I2I" }, async ({ issuer, holder }) => {
        let oldAdmit: string | undefined;
        if (kind === "prior") {
          // Both stores know this terminal message; it is not a missing-prior escrow case.
          const apply = await exchange(holder, issuer, "apply");
          const oldOffer = await exchange(issuer, holder, "offer", apply);
          const agree = await exchange(holder, issuer, "agree", oldOffer);
          const grant = await exchange(issuer, holder, "grant", agree);
          oldAdmit = await exchange(holder, issuer, "admit", grant);
        }
        const offer = await exchange(issuer, holder, "offer");
        const defect: ReplyDefect = kind === "prior" ? { kind, said: oldAdmit! } : { kind };
        const bad = await holder.invalidReply("spurn", offer, defect);
        await refused(holder, issuer, bad.said, kind === "sender" ? bad.sender : undefined, kind === "exchange-id");
        const spurn = await exchange(holder, issuer, "spurn", offer);
        for (const peer of [issuer, holder]) {
          const snapshot = await peer.snapshot();
          assertEquals(snapshot.messages.length, oldAdmit ? 7 : 2);
          assertEquals(snapshot.messages.find((message) => message.d === spurn)!.p, offer);
          assertEquals(snapshot.messages.filter((message) => message.r === "/ipex/admit").length, oldAdmit ? 1 : 0);
        }
        await refused(holder, issuer, bad.said, undefined, kind === "exchange-id");
      }));
  }

  Deno.test(`IPEX ${implementation} discloser: spurn an opening grant and refuse a later admit`, () =>
    withIpexPeers({ issuer: implementation, graph: "I2I" }, async ({ issuer, holder }) => {
      const grant = await exchange(issuer, holder, "grant");
      const spurn = await exchange(holder, issuer, "spurn", grant);
      const lateAdmit = await holder.send("admit", grant, true);
      await refused(holder, issuer, lateAdmit);
      for (const peer of [issuer, holder]) {
        const snapshot = await peer.snapshot(grant);
        assertEquals(snapshot.messages.length, 2);
        assertEquals(snapshot.messages.find((message) => message.d === grant)!.p, "");
        assertEquals(snapshot.messages.find((message) => message.d === spurn)!.p, grant);
        assertEquals(snapshot.messages.some((message) => message.r === "/ipex/admit"), false);
        assertEquals(snapshot.nodes.length, 2, "the refused disclosure remains conversation evidence");
        for (const node of snapshot.nodes) assertEquals(node.independentlyAccepted, false);
      }
    }));

  Deno.test(`IPEX ${implementation} discloser: refuse spurn of a negotiated grant, then accept admit`, () =>
    withIpexPeers({ issuer: implementation, graph: "I2I" }, async ({ issuer, holder }) => {
      const apply = await exchange(holder, issuer, "apply");
      const offer = await exchange(issuer, holder, "offer", apply);
      const agree = await exchange(holder, issuer, "agree", offer);
      const grant = await exchange(issuer, holder, "grant", agree);
      const bad = await holder.invalidReply("spurn", grant, { kind: "non-opening" });
      await refused(holder, issuer, bad.said);
      const admit = await exchange(holder, issuer, "admit", grant);
      for (const peer of [issuer, holder]) {
        const snapshot = await peer.snapshot(grant);
        assertEquals(snapshot.messages.length, 5);
        assertEquals(snapshot.messages.find((message) => message.d === grant)!.p, agree);
        assertEquals(snapshot.messages.find((message) => message.d === admit)!.p, grant);
        assertEquals(snapshot.messages.some((message) => message.r === "/ipex/spurn"), false);
      }
      await refused(holder, issuer, bad.said);
    }));
}
