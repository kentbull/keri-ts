/** Qualify real enst. rows against frozen Python extraction, forwarding policy, and duplicate replacement. */
import { b, parseBytes, SerderKERI } from "cesr-ts";
import { call, run } from "npm:effection@^3.6.0";
import vectors from "../../cesr/test/fixtures/nested-vectors.json" with { type: "json" };
import { createHabery } from "../src/app/identity/habbing.ts";
import { prepareNests, publishNests } from "../src/db/exchange/exchange-nests.ts";

/** Explicit executable keeps the frozen source environment independent of PATH. */
const python = Deno.args[0];
if (!python) throw new Error("Pass Python with PYTHONPATH selecting frozen 71438328 source");
/** Retain only this finite qualification corpus; production stores one bounded row per child. */
const rows: { name: string; wire: string; tree: unknown }[] = [];
await run(function*() {
  const hby = yield* createHabery({ name: `qualify-nests-${crypto.randomUUID()}`, temp: true, skipConfig: true });
  try {
    yield* call(async () => {
      for (const vector of vectors.rows) {
        const [frame] = await parseBytes(b(vector.qb64));
        {
          // The actual production publisher preserves the same Python IoSet bytes without private pointers.
          const wires = await prepareNests([frame]);
          hby.db.env!.transactionSync(() => {
            publishNests(hby.db, frame.body.said!, wires);
            hby.db.exns.pin([frame.body.said!], frame.body as SerderKERI);
          });
          for (const wire of hby.db.enst.getIter([frame.body.said!])) {
            rows.push({ name: vector.name, wire, tree: vector.tree });
          }
        }
      }
    });
  } finally {
    yield* hby.close(true);
  }
});
console.log(
  `Stored row allocation: max=${Math.max(...rows.map((row) => b(row.wire).length))} bytes, corpus=${
    rows.reduce((size, row) => size + b(row.wire).length, 0)
  } bytes`,
);
/** Validate the bytes read back from LMDB, not independently serialized test doubles. */
const child = new Deno.Command(python, {
  args: [new URL("check-nested-exchange.py", import.meta.url).pathname],
  stdin: "piped",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();
/** Keep process input bounded by the small committed fixture corpus. */
const writer = child.stdin.getWriter();
await writer.write(b(JSON.stringify({ signer: vectors.signer, rows })));
await writer.close();
if (!(await child.status).success) throw new Error("Frozen Python rejected stored nested exchange rows");
