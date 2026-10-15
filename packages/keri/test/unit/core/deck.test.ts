import { ResourceAdmissionError, ResourceLimitError, ResourcePolicy, SerderKERI } from "cesr-ts";
import { assertEquals, assertThrows } from "jsr:@std/assert";
import { CueDeck } from "../../../src/core/cue-admission.ts";
import type { AgentCue } from "../../../src/core/cues.ts";
import { Deck, DeckFullError } from "../../../src/core/deck.ts";
import { incept } from "../../../src/core/protocol-eventing.ts";
Deno.test("Deck preserves FIFO pull order and supports prepend requeue", () => {
  const deck = new Deck<number>();

  assertEquals(deck.length, 0);
  deck.append(1);
  deck.push(2);
  deck.prepend(0);

  assertEquals(deck.length, 3);
  assertEquals(deck.pull(), 0);
  assertEquals(deck.pull(), 1);

  deck.prepend(9);
  assertEquals(deck.pull(), 9);
  assertEquals(deck.pop(), 2);
  assertEquals(deck.empty, true);
});

Deno.test("bounded Deck admits batches atomically and recovers after draining", () => {
  const deck = new Deck([1], 2);
  assertThrows(() => deck.extend([2, 3]), DeckFullError);
  assertEquals(deck.toArray(), [1]);
  /** A failed producer must not commit its earlier values into the queue. */
  function* broken() {
    yield 2;
    throw new Error("producer failed");
  }
  assertThrows(() => deck.extend(broken()), Error, "producer failed");
  assertEquals(deck.toArray(), [1]);
  deck.prepend(0);
  assertThrows(() => deck.append(2), DeckFullError);
  assertThrows(() => deck.prepend(-1), DeckFullError);
  assertEquals(deck.pull(), 0);
  deck.extend([2]);
  assertEquals(deck.toArray(), [1, 2]);
});

Deno.test("cue preparation holds slots and shared Serder bytes before publication", () => {
  const serder = incept(["DAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"]);
  const cues: AgentCue[] = [{ kin: "receipt", serder }, { kin: "witness", serder }];
  const resources = new ResourcePolicy();
  const deck = new CueDeck(resources, 2);
  const one = deck.prepare([cues[0]]);
  const singleBytes = resources.used.bytes;
  one.release();
  const batch = deck.prepare(cues);
  assertEquals(resources.used.bytes < 2 * singleBytes, true, "One shared Serder/backing is charged once");
  const occupied = resources.reserve({ bytes: resources.limits.bytes - resources.used.bytes });
  if (occupied.kind !== "reserve") throw new Error("Expected remaining byte admission");
  const refused = assertThrows(
    () => new CueDeck(resources).prepare([{ kin: "proof", said: "other" }]),
    ResourceAdmissionError,
  );
  assertEquals(refused.reason, "busy");
  occupied.reservation.release();
  assertEquals(deck.length, 0);
  assertThrows(() => deck.push({ kin: "proof", said: "other" }), DeckFullError);
  assertThrows(() => deck.capacity = 1, RangeError);
  batch.publish();
  batch.release(); // finally-release cannot revoke published ownership.
  assertEquals(deck.length, 2);
  assertEquals(deck instanceof Deck, false);
  assertEquals("pull" in deck || "pop" in deck || "prepend" in deck, false);
  const first = deck.takeOwned()!;
  const bytes = resources.used.bytes;
  const transferred = first.transfer();
  first.release();
  assertEquals(resources.used.bytes, bytes);
  assertThrows(() => first.cue, Error, "transferred");
  const prepend = Deck.prototype.prepend;
  try {
    Deck.prototype.prepend = () => {
      throw new Error("requeue failed");
    };
    assertThrows(() => deck.requeue(transferred), Error, "requeue failed");
  } finally {
    Deck.prototype.prepend = prepend;
  }
  assertEquals([deck.length, resources.used.bytes], [1, bytes]);
  deck.requeue(transferred);
  assertEquals(resources.used.bytes, bytes);
  assertThrows(() => deck.push(cues[0]), DeckFullError, "occupied");
  deck.clear();
  assertEquals(resources.used.bytes, 0);
  assertEquals(deck.empty, true);
  const shared = new SerderKERI({ raw: serder.raw.subarray(0), verify: false });
  const separate = new SerderKERI({ raw: serder.raw.slice(), verify: false });
  const sharedBacking = deck.prepare([{ kin: "receipt", serder }, { kin: "receipt", serder: shared }]);
  const sharedBytes = resources.used.bytes;
  sharedBacking.release();
  const separateBacking = deck.prepare([{ kin: "receipt", serder }, { kin: "receipt", serder: separate }]);
  assertEquals(resources.used.bytes - sharedBytes, serder.raw.buffer.byteLength + 64);
  separateBacking.release();
});

