/** Loopback webhook host owned by the issuer/holder/verifier CLI workflow. */
export function startStaticHttpHost(handler: (request: Request, url: URL) => Response | Promise<Response>) {
  const server = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    request => handler(request, new URL(request.url)),
  );
  return { origin: `http://127.0.0.1:${server.addr.port}`, close: () => server.shutdown() };
}
