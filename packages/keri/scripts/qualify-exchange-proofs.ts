/** Qualify real sender/source/supplemental proof storage and replay; nested IPEX remains separate. */
import {
  b,
  concatBytes,
  Diger,
  Kinds,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SealEvent,
  type SerderKERI,
  t,
  Vrsn_1_0,
  Vrsn_2_0,
} from "cesr-ts";
import { call, run } from "effection";
import { type ExchangeInput, Exchanger } from "../src/app/exchanges/exchanging.ts";
import { createHabery, type Hab } from "../src/app/identity/habbing.ts";
import { envelopeFromFrame } from "../src/app/protocol/parsering.ts";
import { TransIdxSigGroup } from "../src/core/dispatch.ts";
import { exchange } from "../src/core/exchange/protocol-exchanging.ts";

/** Require the explicit frozen interpreter/PYTHONPATH chosen by the qualification caller. */
const python = Deno.args[0];
if (!python) throw new Error("Pass the Python executable with PYTHONPATH selecting frozen upstream714");
/** Small bounded corpus only; production replay stays streamed. */
const corpus: {
  bootstrap: number[][];
  rows: {
    said: string;
    wire: number[];
    signers: string[];
    cigars: string[];
    seals: [string, number, string][];
    endorsers: string[];
  }[];
} = { bootstrap: [], rows: [] };

/** Bind the signature to accepted historical establishment keys. */
function sign(hab: Hab, serder: SerderKERI): TransIdxSigGroup {
  const est = hab.db.getEvtSerder(hab.pre, hab.kever!.lastEst.d)!;
  return new TransIdxSigGroup(
    new Prefixer({ qb64: hab.pre }),
    est.sner!,
    new Diger({ qb64: est.said! }),
    hab.sign(serder.raw, true),
  );
}

/** Source seals can refer to accepted interaction events containing this exact body SAID. */
function anchor(hab: Hab, serder: SerderKERI): SealEvent {
  hab.interact({ data: [{ d: serder.said }] });
  return {
    i: new Prefixer({ qb64: hab.pre }),
    s: NumberPrimitive.fromNum(BigInt(hab.kever!.serder.sn!)),
    d: new Diger({ qb64: hab.kever!.said }),
  };
}

await run(function*() {
  const hby = yield* createHabery({ name: `qualify-proof-${crypto.randomUUID()}`, temp: true, skipConfig: true });
  try {
    const sender = hby.makeHab("sender");
    const extra = hby.makeHab("extra");
    const nontrans = hby.makeHab("nontrans", undefined, { transferable: false });
    const exchanger = new Exchanger(hby, {
      handlers: [{
        resource: "/proof",
        acceptsSscs: true,
        /** Qualify the route-selection seam while keeping credential workflow claims out of this probe. */
        verifyEvidence({ factors, invalid }) {
          return invalid ? null : factors;
        },
        /** Assertions inspect durable proof rows after this callback. */
        handle() {},
      }],
    });
    for (const pvrsn of [Vrsn_1_0, Vrsn_2_0]) {
      for (const kind of [Kinds.json, Kinds.cbor, Kinds.mgpk]) {
        for (const mode of pvrsn.major === 1 ? ["mixed", "cigar"] : ["seal", "mixed", "cigar"]) {
          const serder =
            exchange("/proof", { mode }, { sender: mode === "cigar" ? nontrans.pre : sender.pre, pvrsn, kind })[0];
          const input: ExchangeInput = { serder };
          if (mode === "seal") input.sourceSeals = [anchor(sender, serder)];
          if (mode === "mixed") {
            input.tsgs = [sign(sender, serder), sign(extra, serder)];
            input.sourceSeals = [anchor(extra, serder)];
            input.cigars = nontrans.sign(serder.raw, false);
          }
          if (mode === "cigar") input.cigars = nontrans.sign(serder.raw, false);
          const decision = yield* exchanger.processEvent(input);
          if (decision.kind !== "accept") throw new Error(JSON.stringify(decision));
          const chunks: Uint8Array[] = [];
          yield* call(async () => {
            for await (const chunk of exchanger.replay(serder.said!)) chunks.push(chunk);
          });
          corpus.rows.push({
            said: serder.said!,
            wire: [...concatBytes(...chunks)],
            signers: input.tsgs?.map((group) => group.pre) ?? [],
            cigars: input.cigars?.map((cigar) => cigar.verfer!.qb64) ?? [],
            seals: input.sourceSeals?.map((seal) => [seal.i.qb64, Number(seal.s.num), seal.d.qb64]) ?? [],
            endorsers: mode === "mixed" ? [extra.pre, nontrans.pre] : [],
          });
        }
      }
    }
    for (const hab of [sender, extra, nontrans]) {
      for (const wire of hab.db.clonePreIter(hab.pre, 0)) corpus.bootstrap.push([...wire]);
    }
    const worker = new Deno.Command(python, {
      args: [new URL("check-exchange-proofs.py", import.meta.url).pathname],
      stdin: "piped",
      stdout: "piped",
      stderr: "inherit",
    }).spawn();
    const returned = yield* call(async () => {
      const writer = worker.stdin.getWriter();
      await writer.write(b(JSON.stringify(corpus)));
      await writer.close();
      const output = await worker.output();
      if (!output.success) throw new Error("Frozen upstream rejected proof corpus");
      return JSON.parse(t(output.stdout)) as { said: string; wire: number[] }[];
    });
    for (const row of returned) {
      const [frame] = yield* call(() => parseBytes(new Uint8Array(row.wire)));
      const input = envelopeFromFrame(frame);
      const decision = yield* exchanger.processEvent({ ...input, sourceSeals: input.ssts, lsgs: input.ssgs });
      if (decision.kind !== "accept" || decision.said !== row.said) throw new Error("Reference proof replay rejected");
    }
    console.log(
      JSON.stringify({
        reference: "7143832813cac6a394ab1faf9be83bb3372be87c",
        accepted: corpus.rows.length,
        replayed: returned.length,
        scope: "exchange proof factors only; nested IPEX not exercised",
      }),
    );
  } finally {
    yield* hby.close(true);
  }
});