Deno.test("cue fanout and active consumers retain credit through queued cleanup", () => {
  const resources = new ResourcePolicy();
  const deck = new CueDeck(resources, 2);
  deck.push({ kin: "proof", said: "credential" });
  const owner = deck.takeOwned()!;
  const retained = resources.used.bytes;
  const duplicate = owner.retain();
  assertEquals(resources.used.bytes, retained + 128);
  assertThrows(() => owner.retain(), DeckFullError);
  deck.clear();
  assertEquals(resources.used.bytes, retained + 128);
  owner.release();
  assertEquals(resources.used.bytes, retained + 128);
  duplicate.release();
  duplicate.release();
  assertEquals(resources.used.bytes, 0);
  deck.push({ kin: "proof", said: "later" });
  const later = deck.takeOwned()!;
  assertThrows(() => new CueDeck(resources).requeue(later), Error, "another");
  later.release();
});

Deno.test("cue refusal and failed publication release preparation without queue mutation", () => {
  const cue: AgentCue = { kin: "proof", said: "dependency" };
  const resources = new ResourcePolicy({ bytes: 1 });
  let walked = 0;
  const inspected = new Proxy(cue, {
    getOwnPropertyDescriptor(target, key) {
      walked++;
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
  });
  assertThrows(() => new CueDeck(resources).prepare([inspected]), ResourceAdmissionError, "inspection");
  assertEquals(walked, 0, "Refused inspection cannot walk metadata");
  assertEquals(resources.used.bytes, 0);
  const normal = new ResourcePolicy();
  const deck = new CueDeck(normal, 1);
  const unused = deck.prepare([cue]);
  unused.release();
  unused.release();
  assertEquals(normal.used.bytes, 0);
  assertThrows(() => unused.publish(), Error, "no longer");
  const prepared = deck.prepare([cue]);
  const original = Deck.prototype.extend;
  const failure = new Error("publication failed");
  try {
    Deck.prototype.extend = () => {
      throw failure;
    };
    assertEquals(assertThrows(() => prepared.publish()), failure);
    assertEquals([deck.length, normal.used.bytes], [0, 0]);
  } finally {
    Deck.prototype.extend = original;
  }
  const allocated = new CueDeck(normal, 2);
  allocated.push(cue);
  const existing = normal.used.bytes;
  const allocation = allocated.prepare([{ kin: "proof", said: "new" }]);
  const originalSet = WeakMap.prototype.set;
  let caught: unknown;
  try {
    WeakMap.prototype.set = () => {
      throw failure;
    };
    try {
      allocation.publish();
    } catch (error) {
      caught = error;
    }
  } finally {
    WeakMap.prototype.set = originalSet;
  }
  assertEquals([caught, allocated.toArray(), normal.used.bytes], [failure, [cue], existing]);
  allocated.clear();
  assertThrows(() => new CueDeck(normal, 0).prepare([cue]), ResourceLimitError);
  assertThrows(() => new CueDeck(normal, 1, 1).prepare([cue]), ResourceLimitError);
  let reads = 0;
  const metadata = {
    get said() {
      reads++;
      return "unexpected";
    },
    kin: "proof",
  } as AgentCue;
  assertThrows(() => deck.prepare([metadata]), RangeError, "accessors");
  assertEquals(reads, 0);
  let opened = false;
  assertThrows(
    () =>
      deck.prepare([{
        kin: "replay",
        messages: {
          *[Symbol.iterator]() {
            opened = true;
          },
        },
      }]),
    RangeError,
    "Opaque",
  );
  assertEquals([opened, normal.used.bytes], [false, 0]);
});

Deno.test("finite replay arrays share retained backing without opening opaque sources", () => {
  const resources = new ResourcePolicy();
  const deck = new CueDeck(resources);
  const backing = new Uint8Array(8192);
  const cue: AgentCue = { kin: "replay", messages: [backing.subarray(0, 1), backing.subarray(1, 2)] };
  const prepared = deck.prepare([cue]);
  const charge = resources.used.bytes;
  assertEquals(charge >= backing.byteLength && charge < 2 * backing.byteLength, true);
  prepared.release();
  assertEquals(resources.used.bytes, 0);
  let opened = 0;
  const fake = Object.create(null);
  Object.defineProperty(fake, Symbol.iterator, {
    get() {
      opened++;
      throw new Error("iterator accessed");
    },
  });
  assertThrows(() => deck.prepare([{ kin: "replay", messages: fake }]), RangeError, "Opaque");
  assertEquals([opened, resources.used.bytes], [0, 0]);
});
