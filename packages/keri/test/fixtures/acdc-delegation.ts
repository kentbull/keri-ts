/** Existing DI2I real-KEL participants and fixed two-node fixtures, shared by evaluator and signed-grant owners. */
import { parseBytes, type SerderKERI, Siger } from "cesr-ts";
import { ensure, type Operation } from "effection";
import { assertExists } from "jsr:@std/assert";
import type { AcdcGraph } from "../../src/acdc/graphing.ts";
import { acdcmap } from "../../src/acdc/messaging.ts";
import { createHabery, type Hab, type Habery } from "../../src/app/identity/habbing.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../src/app/protocol/parsering.ts";
import { messagize } from "../../src/core/protocol-serialization.ts";

/** Use the production witness local-ingress contract; an ordinary validator selects remote ingress. */
export function* learn(hby: Habery, wire: Uint8Array, local = true): Operation<void> {
  for (const frame of parseBytes(wire)) yield* dispatchEnvelope(envelopeFromFrame(frame, local), hby.rvy, hby.kevery);
}

/** A witness signs the controller commitment, without pretending to approve its delegation. */
export function witnessed(source: Habery, witness: Hab, serder: SerderKERI): Uint8Array {
  return messagize(serder, {
    sigers: source.db.getSigs(serder.pre!, serder.said!).map((qb64) => new Siger({ qb64 })),
    wigers: source.db.acceptedEventWitnesses(serder)!.length ? witness.sign(serder.raw, true) : [],
  });
}

/** Separate producer keys from a witness-held validator that can accept an unapproved DIP. */
export function* delegationChain(depth: number, { dndAt = -1, knownRoot = true } = {}) {
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
export function graph(
  issuer: string,
  issuee: string | undefined,
  op: string | string[] | null = "DI2I",
  aggregate = false,
): AcdcGraph {
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
  return {
    nodes: new Map([[near.said!, { body: near }], [far.said!, { body: far }]]),
    order: [near.said!, far.said!],
    dependencyOrder: [far.said!, near.said!],
  };
}
