import { ResourceLimitError } from "cesr-ts";

/** Hard queue backpressure, distinct from invalid protocol data or other byte limits. */
export class DeckFullError extends ResourceLimitError {}

/**
 * Double-ended queue with KERIpy-like naming.
 *
 * KERIpy correspondence:
 * - mirrors the operational surface of `hio.help.decking.Deck`
 *
 * Maintainer notes:
 * - `append()` and `push()` are synonyms for enqueue-at-tail
 * - `pull()` removes from the head, matching KERIpy cue processing loops
 * - the class intentionally stays small and synchronous because it is used as
 *   the flow-based handoff seam between long-running Effection operations
 */
export class Deck<T> implements Iterable<T> {
  #items: T[] = [];
  /** Maximum retained references; ordinary local decks remain unbounded unless configured. */
  #capacity = Infinity;

  /** Create a queue with optional initial contents and a hard reference limit. */
  constructor(initial?: Iterable<T>, capacity = Infinity) {
    this.capacity = capacity;
    if (initial) this.extend(initial);
  }

  /** Current hard reference limit, including every append/prepend/extend caller. */
  get capacity(): number {
    return this.#capacity;
  }

  /** Tighten a shared deck before admitting producers; existing entries are never discarded. */
  set capacity(value: number) {
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0)) {
      throw new RangeError("Invalid deck capacity");
    }
    if (this.length > value) throw new DeckFullError("Existing deck exceeds capacity");
    this.#capacity = value;
  }

  /** Preflight synchronous side effects whose resulting cues must fit without losing accepted work. */
  checkSpace(count = 1): void {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Invalid deck admission count");
    if (count > this.#capacity) throw new ResourceLimitError("Batch exceeds deck capacity");
    if (count > this.#capacity - this.length) throw new DeckFullError("Deck capacity exceeded");
  }

  /** Number of queued items. */
  get length(): number {
    return this.#items.length;
  }

  /** True when no items are queued. */
  get empty(): boolean {
    return this.#items.length === 0;
  }

  /** Append one item to the tail. */
  append(item: T): number {
    this.checkSpace();
    this.#items.push(item);
    return this.#items.length;
  }

  /** Alias for `append()` to match broader queue vocabulary. */
  push(item: T): number {
    return this.append(item);
  }

  /** Prepend one item to the head. */
  prepend(item: T): number {
    this.checkSpace();
    this.#items.unshift(item);
    return this.#items.length;
  }

  /** Remove and return the head item. */
  pull(): T | undefined {
    return this.#items.shift();
  }

  /** Remove and return the tail item. */
  pop(): T | undefined {
    return this.#items.pop();
  }

  /** Append all items from the iterable to the tail. */
  extend(items: Iterable<T>): number {
    const pending: T[] = [];
    for (const item of items) {
      this.checkSpace(pending.length + 1);
      pending.push(item);
    }
    // Validate the whole finite batch first: overflow or a failing iterator must leave the deck intact.
    this.checkSpace(pending.length);
    for (const item of pending) this.#items.push(item);
    return this.#items.length;
  }

  /** Remove all queued items. */
  clear(): void {
    this.#items.length = 0;
  }

  /** Read the head item without removing it. */
  peekHead(): T | undefined {
    return this.#items[0];
  }

  /** Read the tail item without removing it. */
  peekTail(): T | undefined {
    return this.#items.at(-1);
  }

  /** Snapshot current contents in queue order. */
  toArray(): T[] {
    return [...this.#items];
  }

  [Symbol.iterator](): Iterator<T> {
    return this.#items[Symbol.iterator]();
  }
}
