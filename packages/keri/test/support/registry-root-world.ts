/**
 * Real-object registry root world shared by the unit and runtime tests.
 *
 * An individual issuer holds a registry root; Alice and Bob form a 2-of-2
 * holder group, optionally with Outsider committed as a next-key member. Each
 * side owns a Habery, a v2 registry and an agent runtime whose registered
 * `RegistryRoot` (`runtime.registryRoot`) is the side's route owner.
 */
import {
  type CesrFrame,
  makeBlindState,
  MtrDex,
  parseBytes,
  Salter,
  type SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, type Operation } from "effection";
import { assertEquals, assertExists, assertNotEquals } from "jsr:@std/assert";
import { acdcmap, blindate, regcept } from "../../src/acdc/messaging.ts";
import { Regery } from "../../src/acdc/registraring.ts";
import type { RegistryRoot } from "../../src/acdc/salting.ts";
import { type Hab, type Habery } from "../../src/app/identity/habbing.ts";
import { createHabery } from "../../src/app/identity/lmdb-habery.ts";
import { type AgentRuntime, createAgentRuntime } from "../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient, type HttpClient } from "../../src/app/transport/http-client.ts";
import { exchange } from "../../src/core/protocol-eventing.ts";
import { messagize } from "../../src/core/protocol-serialization.ts";
import { prepareNests, publishNests } from "../../src/db/exchange/exchange-nests.ts";
import { openLmdbRegistry } from "../../src/db/lmdb-stores.ts";

export interface Side {
  name: string;
  hby: Habery;
  hab: Hab;
  rgy: Regery;
  runtime: AgentRuntime;
  root: RegistryRoot;
  group?: Hab;
}

export interface World {
  sides: Side[];
  issuer: Side;
  alice: Side;
  bob: Side;
  outsider: Side;
  registry: string;
  root: Salter;
  opening: ReturnType<typeof makeBlindState>;
  event: SerderACDC;
  acdc: string;
  credential: SerderACDC;
  gid: string;
  late: [Side, Uint8Array, Uint8Array][];
  held: Uint8Array[];
}

export const encoder = new TextEncoder();

export function said(wire: Uint8Array): string {
  return parseBytes(wire)[0].body.said!;
}

export function* receive(side: Side, wire: Uint8Array, local = false): Operation<void> {
  yield* side.runtime.reactor.processBytes(wire, { local });
}

export function stored(side: Side): string[] {
  return side.root.pending().map(item => item.said);
}

export function notes(side: Side) {
  return [...side.runtime.notifier!.noter.notes.getTopItemIter()].map(([, note]) => note);
}

/** Run the side's ordinary Exchanger escrow pass, which drives `RegistryRoot.processEscrows`. */
export function* escrows(side: Side): Operation<void> {
  yield* side.runtime.exc.processEscrows();
}

/** Deliver the late side's deferred issuer KEL and TEL. */
export function* catchUp(w: World): Operation<void> {
  for (const [side, kel, tel] of w.late) {
    yield* receive(side, kel);
    yield* receive(side, tel);
  }
}

export function held(w: World, side: Side, gid = w.gid) {
  return side.hby.mgr.getRegistryRoot(gid, w.registry);
}

/**
 * Individual issuer; Alice/Bob 2-of-2 holder group, optionally Outsider as next-key member.
 * `plain` sides have an unencrypted Keeper, which can never retain a root.
 * `http` is every side's runtime HTTP client.
 */
