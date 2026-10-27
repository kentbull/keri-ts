/** Shared public-wire and TLS fixture for service owners and bilateral tests. */
import { b, BlindState, concatBytes, Counter, makeBlindState, SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { acdcmap, blindate, type Hab, query, regcept } from "keri-ts/runtime";
import { createServer } from "node:https";
import { fileURLToPath } from "node:url";
export const certificate = fileURLToPath(new URL("./server.pem", import.meta.url));
export const wrongCertificate = fileURLToPath(new URL("./wrong.pem", import.meta.url));
/** Same explicit public framing used by the existing native registry/service owner. */
export function framed(event: SerderACDC, opening?: ReturnType<typeof makeBlindState>): Uint8Array {
  const proof = opening
    ? Counter.enclose({ code: "BlindedStateQuadruples", version: Vrsn_2_0, qb64: BlindState.qb64b(opening) })
    : new Uint8Array();
  return concatBytes(event.raw, Counter.enclose({ code: "AttachmentGroup", version: Vrsn_2_0, qb64: proof }));
}
/** Public evidence endpoints explicitly use genus-two attachments over the exact stored signed bodies. */
export function kel(hab: Hab): Uint8Array {
  return concatBytes(
    Counter.makeGVC(Vrsn_2_0),
    ...Array.from(
      hab.db.fels.getAllItemIter(hab.pre),
      ([, fn, said]) => hab.db.cloneEvtMsg(hab.pre, fn, said, Vrsn_2_0),
    ),
  );
}
/** Real local authoring produces evidence; no receiver acceptance rows are injected. */
export function author(hab: Hab, name: string) {
  const rip = regcept(hab.pre), credential = acdcmap(hab.pre, { regid: rip.said!, attribute: { d: "", name } });
  const opening = makeBlindState({ acdc: credential.said!, state: "issued", sn: 1n, raw: b("0123456789abcdef") });
  const update = blindate(rip.said!, rip.said!, opening.d.nonce);
  hab.interact({ data: [{ s: rip.sad!.n, d: rip.said! }, { s: update.sad!.n, d: update.said! }] });
  const raw = concatBytes(kel(hab), framed(rip), framed(update, opening));
  return { rip, update, opening, credential, raw };
}
/** Signed query bytes are immutable across both HTTPS response hops. */
export function signed(hab: Hab, route: string, data: Record<string, unknown>) {
  return hab.endorse(query(route, data, { pre: hab.pre, version: Vrsn_2_0 }), { gvrsn: Vrsn_2_0 });
}

/** Node TLS accepts the existing dedicated public Python service certificate. */
export async function serveTls(pem: string, handler: (request: Request) => Response | Promise<Response>) {
  const server = createServer({ key: pem, cert: pem }, (incoming, outgoing) => {
    void (async () => {
      const chunks: Uint8Array[] = [];
      for await (const chunk of incoming) chunks.push(new Uint8Array(chunk));
      const body = concatBytes(...chunks);
      const response = await handler(
        new Request(`https://localhost${incoming.url}`, {
          method: incoming.method,
          headers: incoming.headers as Record<string, string>,
          ...(body.length ? { body: body.buffer as ArrayBuffer } : {}),
        }),
      );
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch(error => {
      outgoing.destroy(error);
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing TLS listener address");
  return {
    addr: address,
    shutdown: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  };
}
