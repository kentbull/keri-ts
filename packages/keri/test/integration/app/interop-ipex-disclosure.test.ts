/** Independent HTTP peers exercise IPEX lineage and status-only graduated disclosure. */
import { b, collectPayload, nestedPayload, parseBytes, Vrsn_2_0 } from "cesr-ts";
import { assertEquals, assertExists, assertNotEquals, assertRejects } from "jsr:@std/assert";
import type { DerivedIpexPeers, IpexPeer, IpexPeers, Verb } from "./ipex/peers.ts";
import { observed, withDerivedIpexPeers, withIpexPeers } from "./ipex/peers.ts";

/** Python rebuilds empty signature lists; compare every carried proof byte without that zero-item counter. */
async function comparableProof(proof: string | undefined): Promise<Uint8Array> {
  assertExists(proof);
  const frames = parseBytes(b(proof));
  assertEquals(frames.length, 1);
  const frame = frames[0];
  frame.attachments = frame.attachments.filter(group =>
    !(group.name.replace(/^Big/, "") === "ControllerIdxSigs" && group.items.length === 0)
  );
  return await collectPayload(nestedPayload(frame, Vrsn_2_0));
}

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
    assertEquals(
      inspected.escrowed,
      false,
      `${peer.implementation}: no pending exchange: ${JSON.stringify(inspected)}`,
    );
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
        assertEquals(message.q.dp, verb === verbs[0] ? [plan] : [[]], `${verb}: exact one-DAG plan or prior ditto`);
      }
      return message;
    });
    assertEquals(lineage[0].t, "xip");
    assertEquals(Object.hasOwn(lineage[0], "p"), false, "an opener has no prior");
    assertEquals(Object.hasOwn(lineage[0], "x"), false, "an opener uses its own SAID as transaction identity");
    for (let i = 1; i < lineage.length; i++) {
      const prior = lineage[i - 1], reply = lineage[i];
      assertEquals(reply.p, prior.d);
      assertEquals(reply.x, prior.t === "xip" ? prior.d : prior.x);
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
      ["DI2I", "far issuee is outside the approved two-hop delegation ancestry"],
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
        await assertConversation(peers, ["apply", "offer", "agree", "grant", "admit"], [], grant);
        await assertRejected(issuer, holder, rejected);
        const arrivals = (await holder.snapshot()).received.filter((said) => said === rejected || said === grant);
        assertEquals(arrivals, [rejected, grant], "both grants crossed real ingress in scenario order");
      }));
  }
}

for (const implementation of ["TypeScript", "KERIpy"] as const) {
  Deno.test(`IPEX witnessed ${implementation} issuer: negotiated source anchors, consent and exact presentation after reopen with three witnesses`, () =>
    withIpexPeers({ issuer: implementation, witnessed: true }, async (peers) => {
      const { issuer, holder } = peers;
      const apply = await exchange(holder, issuer, "apply");
      const offer = await exchange(issuer, holder, "offer", apply);
      const agree = await exchange(holder, issuer, "agree", offer);
      const grant = await exchange(issuer, holder, "grant", agree);
      // Receipt is not consent: onward use must wait for the holder's explicit Admit.
      await assertRejects(() => holder.present(grant));
      await exchange(holder, issuer, "admit", grant);
      const before = (await holder.snapshot(grant)).nodes.map(node => node.raw);
      const retainedProofs = await Promise.all(
        [issuer, holder].map(async peer => (await peer.snapshot(grant)).nodes.map(node => node.proof)),
      );
      assertEquals(before.length, 1);
      assertEquals(before[0].includes("hidden-value"), false);
      await issuer.reopenEvidence();
      await holder.reopenEvidence();
      const presentation = await holder.present(grant);
      await observed(
        "issuer accepted exact retained presentation",
        async () => (await issuer.snapshot()).messages.find(message => message.d === presentation),
      );
      for (const [index, peer] of [issuer, holder].entries()) {
        assertEquals((await peer.snapshot(grant)).nodes.map(node => node.raw), before);
        assertEquals((await peer.snapshot(grant)).nodes.map(node => node.proof), retainedProofs[index]);
        const forwarded = await peer.snapshot(presentation);
        assertEquals(forwarded.nodes.map(node => node.raw), before);
        assertEquals(
          forwarded.nodes.map(node => node.proof),
          retainedProofs[index],
          "onward presentation keeps the exact retained proof",
        );
        assertEquals(forwarded.inspected?.accepted, true);
      }
    }));
}