export function* world(
  {
    enabled = true,
    newcomer = false,
    late = [] as string[],
    plain = [] as string[],
    http = undefined as
      | HttpClient
      | undefined,
  } = {},
): Operation<World> {
  const sides: Side[] = [];
  for (const name of ["issuer", "alice", "bob", "outsider"]) {
    const hby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: plain.includes(name) ? undefined : `${name}RootReplicaPasscode`,
    });
    yield* ensure(() => hby.close(true));
    const hab = hby.makeHab(name);
    const baser = yield* openLmdbRegistry({ name: crypto.randomUUID(), temp: true });
    yield* ensure(() => baser.close(true));
    const rgy = new Regery(hby, baser);
    const runtime = yield* createAgentRuntime(hby, http ?? new FetchHttpClient(), systemClock, {
      acdc: rgy,
      kram: { enabled, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
    });
    yield* ensure(() => runtime.close());
    assertExists(runtime.notifier);
    const root = runtime.registryRoot!;
    sides.push({ name, hby, hab, rgy, runtime, root });
  }
  const [issuer, alice, bob, outsider] = sides;
  for (const side of sides) {
    for (const other of sides) {
      if (side === other) continue;
      for (const wire of other.hby.db.clonePreIter(other.hab.pre!, 0)) yield* receive(side, wire);
    }
  }
  const mids = [alice.hab.pre!, bob.hab.pre!];
  const creations = [alice, bob].map(side =>
    side.hby.makeGroupHab("group", side.hab, mids, newcomer ? [...mids, outsider.hab.pre!] : mids, undefined, {
      isith: "2",
      nsith: "1",
    })
  );
  alice.group = creations[0].hab;
  bob.group = creations[1].hab;
  const inception = messagize(creations[0].serder, {
    sigers: creations.flatMap(creation => creation.sigers),
    gvrsn: Vrsn_2_0,
  });
  for (const side of sides) {
    yield* receive(side, inception, true);
    assertExists(side.hby.db.getKever(alice.group.pre!));
  }
  const gid = alice.group.pre!;
  const deferred: World["late"] = [];
  const transfer = function*(event: SerderACDC, sn: number) {
    const kel = issuer.hab.interact({ data: [{ i: event.regid ?? event.said!, s: sn.toString(16), d: event.said! }] });
    yield* receive(issuer, event.raw);
    for (const side of sides.slice(1)) {
      if (late.includes(side.name)) {
        deferred.push([side, kel, event.raw]);
        continue;
      }
      yield* receive(side, kel);
      yield* receive(side, event.raw);
    }
  };
  const rip = regcept(issuer.hab.pre!);
  yield* transfer(rip, 0);
  const root = new Salter({ raw: encoder.encode("public-test-root"), code: MtrDex.Salt_128 });
  issuer.hab.mgr.putRegistryRoot(issuer.hab.pre!, rip.said!, root);
  const acdc = acdcmap(issuer.hab.pre!, { regid: rip.said!, attribute: { d: "", i: gid, role: "member" } });
  const opening = makeBlindState({ salt: root.qb64, sn: 1, acdc: acdc.said!, state: "issued" });
  const event = blindate(rip.said!, rip.said!, opening.d.nonce);
  yield* transfer(event, 1);
  for (const side of sides) {
    if (!late.includes(side.name)) assertEquals(side.rgy.store.headEvent(rip.said!)?.said, event.said);
  }
  return {
    sides,
    issuer,
    alice,
    bob,
    outsider,
    registry: rip.said!,
    root,
    opening,
    event,
    acdc: acdc.said!,
    credential: acdc,
    gid,
    late: deferred,
    held: [],
  };
}

/** One further registry with its own root, ACDC, issued opening and accepted BUP. */
export interface Issued {
  registry: string;
  root: Salter;
  acdc: SerderACDC;
  opening: ReturnType<typeof makeBlindState>;
  event: SerderACDC;
}

/**
 * Issue one more registry and publish its KEL anchors and TEL to every side.
 *
 * `group` false: the individual issuer authors it and holds its root, like the
 * world's first registry. `group` true: the Alice/Bob group is the issuer, its
 * 2-of-2 interactions anchor the TEL, and Alice, the custodian, holds the root
 * for the group. `label` must be 16 bytes, the Salt128 root material. Use only
 * in worlds without late sides.
 */
export function* issueRegistry(w: World, label: string, { group = false } = {}): Operation<Issued> {
  const issuer = group ? w.gid : w.issuer.hab.pre!;
  const anchor = function*(event: SerderACDC, sn: number) {
    const seal = { i: event.regid ?? event.said!, s: sn.toString(16), d: event.said! };
    let kel: Uint8Array;
    if (group) {
      const proposals = [w.alice, w.bob].map(side => side.hby.interactGroupHab("group", undefined, { data: [seal] }));
      assertEquals(proposals[0].serder.raw, proposals[1].serder.raw);
      kel = messagize(proposals[0].serder, { sigers: proposals.flatMap(part => part.sigers), gvrsn: Vrsn_2_0 });
    } else kel = w.issuer.hab.interact({ data: [seal] });
    for (const side of w.sides) {
      yield* receive(side, kel, group);
      yield* receive(side, event.raw);
    }
  };
  const rip = regcept(issuer);
  yield* anchor(rip, 0);
  const root = new Salter({ raw: encoder.encode(label), code: MtrDex.Salt_128 });
  (group ? w.alice : w.issuer).hby.mgr.putRegistryRoot(issuer, rip.said!, root);
  const acdc = acdcmap(issuer, { regid: rip.said!, attribute: { d: "", i: w.gid, role: label } });
  const opening = makeBlindState({ salt: root.qb64, sn: 1, acdc: acdc.said!, state: "issued" });
  const event = blindate(rip.said!, rip.said!, opening.d.nonce);
  yield* anchor(event, 1);
  for (const side of w.sides) assertEquals(side.rgy.store.headEvent(rip.said!)?.said, event.said);
  return { registry: rip.said!, root, acdc, opening, event };
}

