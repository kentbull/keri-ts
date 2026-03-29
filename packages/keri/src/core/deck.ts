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
  #items: T[];

  constructor(initial?: Iterable<T>) {
    this.#items = initial ? [...initial] : [];
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
    this.#items.push(item);
    return this.#items.length;
  }

  /** Alias for `append()` to match broader queue vocabulary. */
  push(item: T): number {
    return this.append(item);
  }

  /** Prepend one item to the head. */
  prepend(item: T): number {
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
    for (const item of items) {
      this.#items.push(item);
    }
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
