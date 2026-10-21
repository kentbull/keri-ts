/** Pairwise independent processors retain distinct graduated disclosures of the same signed chain. */
import { assertEquals, assertExists } from "jsr:@std/assert";
import type { DisclosurePlan } from "../../../src/app/ipex/ipex-graph.ts";
import { type DisclosureDefect, type IpexPeer, type IpexPeers, observed, withIpexPeers } from "./ipex/peers.ts";

/** A test chooses each conversation step and waits for actual accepted state. */
async function exchange(sender: IpexPeer, receiver: IpexPeer, verb: Parameters<IpexPeer["send"]>[0], prior?: string) {
  const said = await sender.send(verb, prior);
  await observed(
    `${receiver.implementation} accepted ${verb}`,
    async () => (await receiver.snapshot()).messages.find((message) => message.d === said),
  );
  return said;
}

/** Negotiate the same concrete subset at both independent endpoints. */
async function select(peers: IpexPeers, fields: string[]): Promise<void> {
  const plan: DisclosurePlan = peers.plan.map(([schema, path]) => [schema, path, fields]);
  await peers.issuer.connect(peers.holder.info, plan);
  await peers.holder.connect(peers.issuer.info, plan);
}

/** Inspect the actual retained grant, without promoting nested nodes into accepted wallet state. */
async function retained(peer: IpexPeer, grant: string, fields: readonly string[]) {
  const snapshot = await peer.snapshot(grant);
  assertExists(snapshot.inspected);
  assertEquals(snapshot.inspected.accepted, true);
  assertEquals(snapshot.inspected.escrowed, false);
  assertEquals(snapshot.nodes.length, 2);
  for (const node of snapshot.nodes) {
    assertEquals(node.independentlyAccepted, false);
    const attributes = node.attributes;
    assertEquals(attributes.status.value, "citizen");
    assertEquals(typeof attributes.private, "string");
    const city = fields.includes("a/contact/city/"), email = fields.includes("a/contact/email/");
    if (city || email) {
      const contact = attributes.contact as Record<string, unknown>;
      assertEquals(typeof contact, "object");
      assertEquals(typeof contact.postcode, "string");
      if (city) assertEquals((contact.city as { value: string }).value, "Denver");
      else assertEquals(typeof contact.city, "string");
      if (email) assertEquals((contact.email as { value: string }).value, "person@example.test");
      else assertEquals(typeof contact.email, "string");
    } else assertEquals(typeof attributes.contact, "string");
    if (fields.includes("a/role/")) assertEquals((attributes.role as { value: string }).value, "engineer");
    else assertEquals(typeof attributes.role, "string");
    for (const secret of ["hidden-value", "hidden-postcode"]) assertEquals(node.raw.includes(secret), false);
    assertEquals(node.raw.includes("person@example.test"), email);
    assertEquals(node.raw.includes("Denver"), city);
  }
  return snapshot;
}