/** The same protocol story swaps concrete implementations while every actor keeps its own encrypted store. */
async function derivedIssuanceAndUnblind({ issuer, holder, verifier, plan }: DerivedIpexPeers): Promise<void> {
  assertEquals(new Set([issuer.info.pre, holder.info.pre, verifier.info.pre]).size, 3, "three independent identities");
  const grant = await issuer.prepareDerived(holder.info.pre);
  await observed(
    "holder retained the fresh pending Grant",
    async () => (await holder.snapshot(grant)).inspected?.escrowed ? true : undefined,
  );
  const original = await Promise.all([issuer.snapshot(grant), holder.snapshot(grant)]);
  const registry = JSON.parse(original[0].nodes[0].raw).rd as string;
  assertExists(registry);
  for (const snapshot of original) {
    assertEquals(snapshot.inspected?.accepted, false);
    assertEquals(snapshot.rootPresent, false, "a pending Grant cannot create root custody");
    assertEquals(snapshot.encrypted, true);
    assertEquals(snapshot.admit, null);
    assertExists(snapshot.deadline);
    assertExists(snapshot.grantRaw);
    assertEquals(snapshot.witnesses, { threshold: 2, count: 3 });
  }
  assertEquals(original[0].grantRaw, original[1].grantRaw, "both stores retain the exact fresh Grant body");
  assertEquals((await verifier.snapshot(undefined, registry)).rootPresent, false);

  // Each side explicitly approves setup; only authenticated DH completion supplies issuance custody.
  await holder.approveDh(grant);
  for (const peer of [issuer, holder]) assertEquals((await peer.snapshot(grant)).rootPresent, false);
  await issuer.approveDh(grant);
  for (const peer of [issuer, holder]) {
    await observed(
      `${peer.implementation} completed DH`,
      async () => (await peer.snapshot(grant)).auxiliaryReady ? true : undefined,
    );
    const snapshot = await peer.snapshot(grant);
    assertEquals(snapshot.rootPresent, true);
    assertEquals(snapshot.inspected?.accepted, false, "DH completion is separate from issued Grant acceptance");
    assertEquals(snapshot.admit, null);
  }
  const issued = await issuer.issueDerived(grant);
  for (const peer of [issuer, holder]) {
    await observed(
      `${peer.implementation} accepted the witnessed issued BUP`,
      async () => (await peer.snapshot(grant)).registryHead === issued ? true : undefined,
    );
  }
  for (const peer of [issuer, holder]) await peer.finishDh(grant);
  for (const [index, peer] of [issuer, holder].entries()) {
    const snapshot = await peer.snapshot(grant);
    assertEquals(snapshot.inspected?.accepted, true);
    assertEquals(snapshot.registryHead, issued, "the derived BUP is accepted under the witnessed issuer anchor");
    assertEquals(snapshot.grantRaw, original[index].grantRaw);
    assertEquals(snapshot.deadline, original[index].deadline);
    assertEquals(snapshot.admit, null, "derived issuance does not Admit");
  }
  const admitted = await exchange(holder, issuer, "admit", grant);
  const histories = await Promise.all([issuer.snapshot(grant), holder.snapshot(grant)]);
  for (const snapshot of histories) {
    assertEquals(snapshot.admit, admitted);
    assertEquals(snapshot.nodes.length, 1);
    assertEquals(snapshot.nodes[0].said, issuer.info.commitment);
    assertEquals(snapshot.nodes[0].attributes.status.value, "citizen");
    assertEquals(typeof snapshot.nodes[0].attributes.private, "string");
    assertEquals(snapshot.nodes[0].raw.includes("hidden-value"), false);
    assertExists(snapshot.nodes[0].proof);
  }
  const heldView = histories[1].nodes.map(({ raw, proof }) => ({ raw, proof }));

  // The verifier learns the newer public BUP, while the holder still presents its exact admitted old view.
  await holder.useUnblind();
  await verifier.useUnblind();
  await holder.connect(verifier.info, plan);
  await verifier.connect(holder.info, plan);
  const updated = await issuer.publishUpdate(verifier.info);
  assertNotEquals(updated, issued);
  await observed(
    "verifier accepted the newer public BUP",
    async () => (await verifier.snapshot(undefined, registry)).registryHead === updated ? true : undefined,
  );
  assertEquals(
    (await verifier.snapshot(undefined, registry)).openingPresent,
    false,
    "public state does not disclose its opening",
  );
  assertEquals((await holder.snapshot(grant)).registryHead, issued);
  assertEquals((await verifier.snapshot(undefined, registry)).rootPresent, false);
  const presentation = await holder.present(grant);
  await observed(
    "rootless verifier retained the stale presentation",
    async () => (await verifier.snapshot(presentation)).inspected?.escrowed ? true : undefined,
  );
  const pending = await verifier.snapshot(presentation), sent = await holder.snapshot(presentation);
  assertEquals(pending.inspected?.accepted, false);
  assertEquals(
    await Promise.all(pending.nodes.map(async ({ raw, proof }) => ({ raw, proof: await comparableProof(proof) }))),
    await Promise.all(heldView.map(async ({ raw, proof }) => ({ raw, proof: await comparableProof(proof) }))),
  );
  assertEquals(sent.nodes.map(({ raw, proof }) => ({ raw, proof })), heldView);
  assertEquals(pending.admit, null);
  assertExists(pending.deadline);
  assertEquals(pending.rootPresent, false);
  assertEquals(pending.auxiliaryReady, false, "receipt cannot approve opening disclosure");

  // Explicit release and request carry the new public suffix, then finish this presentation only.
  await holder.approveUnblind(presentation);
  await verifier.approveUnblind(presentation);
  for (const peer of [holder, verifier]) {
    await observed(
      `${peer.implementation} verified the opening reply`,
      async () => (await peer.snapshot(presentation)).auxiliaryReady ? true : undefined,
    );
  }
  assertEquals(
    (await holder.snapshot(presentation)).registryHead,
    updated,
    "the authenticated query imports the public suffix",
  );
  assertEquals(
    (await verifier.snapshot(presentation)).inspected?.accepted,
    false,
    "verified reply still needs explicit finish",
  );
  await holder.finishUnblind(presentation);
  await verifier.finishUnblind(presentation);
  const repaired = await verifier.snapshot(presentation);
  assertEquals(repaired.inspected?.accepted, true);
  assertEquals(repaired.grantRaw, pending.grantRaw);
  assertEquals(repaired.deadline, pending.deadline);
  assertEquals(repaired.nodes.map(node => node.raw), heldView.map(node => node.raw));
  assertNotEquals(repaired.nodes[0].proof, heldView[0].proof, "the new presentation alone gains current opening proof");
  assertEquals(repaired.admit, null);
  assertEquals(repaired.rootPresent, false, "Unblind never transfers the registry root");
  const acceptance = await exchange(verifier, holder, "admit", presentation);
  for (const peer of [holder, verifier]) assertEquals((await peer.snapshot(presentation)).admit, acceptance);

  for (const [index, peer] of [issuer, holder].entries()) {
    const after = await peer.snapshot(grant), before = histories[index];
    assertEquals(after.grantRaw, before.grantRaw);
    assertEquals(after.deadline, before.deadline);
    assertEquals(after.admit, before.admit);
    assertEquals(
      after.nodes.map(({ raw, proof }) => ({ raw, proof })),
      before.nodes.map(({ raw, proof }) => ({ raw, proof })),
      "later presentation and Admit preserve the original admitted evidence",
    );
    assertEquals(after.rootPresent, true);
  }
  assertEquals((await verifier.snapshot(undefined, registry)).rootPresent, false);
}

Deno.test("IPEX reciprocal TypeScript issuer → KERIpy holder: derived issuance and rootless verifier Unblind", () =>
  withDerivedIpexPeers({ issuer: "TypeScript" }, derivedIssuanceAndUnblind));

Deno.test("IPEX reciprocal KERIpy issuer → TypeScript holder: derived issuance and rootless verifier Unblind", () =>
  withDerivedIpexPeers({ issuer: "KERIpy" }, derivedIssuanceAndUnblind));
