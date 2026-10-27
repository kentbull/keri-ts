/** Malformed edge syntax and schema failures cross actual pairwise IPEX ingress before valid controls. */
import { assertEquals, assertExists } from "jsr:@std/assert";
import type { EdgeRefusalCase, PathShapeCase } from "./ipex/disclosures.ts";
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
      "simple-edge",
      "edge-schema",
      "inherited-schema",
      "malformed-schema",
    ] as const satisfies readonly EdgeRefusalCase[]
  ) {
    const semantic = !["malformed-leaf", "simple-edge"].includes(graph);
    const expectedPolicy = graph === "edge-schema" || graph === "inherited-schema" ? false : null;
    Deno.test(`IPEX ${implementation} discloser: ${semantic ? "retain unresolved/false" : "refuse"} ${graph}, then admit signed schema-valid chain`, () =>
      withIpexPeers({ issuer: implementation, graph }, async ({ issuer, holder }) => {
        let apply = await exchange(holder, issuer, "apply");
        let offer = await exchange(issuer, holder, "offer", apply);
        let agree = await exchange(holder, issuer, "agree", offer);
        const first = [apply, offer, agree];
        const bad = await issuer.send("grant", agree, true);
        await observed(
          "selected graph crossed real ingress",
          async () => (await holder.snapshot()).received.includes(bad) ? true : undefined,
        );
        let oldRaws: string[][] = [];
        if (semantic) {
          const retained = await Promise.all([issuer.snapshot(bad), holder.snapshot(bad)]);
          for (const snapshot of retained) {
            assertEquals([snapshot.inspected?.accepted, snapshot.inspected?.escrowed, snapshot.inspected?.nests], [
              true,
              false,
              2,
            ]);
            assertEquals(snapshot.verdict, expectedPolicy);
          }
          oldRaws = retained.map((snapshot) => snapshot.nodes.map((node) => node.raw));
          apply = await exchange(holder, issuer, "apply");
          offer = await exchange(issuer, holder, "offer", apply);
          agree = await exchange(holder, issuer, "agree", offer);
          assertEquals(
            first.some((said) => [apply, offer, agree].includes(said)),
            false,
            "positive control uses a fresh reply lineage",
          );
        } else await assertRefused(issuer, holder, bad);
        const grant = await exchange(issuer, holder, "grant", agree);
        await exchange(holder, issuer, "admit", grant);
        for (const [i, peer] of [issuer, holder].entries()) {
          const snapshot = await peer.snapshot(grant);
          assertEquals(
            snapshot.messages.map((message) => message.r).sort(),
            [
              "/ipex/admit",
              "/ipex/agree",
              "/ipex/apply",
              "/ipex/grant",
              "/ipex/offer",
              ...(semantic ? ["/ipex/agree", "/ipex/apply", "/ipex/grant", "/ipex/offer"] : []),
            ].sort(),
          );
          assertEquals(snapshot.verdict, true);
          assertEquals(
            snapshot.messages.find((message) => message.d === grant)!.p,
            agree,
            "positive Grant answers its fresh Agree",
          );
          assertEquals(snapshot.nodes.length, 2);
          assertEquals(snapshot.nodes[0].said, issuer.info.commitment);
          for (const node of snapshot.nodes) {
            assertEquals(node.independentlyAccepted, false);
            assertEquals(node.attributes.status.value, "citizen");
            assertEquals(typeof node.attributes.private, "string");
            assertEquals(node.raw.includes("hidden-value"), false);
          }
          if (semantic) {
            const old = await peer.snapshot(bad);
            assertEquals(old.verdict, expectedPolicy);
            assertEquals(old.nodes.map((node) => node.raw), oldRaws[i], "old retained evidence is immutable");
          }
        }
        if (!semantic) await assertRefused(issuer, holder, bad);
      }));
  }
  for (const graph of ["fixed-path", "optional-path"] as const satisfies readonly PathShapeCase[]) {
    Deno.test(`IPEX ${implementation} discloser: ${graph === "fixed-path" ? "fixed positional success" : "optional positional refusal then explicit success"}`, () =>
      withIpexPeers({ issuer: implementation, graph }, async ({ issuer, holder, plan }) => {
        assertEquals(plan.map(([schema]) => schema), issuer.info.schemas);
        assertEquals(plan.map(([, prefix]) => prefix), ["", ""]);
        let apply = await exchange(holder, issuer, "apply");
        let offer = await exchange(issuer, holder, "offer", apply);
        let agree = await exchange(holder, issuer, "agree", offer);
        for (const peer of [issuer, holder]) {
          const negotiated = (await peer.snapshot()).messages.find((message) => message.d === apply)!;
          assertEquals(negotiated.q.dp, plan, "both stores accepted the exact positional plan");
        }
        let refused: string | undefined;
        if (graph === "optional-path") {
          const rejected = await issuer.send("grant", agree, true);
          refused = rejected;
          await observed(
            "optional positional Grant crossed ordinary ingress",
            async () => (await holder.snapshot()).received.includes(rejected) ? true : undefined,
          );
          await assertRefused(issuer, holder, refused);
          const explicit = plan.map(([schema, , fields], i) => [schema, i ? "/e/authority/_/" : "/", fields] as const);
          await issuer.connect(holder.info, explicit);
          await holder.connect(issuer.info, explicit);
          // A fresh lineage changes only selection; both peers assert identical carried credential bytes.
          apply = await exchange(holder, issuer, "apply");
          offer = await exchange(issuer, holder, "offer", apply);
          agree = await exchange(holder, issuer, "agree", offer);
        }
        const grant = await exchange(issuer, holder, "grant", agree);
        await exchange(holder, issuer, "admit", grant);
        for (const peer of [issuer, holder]) {
          const snapshot = await peer.snapshot(grant);
          assertEquals(snapshot.inspected?.accepted, true);
          assertEquals(snapshot.inspected?.escrowed, false);
          assertEquals(snapshot.messages.length, refused ? 8 : 5);
          assertEquals(snapshot.nodes.length, 2);
          assertEquals(snapshot.nodes[0].said, issuer.info.commitment);
          for (const node of snapshot.nodes) {
            assertEquals(node.independentlyAccepted, false);
            assertEquals(node.attributes.status.value, "citizen");
            assertEquals(typeof node.attributes.private, "string");
            assertEquals(node.raw.includes("hidden-value"), false);
          }
          const acceptedPlan = snapshot.messages.find((message) => message.d === apply)!.q.dp!;
          assertEquals(acceptedPlan.map(([schema]) => schema), issuer.info.schemas);
          assertEquals(acceptedPlan.map(([, prefix]) => prefix), refused ? ["/", "/e/authority/_/"] : ["", ""]);
        }
        if (refused) await assertRefused(issuer, holder, refused);
      }));
  }
}
