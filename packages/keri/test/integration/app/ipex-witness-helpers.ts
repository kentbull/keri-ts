/** Real witnessed KEL/registry preparation and signed IPEX wire for composed interop cases. */
import { collectBytes } from "../../../src/app/transport/byte-source.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";

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
  Siger,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import type { Registry } from "../../../src/acdc/registraring.ts";
import { acceptedEventReplayMessage, type Hab, type Habery } from "../../../src/app/identity/habbing.ts";
import type { AgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { requestFrame } from "../../../src/app/transport/cesr-egress.ts";
import { WitnessReceiptor } from "../../../src/app/witness/witnessing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";

/** Fresh commitment salts keep independent test runs and hidden fields distinct. */
export function nonce(): string {
  return new Noncer({ code: NonceDex.Salt_128, raw: crypto.getRandomValues(new Uint8Array(16)) }).qb64;
}

/** Actual detached-header egress; transport success is followed by store assertions. */
export async function post(url: string, frame: CesrFrame): Promise<void> {
  await run(function*() {
    const response = yield* requestFrame(url, frame, new FetchHttpClient(), {
      signal: AbortSignal.timeout(10_000),
    });
    const body = new TextDecoder().decode(yield* call(() => collectBytes(response.body())));
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
export function signed(body: SerderKERI | SerderACDC, signers: readonly Hab[], nests: CesrFrame[] = []): CesrFrame {
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
  yield* new WitnessReceiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock).submit(
    hab.pre,
  );
  const serder = hab.kever!.serder;
  assertEquals(hab.db.wigs.get([hab.pre, serder.said!]).map((signature) => signature.index).sort(), [0, 1, 2]);
  return { i: new Prefixer({ qb64: hab.pre }), s: serder.sner!, d: new Diger({ qb64: serder.said! }) };
}

/** Check a local registry's actual accepted head after its witnessed KEL dependency arrives. */
export function accepted(registry: Registry, event: SerderACDC): void {
  registry.processEscrows();
  assertEquals(registry.head?.qb64, event.said);
}

/** Observe the actual provider's accepted state; no command writes payload or protocol rows. */
export async function inspectMailbox(url: string, pre: string, saids: string[] = []): Promise<{
  provider: string;
  traffic: { method: string; destination: string | null; detached: boolean }[];
  sender: { event: string; witnesses: string[]; threshold: number; receipts: number[] } | null;
  rows: { said: string; cached: boolean; pending: boolean }[];
  queries: { said: string; stamp: string }[];
}> {
  const response = await fetch(`${url}_fixture`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "inspect", pre, saids }),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  assertEquals(response.status, 200, text);
  return JSON.parse(text);
}

/** Send accepted KEL evidence through the production bulk intake with explicit v2 genera. */
export async function postKel(url: string, hby: Habery, pre: string): Promise<void> {
  for (const event of hby.db.getEvtPreIter(pre)) {
    const wire = messagize(event, {
      sigers: hby.db.getSigs(pre, event.said!).map((qb64) => new Siger({ qb64 })),
      wigers: hby.db.wigs.get([pre, event.said!]),
      gvrsn: Vrsn_2_0,
      genusify: true,
    });
    const response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/cesr" },
      body: new Uint8Array(wire),
      signal: AbortSignal.timeout(10_000),
    });
    assertEquals(response.ok, true, await response.text());
  }
}

/** Require the provider to accept the complete KEL before forwarding or polling. */
export async function introduceProvider(url: string, hby: Habery, pre: string): Promise<void> {
  await postKel(url, hby, pre);
  const deadline = Date.now() + 10_000;
  let state;
  do {
    state = (await inspectMailbox(url, pre)).sender;
    if (state?.event === hby.db.getKever(pre)!.said) break;
    await new Promise((resolve) => setTimeout(resolve, 10));
  } while (Date.now() < deadline);
  assertEquals(state?.event, hby.db.getKever(pre)!.said);
}
