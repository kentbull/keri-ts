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
async function assertConversation(
  { issuer, holder, plan }: IpexPeers,
  verbs: Verb[],
  previous: readonly string[] = [],
  grant?: string,
): Promise<void> {
  const snapshots = await Promise.all([issuer.snapshot(grant), holder.snapshot(grant)]);
  const lineages = snapshots.map((snapshot) => {
    assertEquals(snapshot.messages.length, verbs.length + previous.length, "all prior evidence remains retained");
    for (const said of previous) assertExists(snapshot.messages.find((message) => message.d === said));
    const current = snapshot.messages.filter((message) => !previous.includes(message.d));
    if (snapshot.notifications !== undefined) assertEquals(snapshot.notifications, verbs.length + previous.length);
    const lineage = verbs.map((verb) => {
      const message = current.find((message) => message.r === `/ipex/${verb}`);
      assertExists(message, verb);
      if (["apply", "offer", "agree", "grant"].includes(verb)) {
        assertEquals(message.q.dp, verb === verbs[0] ? plan : [], `${verb}: exact flat plan or prior ditto`);
      }
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
  Deno.test(`IPEX ${issuer} issuer: historical anchor survives rotation before first grant delivery`, () =>
    withIpexPeers({ issuer }, async ({ issuer, holder }) => {
      const said = await issuer.historicalGrant();
      await observed(
        `${holder.implementation} accepted historically anchored grant`,
        async () => (await holder.snapshot()).messages.find((message) => message.d === said),
      );
      for (const peer of [issuer, holder]) {
        const snapshot = await peer.snapshot(said);
        assertEquals(snapshot.inspected?.accepted, true);
        assertEquals(snapshot.inspected?.escrowed, false);
        if (snapshot.notifications !== undefined) assertEquals(snapshot.notifications, 1);
        assertEquals(snapshot.nodes[0].said, issuer.info.commitment);
      }
    }));

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
      ["NAND", "every logical member is true"],
      ["NOR", "one logical member is true"],
      ["multi-hop", "deep ancestor missing"],
      ["branching", "shared ancestor proof missing"],
    ] as const
  ) {
    const semantic = ["I2I", "E1E", "AND", "OR", "NAND", "NOR"].includes(graph);
    Deno.test(`IPEX ${issuer} issuer: ${graph} ${semantic ? "retains false policy" : "rejects"} ${defect}, then admits status-only graph`, () =>
      withIpexPeers({ issuer, graph }, async (peers) => {
        const { issuer, holder } = peers;
        let apply = await exchange(holder, issuer, "apply");
        let offer = await exchange(issuer, holder, "offer", apply);
        let agree = await exchange(holder, issuer, "agree", offer);
        const first = [apply, offer, agree];
        const rejected = semantic
          ? await issuer.send("grant", agree, true)
          : await refuseInvalidGrant(issuer, holder, agree);
        let oldRaws: string[][] = [];
        if (semantic) {
          await observed(
            "false-policy Grant crossed ordinary ingress",
            async () => (await holder.snapshot()).received.includes(rejected) ? true : undefined,
          );
          const retained = await Promise.all([issuer.snapshot(rejected), holder.snapshot(rejected)]);
          for (const snapshot of retained) {
            assertEquals([snapshot.inspected?.accepted, snapshot.inspected?.escrowed], [true, false]);
            assertEquals(snapshot.verdict, false, "a consuming action must refuse this retained graph");
          }
          oldRaws = retained.map((snapshot) => snapshot.nodes.map((node) => node.raw));
          apply = await exchange(holder, issuer, "apply");
          offer = await exchange(issuer, holder, "offer", apply);
          agree = await exchange(holder, issuer, "agree", offer);
          assertEquals(
            first.some((said) => [apply, offer, agree].includes(said)),
            false,
            "the positive control has a fresh reply lineage",
          );
        }
        const grant = await exchange(issuer, holder, "grant", agree);
        await exchange(holder, issuer, "admit", grant);
        await assertConversation(
          peers,
          ["apply", "offer", "agree", "grant", "admit"],
          semantic ? [...first, rejected] : [],
          grant,
        );
        if (semantic) {
          for (const [i, peer] of [issuer, holder].entries()) {
            const old = await peer.snapshot(rejected);
            assertEquals(old.verdict, false);
            assertEquals(
              old.nodes.map((node) => node.raw),
              oldRaws[i],
              "fresh completion never rewrites old retained evidence",
            );
            assertEquals((await peer.snapshot(grant)).verdict, true);
          }
        } else await assertRejected(issuer, holder, rejected);
        const arrivals = (await holder.snapshot()).received.filter((said) => said === rejected || said === grant);
        assertEquals(arrivals, [rejected, grant], "both grants crossed real ingress in scenario order");
      }));
  }
}
