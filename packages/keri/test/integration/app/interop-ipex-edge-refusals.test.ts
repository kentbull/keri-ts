/** Malformed edge syntax and schema failures cross actual pairwise IPEX ingress before valid controls. */
import { assertEquals, assertExists } from "jsr:@std/assert";
import type { EdgeRefusalCase } from "./ipex/disclosures.ts";
import { type IpexPeer, observed, withIpexPeers } from "./ipex/peers.ts";

/** Scenario steps wait for real accepted state, not HTTP acknowledgements. */
async function exchange(sender: IpexPeer, receiver: IpexPeer, verb: Parameters<IpexPeer["send"]>[0], prior?: string) {
  const said = await sender.send(verb, prior);
  await observed(
    `${receiver.implementation} accepted ${verb}`,
    async () => (await receiver.snapshot()).messages.find((message) => message.d === said),
  );
  return said;
}

/** Refusal must be visible before a replacement and remain after the valid control. */
async function assertRefused(issuer: IpexPeer, holder: IpexPeer, said: string): Promise<void> {
  for (const peer of [issuer, holder]) {
    const snapshot = await peer.snapshot(said);
    assertExists(snapshot.inspected);
    const { accepted, escrowed, nests, decision } = snapshot.inspected;
    assertEquals([accepted, escrowed, nests], [false, false, 0], peer.implementation);
    if (peer === holder && peer.implementation === "TypeScript") assertEquals(decision, "reject");
  }
}

for (const implementation of ["TypeScript", "KERIpy"] as const) {
  for (
    const graph of [
      "unknown-leaf",
      "unknown-group",
      "malformed-leaf",
      "edge-schema",
      "inherited-schema",
      "malformed-schema",
    ] as const satisfies readonly EdgeRefusalCase[]
  ) {
    Deno.test(`IPEX ${implementation} discloser: refuse ${graph}, then admit signed schema-valid chain`, () =>
      withIpexPeers({ issuer: implementation, graph }, async ({ issuer, holder }) => {
        const apply = await exchange(holder, issuer, "apply");
        const offer = await exchange(issuer, holder, "offer", apply);
        const agree = await exchange(holder, issuer, "agree", offer);
        const bad = await issuer.send("grant", agree, true);
        await observed(
          "malformed/schema-invalid grant crossed real ingress",
          async () => (await holder.snapshot()).received.includes(bad) ? true : undefined,
        );
        await assertRefused(issuer, holder, bad);
        const grant = await exchange(issuer, holder, "grant", agree);
        await exchange(holder, issuer, "admit", grant);
        for (const peer of [issuer, holder]) {
          const snapshot = await peer.snapshot(grant);
          assertEquals(snapshot.messages.map((message) => message.r).sort(), [
            "/ipex/admit",
            "/ipex/agree",
            "/ipex/apply",
            "/ipex/grant",
            "/ipex/offer",
          ]);
          assertEquals(snapshot.nodes.length, 2);
          assertEquals(snapshot.nodes[0].said, issuer.info.commitment);
          for (const node of snapshot.nodes) {
            assertEquals(node.independentlyAccepted, false);
            assertEquals(node.attributes.status.value, "citizen");
            assertEquals(typeof node.attributes.private, "string");
            assertEquals(node.raw.includes("hidden-value"), false);
          }
        }
        await assertRefused(issuer, holder, bad);
      }));
  }
}
