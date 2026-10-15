/** Feed actual TS nested output to the frozen Python extractor; no database or runtime dispatch is involved. */
import { b } from "../src/core/bytes.ts";
import { discardFrame } from "../src/core/frame.ts";
import { collectPayload, MemoryPayloadSink } from "../src/core/payload.ts";
import type { CesrFrame } from "../src/core/types.ts";
import { parseBytes } from "../src/parser/complete.ts";
import { essrPayload } from "../src/parser/essr.ts";
import { framePayload, type SerializeOptions } from "../src/parser/serialize.ts";
import depthVector from "../test/fixtures/nested-depth.json" with { type: "json" };
import vectors from "../test/fixtures/nested-vectors.json" with { type: "json" };

/** Explicit executable keeps the reference environment independent of the developer's PATH. */
const python = Deno.args[0];
if (!python) throw new Error("Pass the frozen KERIpy environment's Python executable; set its PYTHONPATH explicitly");
/** Small finite corpus sent once to the independent Python checker. */
const rows = [];
/** Materialize only this small qualification corpus; production serializers expose open() streams. */
async function emit(name: string, frame: CesrFrame, tree: unknown, options: SerializeOptions, essr?: string) {
  const bytes = await collectPayload(framePayload(frame, options));
  return { name, hex: Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""), tree, essr };
}
for (const row of vectors.rows) {
  const [frame] = await parseBytes(b(row.qb64));
  try {
    for (const domain of ["txt", "bny"] as const) {
      rows.push(await emit(`${row.name}-${domain}`, frame, row.tree, { domain }));
    }
  } finally {
    await discardFrame(frame);
  }
}
// Build expected ownership from frozen Python data, independently of TS traversal.
let deepTree = { sad: depthVector.sad, sigers: [depthVector.signature], nests: [] as unknown[] };
for (let level = 1; level < depthVector.depth; level++) {
  deepTree = { sad: depthVector.sad, sigers: [depthVector.signature], nests: [deepTree] };
}
const [deepFrame] = await parseBytes(b(depthVector.qb64));
for (const domain of ["txt", "bny"] as const) {
  rows.push(await emit(`depth-${depthVector.depth}-${domain}`, deepFrame, deepTree, { domain }));
}
/** A protocol-v1 body can be serialized under either supported attachment genus. */
const legacy = vectors.rows.find((row) => row.name === "JSON-v1")!;
for (const major of [1, 2] as const) {
  for (const domain of ["txt", "bny"] as const) {
    const [frame] = await parseBytes(b(legacy.qb64));
    rows.push(await emit(`normalized-${major}-${domain}`, frame, legacy.tree, { gvrsn: { major, minor: 0 }, domain }));
  }
}
for (const domain of ["txt", "bny"] as const) {
  const [frame] = await parseBytes(b(vectors.rows[0].qb64));
  frame.nests![0].attachments = [];
  const tree = structuredClone(vectors.rows[0].tree);
  tree.nests[0].sigers = [];
  rows.push(await emit(`empty-child-${domain}`, frame, tree, { domain }));
}
// Exercise streaming-only ESSR descendants against Python as well as native signature-only fixtures.
const row = vectors.rows.find((row) => row.name === "child-genus-selector")!;
for (const domain of ["txt", "bny"] as const) {
  const [frame] = await parseBytes(b(row.qb64));
  const sink = new MemoryPayloadSink();
  await sink.write(b("4BABYWJj4BABeHl6"));
  frame.nests![0].essr = essrPayload(await sink.finish(), 2, 6, frame.nests![0].gvrsn!);
  try {
    rows.push(await emit(`nested-essr-${domain}`, frame, row.tree, { domain }, "61626378797a"));
  } finally {
    await discardFrame(frame);
  }
}
/** The checker validates imported source before parsing any emitted bytes. */
const child = new Deno.Command(python, {
  args: [new URL("check-nested-serialization.py", import.meta.url).pathname],
  stdin: "piped",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
/** Backpressure applies even to this finite probe's input handoff. */
const writer = child.stdin.getWriter();
await writer.write(b(JSON.stringify({ signer: vectors.signer, rows })));
await writer.close();
if (!(await child.status).success) throw new Error("Frozen Python rejected TS nested serialization");
