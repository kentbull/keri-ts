import type { CesrFrame, EssrPayload } from "./types.ts";

/** Release a delivered tree, attempting every distinct owner even if a discard fails. */
export async function discardFrame(frame: CesrFrame): Promise<void> {
  const owners = new Set<EssrPayload>();
  /** Visit plain owned records without imposing a second parser state model. */
  function visit(node: CesrFrame): void {
    if (node.essr) {
      owners.add(node.essr);
      // Claim once before awaiting: overlapping consumer scopes may both release this tree.
      delete node.essr;
    }
    for (const child of node.nests ?? []) visit(child);
  }
  visit(frame);
  const results = await Promise.allSettled(Array.from(owners, async (owner) => await owner.discard()));
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) throw new AggregateError(failures.map((result) => result.reason), "Frame tree cleanup failed");
}

/** Fail explicitly until a consumer implements nested-message evidence and ownership. */
export function requireFlatFrame(frame: CesrFrame, consumer: string): void {
  if (frame.nests?.length) throw new Error(`${consumer} does not yet support nested message trees`);
}