/** Store one exchange with nested evidence as the Exchanger does: its `exns` body plus `enst` rows. */
export function* storeExchange(side: Side, serder: SerderKERI, nests: CesrFrame[]): Operation<string> {
  const wires = yield* call(() => prepareNests(nests));
  side.hby.db.exns.pin([serder.said!], serder);
  publishNests(side.hby.db, serder.said!, wires);
  return serder.said!;
}

/**
 * Store a Grant disclosing `acdcs` at `side`, the only hint evidence a holder
 * without an opening has. `wrapped` stores only the `/multisig/exn` proposal
 * nesting that Grant, as a member that signed the proposal holds it.
 */
export function* storeGrant(side: Side, acdcs: readonly SerderACDC[], { wrapped = false } = {}): Operation<string> {
  const gid = side.group?.pre ?? side.hab.pre!;
  const grant = exchange("/ipex/grant", { sender: gid, attributes: { m: "" } });
  const nodes: CesrFrame[] = acdcs.map(acdc => ({ body: acdc, attachments: [], gvrsn: Vrsn_2_0 }));
  if (!wrapped) return yield* storeExchange(side, grant, nodes);
  const proposal = exchange("/multisig/exn", { sender: side.hab.pre!, attributes: { gid, exn: grant.said! } });
  return yield* storeExchange(side, proposal, [{ body: grant, attachments: [], gvrsn: Vrsn_2_0, nests: nodes }]);
}

/** Send one authorized copy from the sender's individual habitat and return its SAID. */
export function* copy(w: World, sender: Side, recipient: Side, { td, gid }: { td?: string; gid?: string } = {}) {
  const wire = sender.root.prepare(sender.hab, recipient.hab.pre!, gid ?? w.gid, w.registry, { td: td ?? w.acdc });
  yield* receive(recipient, wire);
  return said(wire);
}

/** The issuer's cross-party copy gives Alice's group its first root on arrival. */
export function* seed(w: World): Operation<void> {
  yield* copy(w, w.issuer, w.alice);
  assertEquals(held(w, w.alice)?.qb64, w.root.qb64);
  assertEquals(stored(w.alice), []);
}

/** Real member and group rotations; `current` becomes the signing roster. */
export function* rotate(w: World, members: Side[], current: Side[], sith: string, hold: Side[] = []) {
  for (const member of members) {
    const kel = member.hab.rotate();
    for (const side of w.sides) if (side !== member) yield* receive(side, kel);
  }
  const smids = current.map(side => side.hab.pre!);
  for (const side of current) {
    side.group ??= side.hby.joinGroupHab(w.gid, "group", side.hab, smids, smids);
  }
  const signers = current.filter(side => !hold.includes(side));
  const proposals = signers.map(side => side.hby.rotateGroupHab("group", smids, smids, { isith: sith, nsith: sith }));
  for (const proposal of proposals) assertEquals(proposal.serder.raw, proposals[0].serder.raw);
  const event = proposals[0].serder;
  const wire = messagize(event, { sigers: proposals.flatMap(proposal => proposal.sigers), gvrsn: Vrsn_2_0 });
  w.held = [wire];
  for (const side of w.sides) {
    if (hold.includes(side)) {
      assertNotEquals(side.hby.db.getKever(w.gid)!.said, event.said);
      continue;
    }
    yield* receive(side, wire, true);
    assertEquals(side.hby.db.getKever(w.gid)!.said, event.said);
  }
  for (const side of signers) side.hby.joinGroupHab(w.gid, "group", side.hab, smids, smids);
  return event.said!;
}
