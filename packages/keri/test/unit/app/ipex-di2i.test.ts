/** DI2I authority is checked against independently verified KELs, including witness exemptions. */
import {
  type CesrFrame,
  Diger,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SerderACDC,
  type SerderKERI,
  Siger,
  Vrsn_2_0,
} from "cesr-ts";
import { ensure, type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { acceptedEventReplayMessage, createHabery, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex-building.ts";
import { verifyIpexRelations, walkIpexGraph } from "../../../src/app/ipex-graph.ts";
import { loadIpexHandlers } from "../../../src/app/ipexing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/parsering.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";

/** Use the production witness local-ingress contract; an ordinary validator selects remote ingress. */
function* learn(hby: Habery, wire: Uint8Array, local = true): Operation<void> {
  for (const frame of parseBytes(wire)) yield* dispatchEnvelope(envelopeFromFrame(frame, local), hby.rvy, hby.kevery);
}

/** A witness signs the controller commitment, without pretending to approve its delegation. */
function witnessed(source: Habery, witness: Hab, serder: SerderKERI): Uint8Array {
  return messagize(serder, {
    sigers: source.db.getSigs(serder.pre!, serder.said!).map((qb64) => new Siger({ qb64 })),
    wigers: source.db.acceptedEventWitnesses(serder)!.length ? witness.sign(serder.raw, true) : [],
  });
}

/** Separate producer keys from a witness-held validator that can accept an unapproved DIP. */
function* delegationChain(depth: number, { dndAt = -1, knownRoot = true } = {}) {
  const source = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  yield* ensure(() => source.close(true));
  const validator = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
  yield* ensure(() => validator.close(true));
  const witness = validator.makeHab("witness", undefined, { transferable: false });
  const chain = [source.makeHab("root", undefined, { DnD: dndAt === 0 })];
  for (let i = 1; i <= depth; i++) {
    chain.push(source.makeHab(`delegate-${i}`, undefined, {
      delpre: chain[i - 1].pre,
      wits: [witness.pre],
      toad: 1,
      DnD: dndAt === i,
    }));
  }
  for (const [i, hab] of chain.entries()) {
    const wire = witnessed(source, witness, hab.kever!.serder);
    yield* learn(source, wire);
    if (i || knownRoot) {
      yield* learn(validator, wire);
      assertExists(validator.db.getKever(hab.pre));
    }
  }
  const approvals: Uint8Array[] = [];
  for (let i = 0; i < depth; i++) {
    chain[i].interact({ data: [{ i: chain[i + 1].pre, s: "0", d: chain[i + 1].pre }] });
    const wire = witnessed(source, witness, chain[i].kever!.serder);
    yield* learn(source, wire);
    approvals.push(wire);
  }
  return { source, validator, witness, chain, approvals };
}

/** A two-node graph is data only; actual grant tests authenticate both nodes separately. */
function graph(issuer: string, issuee: string | undefined, op: string | string[] | null = "DI2I", aggregate = false) {
  const far = acdcmap(
    issuer,
    aggregate
      ? { aggregate: ["", { d: "", i: issuee!, name: "authority" }] }
      : { issuee, attribute: { d: "", name: "authority" } },
  );
  const near = acdcmap(issuer, {
    attribute: { d: "", name: "near" },
    edge: { d: "", link: { n: far.said, ...(op === null ? {} : { o: op }) } },
  });
  const nodes = [near, far].map((body) => ({ body, attachments: [], gvrsn: Vrsn_2_0 }));
  return walkIpexGraph(near.said!, nodes, true)!;
}

for (const depth of [0, 1, 2, 3]) {
  Deno.test(`DI2I admits identity and every approved delegation hop: depth ${depth}`, async () => {
    await run(function*() {
      const { validator, chain, approvals } = yield* delegationChain(depth);
      for (const wire of approvals) yield* learn(validator, wire);
      const evidence = graph(chain.at(-1)!.pre, chain[0].pre);
      const before = chain.map((hab) => validator.db.aess.get([hab.pre, hab.pre]));
      assertEquals(verifyIpexRelations(evidence, validator.db), true);
      assertEquals(
        chain.map((hab) => validator.db.aess.get([hab.pre, hab.pre])),
        before,
        "relation lookup is read-only",
      );
    });
  });
}

Deno.test("DI2I admits an approved chain in a disinterested validator", async () => {
  await run(function*() {
    const { source, chain, approvals } = yield* delegationChain(3);
    const ordinary = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => ordinary.close(true));
    for (const [i, hab] of chain.entries()) {
      yield* learn(ordinary, acceptedEventReplayMessage(source, hab.pre, 0).message, false);
      ordinary.kevery.processEscrows();
      assertExists(ordinary.db.getKever(hab.pre));
      if (i < approvals.length) yield* learn(ordinary, approvals[i], false);
    }
    assertEquals(verifyIpexRelations(graph(chain[3].pre, chain[0].pre), ordinary.db), true);
  });
});

for (const missing of [0, 1, 2]) {
  Deno.test(`DI2I retains a dependency for an unapproved witness-held hop: ${missing}`, async () => {
    await run(function*() {
      const { validator, chain, approvals } = yield* delegationChain(3);
      for (const [i, wire] of approvals.entries()) if (i !== missing) yield* learn(validator, wire);
      assertExists(validator.db.getKever(chain[missing + 1].pre), "witness acceptance is not delegator approval");
      const evidence = graph(chain[3].pre, chain[0].pre);
      assertEquals(verifyIpexRelations(evidence, validator.db), { kind: "missingKel", pre: chain[missing].pre });
      yield* learn(validator, approvals[missing]);
      assertEquals(verifyIpexRelations(evidence, validator.db), true, "the approval event alone closes the gap");
    });
  });
}

for (const dndAt of [0, 1]) {
  Deno.test(`DI2I rechecks the delegator inception DND despite witness acceptance: ${dndAt}`, async () => {
    await run(function*() {
      const { validator, chain, approvals } = yield* delegationChain(2, { dndAt });
      for (const wire of approvals) yield* learn(validator, wire);
      assertExists(validator.db.getKever(chain[2].pre));
      assertEquals(verifyIpexRelations(graph(chain[2].pre, chain[0].pre), validator.db), false);
    });
  });
}

Deno.test("DI2I distinguishes missing issuer/delegator KELs from unrelated or untargeted relationships", async () => {
  await run(function*() {
    const { source, validator, chain, approvals } = yield* delegationChain(1, { knownRoot: false });
    assertEquals(verifyIpexRelations(graph(chain[1].pre, chain[0].pre), validator.db), {
      kind: "missingKel",
      pre: chain[0].pre,
    });
    yield* learn(validator, acceptedEventReplayMessage(source, chain[0].pre, 0).message);
    yield* learn(validator, approvals[0]);
    const unrelated = source.makeHab("unrelated");
    assertEquals(verifyIpexRelations(graph(chain[1].pre, unrelated.pre), validator.db), false);
    assertEquals(verifyIpexRelations(graph(chain[1].pre, undefined), validator.db), false);
    assertEquals(verifyIpexRelations(graph(unrelated.pre, chain[0].pre), validator.db), {
      kind: "missingKel",
      pre: unrelated.pre,
    });
  });
});

Deno.test("DI2I reads the far aggregate issuee and survives an unapproved later delegated rotation", async () => {
  await run(function*() {
    const { source, validator, witness, chain, approvals } = yield* delegationChain(1);
    yield* learn(validator, approvals[0]);
    chain[1].rotate();
    yield* learn(validator, witnessed(source, witness, chain[1].kever!.serder));
    assertEquals(validator.db.getKever(chain[1].pre)?.sn, 1);
    assertEquals(
      validator.db.aess.get([chain[1].pre, chain[1].kever!.said]),
      null,
      "the rotation has no delegator approval",
    );
    assertEquals(verifyIpexRelations(graph(chain[1].pre, chain[0].pre, "DI2I", true), validator.db), true);
  });
});

Deno.test("IPEX identity operators use wire order and targeted defaults", async () => {
  await run(function*() {
    const { validator, chain, approvals } = yield* delegationChain(1);
    yield* learn(validator, approvals[0]);
    const issuer = chain[1].pre, issuee = chain[0].pre;
    for (
      const [ops, result] of [
        [["I2I", "DI2I"], true],
        [["DI2I", "I2I"], false],
        [["I2I", "NI2I"], true],
        [["NI2I", "I2I"], false],
        [[], false],
        [["unsupported"], false],
      ] as const
    ) assertEquals(verifyIpexRelations(graph(issuer, issuee, [...ops]), validator.db), result, ops.join(","));
    assertEquals(verifyIpexRelations(graph(issuer, undefined, []), validator.db), true);
    assertEquals(verifyIpexRelations(graph(issuer, issuee, null), validator.db), false);
    assertEquals(verifyIpexRelations(graph(issuer, undefined, null), validator.db), true);
    assertEquals(verifyIpexRelations(graph(issuer, undefined, ""), validator.db), true);
  });
});

Deno.test("E1E keeps entity matching independent from explicit issuer identity constraints", async () => {
  await run(function*() {
    const { validator, chain, approvals } = yield* delegationChain(1);
    yield* learn(validator, approvals[0]);
    const issuer = chain[1].pre, issuee = chain[0].pre;
    const far = acdcmap(issuer, { issuee, attribute: { d: "", name: "far" } });
    for (
      const [operators, expected] of [
        [["E1E"], true],
        [["E1E", "I2I"], false],
        [["E1E", "DI2I"], true],
      ] as const
    ) {
      const near = acdcmap(issuer, {
        issuee,
        attribute: { d: "", name: "near" },
        edge: { d: "", link: { n: far.said, o: [...operators] } },
      });
      const evidence = walkIpexGraph(near.said!, [near, far].map((body) => ({ body, attachments: [] })), true)!;
      assertEquals(verifyIpexRelations(evidence, validator.db), expected);
    }
  });
});

/** Current key-state signatures authenticate a node independently from its parent's proof. */
function signedNode(body: SerderACDC, hab: Hab): CesrFrame {
  return {
    body,
    gvrsn: Vrsn_2_0,
    attachments: messageAttachmentGroups({
      tsgs: [
        new TransIdxSigGroup(
          new Prefixer({ qb64: hab.pre }),
          NumberPrimitive.fromNum(BigInt(hab.kever!.lastEst.s)),
          new Diger({ qb64: hab.kever!.lastEst.d }),
          hab.sign(body.raw, true),
        ),
      ],
    }, Vrsn_2_0),
  };
}

Deno.test("IPEX retains a signed DI2I grant until its delegator approval arrives", async () => {
  await run(function*() {
    const { validator, chain, approvals } = yield* delegationChain(1);
    const recipient = validator.makeHab("recipient");
    const evidence = graph(chain[1].pre, chain[0].pre);
    const nodes = [...evidence.nodes.values()].map(({ body }) => body);
    const nests = nodes.map((body) => signedNode(body, chain[1]));
    const grant = ipexExnBody(chain[1].pre, "/ipex/grant", nodes, {
      message: "approved issuer",
      recipient: recipient.pre,
      xid: nodes[0].said!,
      plan: nodes.map((body, index) => [(body.schema as { $id: string }).$id, index ? "/e/link/_/" : "/", [""]]),
    });
    const exchanger = new Exchanger(validator);
    loadIpexHandlers(validator, exchanger);
    const tsgs = [
      new TransIdxSigGroup(
        new Prefixer({ qb64: chain[1].pre }),
        NumberPrimitive.fromNum(0n),
        new Diger({ qb64: chain[1].kever!.lastEst.d }),
        chain[1].sign(grant.raw, true),
      ),
    ];
    assertEquals((yield* exchanger.processEvent({ serder: grant, tsgs, nests })).kind, "escrow");
    assertExists(validator.db.epse.get(grant.said!));
    assertEquals(validator.db.exns.get(grant.said!), null);
    yield* learn(validator, approvals[0]);
    yield* exchanger.processEscrows();
    assertExists(validator.db.exns.get(grant.said!));
    for (const node of nodes) assertEquals(validator.db.exns.get(node.said!), null);
  });
});