for (const implementation of ["TypeScript", "KERIpy"] as const) {
  Deno.test(`IPEX ${implementation} discloser: progressive nested reveals retain each conversation and replay`, () =>
    withIpexPeers({ issuer: implementation, graph: "I2I" }, async (peers) => {
      const { issuer, holder } = peers;
      const selections = [
        ["a/status/"],
        ["a/status/", "a/contact/city/"],
        ["a/status/", "a/contact/city/", "a/contact/email/", "a/role/"],
        ["a/status/", "a/role/"], // A new conversation does not inherit previously revealed contact values.
      ];
      const conversations: { grant: string; fields: string[]; raws: string[][] }[] = [];
      let commitments: string[] | undefined;
      for (const fields of selections) {
        await select(peers, fields);
        const apply = await exchange(holder, issuer, "apply");
        const offer = await exchange(issuer, holder, "offer", apply);
        const agree = await exchange(holder, issuer, "agree", offer);
        const grant = await exchange(issuer, holder, "grant", agree);
        const admit = await exchange(holder, issuer, "admit", grant);
        const snapshots = await Promise.all([retained(issuer, grant, fields), retained(holder, grant, fields)]);
        assertEquals(snapshots[0].nodes.map((node) => node.said), snapshots[1].nodes.map((node) => node.said));
        assertEquals(
          snapshots[0].nodes.map((node) => node.attributes),
          snapshots[1].nodes.map((node) => node.attributes),
        );
        const current = snapshots[0].nodes.map((node) => node.said);
        commitments ??= current;
        assertEquals(current, commitments, "both chain commitments survive increasing disclosure");
        assertEquals(current[0], issuer.info.commitment);
        for (const snapshot of snapshots) {
          const lineage = [apply, offer, agree, grant, admit].map((said) =>
            snapshot.messages.find((message) => message.d === said)!
          );
          assertEquals(lineage[0].p, "");
          for (let i = 1; i < lineage.length; i++) {
            assertEquals(lineage[i].p, lineage[i - 1].d);
            assertEquals(lineage[i].x, lineage[0].x);
            assertEquals(lineage[i].i, lineage[i - 1].ri);
            assertEquals(lineage[i].ri, lineage[i - 1].i);
          }
        }
        conversations.push({
          grant,
          fields,
          raws: snapshots.map((snapshot) => snapshot.nodes.map((node) => node.raw)),
        });
        for (const previous of conversations) {
          for (const [i, peer] of [issuer, holder].entries()) {
            const stored = await retained(peer, previous.grant, previous.fields);
            assertEquals(
              stored.nodes.map((node) => node.raw),
              previous.raws[i],
              "later disclosure cannot expand older evidence",
            );
          }
        }
      }
      for (const previous of conversations) {
        const arrivals = (await holder.snapshot()).received.filter((said) => said === previous.grant).length;
        await issuer.replay(previous.grant);
        await observed(
          "replayed stored grant crossed HTTP ingress",
          async () =>
            (await holder.snapshot()).received.filter((said) => said === previous.grant).length > arrivals
              ? true
              : undefined,
        );
        for (const [i, peer] of [issuer, holder].entries()) {
          const snapshot = await retained(peer, previous.grant, previous.fields);
          assertEquals(snapshot.nodes.map((node) => node.raw), previous.raws[i]);
          assertEquals(snapshot.messages.length, selections.length * 5, "replay creates no conversation rows");
        }
      }
    }));

  for (const defect of ["extra", "missing", "altered"] as const satisfies readonly DisclosureDefect[]) {
    Deno.test(`IPEX ${implementation} discloser: refuse ${defect} disclosure, then admit negotiated chain`, () =>
      withIpexPeers({ issuer: implementation, graph: "I2I" }, async (peers) => {
        const { issuer, holder } = peers;
        const fields = ["a/status/", "a/contact/city/"];
        await select(peers, fields);
        const apply = await exchange(holder, issuer, "apply");
        const offer = await exchange(issuer, holder, "offer", apply);
        const agree = await exchange(holder, issuer, "agree", offer);
        const bad = await issuer.send("grant", agree, defect);
        await observed(
          "defective grant crossed HTTP ingress",
          async () => (await holder.snapshot()).received.includes(bad) ? true : undefined,
        );
        const grant = await exchange(issuer, holder, "grant", agree);
        await exchange(holder, issuer, "admit", grant);
        for (const peer of [issuer, holder]) {
          const refused = (await peer.snapshot(bad)).inspected;
          assertExists(refused);
          assertEquals([refused.accepted, refused.escrowed, refused.nests], [false, false, 0]);
          if (peer === holder && peer.implementation === "TypeScript") assertEquals(refused.decision, "reject");
          const snapshot = await retained(peer, grant, fields);
          assertEquals(snapshot.messages.length, 5);
          assertEquals(snapshot.nodes[0].said, issuer.info.commitment);
        }
      }));
  }
}
