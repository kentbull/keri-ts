import { assertEquals, assertThrows } from "jsr:@std/assert";
import { Deck, DeckFullError } from "../../../src/core/deck.ts";
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
