/** Independent HTTP peers exercise IPEX lineage and status-only graduated disclosure. */
import { assertEquals, assertExists } from "jsr:@std/assert";
import type { IpexPeer, IpexPeers, Verb } from "./ipex/peers.ts";
import { observed, withIpexPeers } from "./ipex/peers.ts";

/** Complete one real HTTP delivery before the scenario chooses its next action. */
async function exchange(sender: IpexPeer, receiver: IpexPeer, verb: Verb, prior?: string): Promise<string> {
  const said = await sender.send(verb, prior);
  await observed(
    `${receiver.implementation} accepted ${verb}`,
    async () => (await receiver.snapshot()).messages.find((message) => message.d === said),
  );
  return said;
}

/** Verify rejection before sending a replacement, on both independent stores. */
async function refuseInvalidGrant(issuer: IpexPeer, holder: IpexPeer, agree: string): Promise<string> {
  const rejected = await issuer.send("grant", agree, true);
  await observed(
    `${holder.implementation} received invalid grant`,
    async () => (await holder.snapshot()).received.includes(rejected) ? true : undefined,
  );
  await assertRejected(issuer, holder, rejected);
  return rejected;
}

/** Refused evidence must stay absent even after the subsequent valid grant. */
async function assertRejected(issuer: IpexPeer, holder: IpexPeer, rejected: string): Promise<void> {
  for (const peer of [issuer, holder]) {
    const { inspected } = await peer.snapshot(rejected);
    assertExists(inspected);
    assertEquals(inspected.accepted, false, `${peer.implementation}: rejected exchange`);
    assertEquals(inspected.escrowed, false, `${peer.implementation}: no pending exchange`);
    assertEquals(inspected.nests, 0, `${peer.implementation}: no retained children`);
    if (peer === holder && peer.implementation === "TypeScript") {
      assertEquals(inspected.decision, "reject", "actual Reactor decision at HTTP ingress");
    }
  }
}

/** Check both views of the exact conversation, including direction and prior linkage. */
async function assertConversation({ issuer, holder, plan }: IpexPeers, verbs: Verb[]): Promise<void> {
  const snapshots = await Promise.all([issuer.snapshot(), holder.snapshot()]);
  const lineages = snapshots.map((snapshot) => {
    assertEquals(snapshot.messages.length, verbs.length, "no extra accepted messages");
    if (snapshot.notifications !== undefined) assertEquals(snapshot.notifications, verbs.length);
    const lineage = verbs.map((verb) => {
      const message = snapshot.messages.find((message) => message.r === `/ipex/${verb}`);
      assertExists(message, verb);
      return message;
    });
    assertEquals(lineage[0].p, "");
    for (let i = 1; i < lineage.length; i++) {
      const prior = lineage[i - 1], reply = lineage[i];
      assertEquals(reply.p, prior.d);
      assertEquals(reply.x, prior.x);
      assertEquals(reply.i, prior.ri);
      assertEquals(reply.ri, prior.i);
    }
    return lineage.map((message) => message.d);
  });
  assertEquals(lineages[0], lineages[1], "both stores accepted the same lineage");
  assertEquals(snapshots[0].nodes.map((node) => node.said), snapshots[1].nodes.map((node) => node.said));
  const completed = verbs.includes("admit");
  for (const snapshot of snapshots) {
    assertEquals(snapshot.nodes.length, completed ? plan.length : 0);
    for (const node of snapshot.nodes) {
      assertEquals(node.attributes.status.value, "citizen");
      assertEquals(typeof node.attributes.private, "string", "private field stays compacted");
      assertEquals(node.raw.includes("hidden-value"), false);
      assertEquals(node.independentlyAccepted, false, "a parent does not independently accept its children");
    }
    if (completed) assertEquals(snapshot.nodes[0].said, issuer.info.commitment);
  }
}

for (const issuer of ["TypeScript", "KERIpy"] as const) {
  Deno.test(`IPEX ${issuer} issuer: apply → offer → agree → grant → admit`, () =>
    withIpexPeers({ issuer }, async (peers) => {
      const { issuer, holder } = peers;
      const apply = await exchange(holder, issuer, "apply");
      const offer = await exchange(issuer, holder, "offer", apply);
      const agree = await exchange(holder, issuer, "agree", offer);
      const grant = await exchange(issuer, holder, "grant", agree);
      await exchange(holder, issuer, "admit", grant);
      await assertConversation(peers, ["apply", "offer", "agree", "grant", "admit"]);
    }));

  Deno.test(`IPEX ${issuer} issuer: unsolicited offer → agree → grant → admit`, () =>
    withIpexPeers({ issuer }, async (peers) => {
      const { issuer, holder } = peers;
      const offer = await exchange(issuer, holder, "offer");
      const agree = await exchange(holder, issuer, "agree", offer);
      const grant = await exchange(issuer, holder, "grant", agree);
      await exchange(holder, issuer, "admit", grant);
      await assertConversation(peers, ["offer", "agree", "grant", "admit"]);
    }));

  Deno.test(`IPEX ${issuer} issuer: spurn application`, () =>
    withIpexPeers({ issuer }, async (peers) => {
      const apply = await exchange(peers.holder, peers.issuer, "apply");
      await exchange(peers.issuer, peers.holder, "spurn", apply);
      await assertConversation(peers, ["apply", "spurn"]);
    }));

  Deno.test(`IPEX ${issuer} issuer: spurn unsolicited offer`, () =>
    withIpexPeers({ issuer }, async (peers) => {
      const offer = await exchange(peers.issuer, peers.holder, "offer");
      await exchange(peers.holder, peers.issuer, "spurn", offer);
      await assertConversation(peers, ["offer", "spurn"]);
    }));

  // Each case gets fresh peers. Invalid evidence is refused before the valid graph is admitted.
  for (
    const [graph, defect] of [
      ["I2I", "authority issuee differs from root issuer"],
      ["NI2I", "authority proof missing"],
      ["E1E", "node issuees differ"],
      ["AND", "one required logical branch is false"],
      ["OR", "all logical alternatives are false"],
      ["multi-hop", "deep ancestor missing"],
      ["branching", "shared ancestor proof missing"],
    ] as const
  ) {
    Deno.test(`IPEX ${issuer} issuer: ${graph} rejects ${defect}, then admits status-only graph`, () =>
      withIpexPeers({ issuer, graph }, async (peers) => {
        const { issuer, holder } = peers;
        const apply = await exchange(holder, issuer, "apply");
        const offer = await exchange(issuer, holder, "offer", apply);
        const agree = await exchange(holder, issuer, "agree", offer);
        const rejected = await refuseInvalidGrant(issuer, holder, agree);
        const grant = await exchange(issuer, holder, "grant", agree);
        await exchange(holder, issuer, "admit", grant);
        await assertConversation(peers, ["apply", "offer", "agree", "grant", "admit"]);
        await assertRejected(issuer, holder, rejected);
        const arrivals = (await holder.snapshot()).received.filter((said) => said === rejected || said === grant);
        assertEquals(arrivals, [rejected, grant], "both grants crossed real ingress in scenario order");
      }));
  }
}
