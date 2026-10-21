/** Qualify actual multisig builders, accepted exchange storage, and replay against frozen Python927. */
import { b, type CesrFrame, concatBytes, Counter, Kinds, parseBytes, t, Vrsn_2_0 } from "cesr-ts";
import { call, run } from "effection";
import { Exchanger } from "../src/app/exchanges/exchanging.ts";
import { createHabery } from "../src/app/identity/habbing.ts";
import {
  loadMultisigHandlers,
  multisigInceptExn,
  multisigInteractExn,
  multisigRotateExn,
  multisigRpyExn,
} from "../src/app/multisig/grouping.ts";
import { envelopeFromFrame } from "../src/app/protocol/parsering.ts";

/** Require explicit executable selection independently of shell PATH. */
const python = Deno.args[0];
if (!python) throw new Error("Pass Python with PYTHONPATH selecting frozen upstream714 source");
/** A finite test corpus; never used as a production collector. */
const corpus: {
  local: string;
  bootstrap: number[][];
  rows: { wire: number[]; stored: string[]; said: string; child: string }[];
} = {
  local: "",
  bootstrap: [],
  rows: [],
};
await run(function*() {
  const hby = yield* createHabery({ name: `qualify-multisig-${crypto.randomUUID()}`, temp: true, skipConfig: true });
  try {
    const local = hby.makeHab("local");
    const member = hby.makeHab("sender");
    const icp = member.db.clonePreIter(member.pre, 0).next().value!;
    const rot = member.rotate();
    const ixn = member.interact();
    const rpy = member.reply("/end/role/add", { cid: member.pre, role: "controller", eid: local.pre });
    corpus.local = local.pre;
    corpus.bootstrap = [...member.db.clonePreIter(member.pre, 0)].map((wire) => [...wire]);
    hby.habs.delete(member.pre);
    const exchanger = new Exchanger(hby);
    loadMultisigHandlers(hby, exchanger);
    // Frozen native builders leave ri/x/p empty and cannot parse their own output. Keep this unqualified.
    let nativeRejected = false;
    try {
      yield* multisigInceptExn(member, [local.pre, member.pre], null, icp, null, { pvrsn: Vrsn_2_0, kind: Kinds.cesr });
    } catch (error) {
      nativeRejected = error instanceof Error && error.message.includes("native field ri");
    }
    if (!nativeRejected) throw new Error("Requalify native defaults before changing this unsupported boundary");
    for (const kind of [Kinds.json, Kinds.cbor, Kinds.mgpk]) {
      const options = { pvrsn: Vrsn_2_0, kind };
      const mids = [local.pre, member.pre];
      for (
        const build of [
          () => multisigInceptExn(member, mids, mids, icp, null, options),
          () => multisigRotateExn(local.pre, member, mids, mids, rot, options),
          () => multisigInteractExn(local.pre, member, mids, ixn, options),
          () => multisigRpyExn(local.pre, member, rpy, options),
        ]
      ) {
        const [serder, childWire] = yield* build();
        const endorsed = member.endorse(serder, { pipelined: false, gvrsn: Vrsn_2_0 });
        const wire = concatBytes(
          Counter.makeGVC(Vrsn_2_0),
          serder.raw,
          Counter.enclose({
            qb64: concatBytes(endorsed.subarray(serder.size), childWire),
            code: "AttachmentGroup",
            version: Vrsn_2_0,
          }),
        );
        const frames = yield* call(() => parseBytes(wire));
        try {
          if (frames.length !== 1) throw new Error("Builder did not preserve its single parent tree");
          const input = envelopeFromFrame(frames[0]);
          const decision = yield* exchanger.processEvent(input);
          if (decision.kind !== "accept") throw new Error(JSON.stringify(decision));
          const replay = yield* call(async () => {
            const chunks: Uint8Array[] = [];
            for await (const chunk of exchanger.replay(serder.said!)) chunks.push(chunk);
            return concatBytes(...chunks);
          });
          corpus.rows.push({
            wire: [...replay],
            stored: hby.db.enst.get([serder.said!]),
            said: serder.said!,
            child: input.nests[0].body.said!,
          });
        } finally {
          yield* call(async () => {
          });
        }
      }
    }
  } finally {
    yield* hby.close(true);
  }
});
/** Python consumes real accepted replay bytes and returns its independently serialized trees. */
const worker = new Deno.Command(python, {
  args: [new URL("check-nested-multisig.py", import.meta.url).pathname],
  stdin: "piped",
  stdout: "piped",
  stderr: "inherit",
}).spawn();
/** Qualification input is restricted to the small fixed route/format matrix above. */
const writer = worker.stdin.getWriter();
await writer.write(b(JSON.stringify(corpus)));
await writer.close();
const result = await worker.output();
if (!result.success) throw new Error("Frozen Python rejected nested multisig evidence");
/** Verify the reference's subtree serializer output on the return path. */
const returned = JSON.parse(t(result.stdout)) as { said: string; wire: number[] }[];
for (const row of returned) {
  const frames: CesrFrame[] = await parseBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), new Uint8Array(row.wire)));
  {
    if (frames.length !== 1 || frames[0].body.said !== row.said) throw new Error("Reference replay child mismatch");
  }
}
console.log(
  JSON.stringify({
    reference: "7143832813cac6a394ab1faf9be83bb3372be87c",
    acceptedWrappers: corpus.rows.length,
    replayedChildren: returned.length,
    unsupportedNativeDefaultBuilder: true,
  }),
);
