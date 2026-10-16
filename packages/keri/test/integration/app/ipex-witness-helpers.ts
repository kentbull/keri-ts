/** Real witnessed KEL/registry preparation and signed IPEX wire for composed interop cases. */
import {
  type CesrFrame,
  Diger,
  NonceDex,
  Noncer,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  type SealEvent,
  type SerderACDC,
  type SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import type { Registry } from "../../../src/acdc/registraring.ts";
import type { AgentRuntime } from "../../../src/app/agent-runtime.ts";
import { requestFrame } from "../../../src/app/cesr-egress.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "../../../src/app/habbing.ts";
import { WitnessReceiptor } from "../../../src/app/witnessing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { messageAttachmentGroups } from "../../../src/core/protocol-serialization.ts";

/** Fresh commitment salts keep independent test runs and hidden fields distinct. */
export function nonce(): string {
  return new Noncer({ code: NonceDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }).qb64;
}

/** Actual detached-header egress; transport success is followed by store assertions. */
export async function post(url: string, frame: CesrFrame): Promise<void> {
  await run(function*() {
    const response = yield* requestFrame(url, frame, { signal: AbortSignal.timeout(10_000) });
    const body = yield* call(() => response.text());
    assertEquals(response.status, 204, body);
  });
}

/** Replay accepted KEL evidence, including authentic witness receipts, through HTTP. */
export async function introduce(url: string, hby: Habery, pre: string): Promise<void> {
  const state = hby.db.getKever(pre);
  assertExists(state);
  for (let sn = 0; sn <= state.sn; sn++) {
    const { message } = acceptedEventReplayMessage(hby, pre, sn);
    for (const frame of parseBytes(message)) await post(url, frame);
  }
}

/** Each independent member contributes only its own controller signature. */
export function signed(body: SerderKERI, signers: readonly Hab[], nests: CesrFrame[] = []): CesrFrame {
  const hab = signers[0];
  return {
    body,
    gvrsn: Vrsn_2_0,
    nests,
    attachments: messageAttachmentGroups({
      tsgs: [
        new TransIdxSigGroup(
          new Prefixer({ qb64: hab.pre }),
          NumberPrimitive.fromNum(BigInt(hab.kever!.lastEst.s)),
          new Diger({ qb64: hab.kever!.lastEst.d }),
          signers.flatMap((signer) => signer.sign(body.raw, true)),
        ),
      ],
    }, Vrsn_2_0),
  };
}

/** Publish a full registry anchor and collect receipts before declaring it accepted. */
export function* anchor(
  event: SerderACDC,
  signers: readonly Hab[],
  runtimes: readonly AgentRuntime[],
): Operation<SealEvent> {
  const data = [{ i: event.regid ?? event.said, s: event.sad!.n, d: event.said }];
  if (signers.length === 1) signers[0].interact({ data });
  else {
    const partials = runtimes.map((runtime) => runtime.hby.interactGroupHab(signers[0].name, undefined, { data }));
    for (const [index, runtime] of runtimes.entries()) {
      // Both members approve this locally authored interaction; HTTP intake remains unprotected.
      yield* runtime.reactor.processBytes(partials[1 - index].message, { local: true });
      runtime.hby.kevery.processEscrows();
      assertEquals(signers[index].kever!.serder.said, partials[index].serder.said);
    }
  }
  const hab = signers[0], runtime = runtimes[0];
  yield* new WitnessReceiptor(runtime.hby, { reactor: runtime.reactor, services: runtime.services }).submit(hab.pre);
  const serder = hab.kever!.serder;
  assertEquals(hab.db.wigs.get([hab.pre, serder.said!]).map((signature) => signature.index).sort(), [0, 1, 2]);
  return { i: new Prefixer({ qb64: hab.pre }), s: serder.sner!, d: new Diger({ qb64: serder.said! }) };
}

/** Check a local registry's actual accepted head after its witnessed KEL dependency arrives. */
export function accepted(registry: Registry, event: SerderACDC): void {
  registry.processEscrows();
  assertEquals(registry.head?.qb64, event.said);
}
