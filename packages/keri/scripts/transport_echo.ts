/**
 * The transport lane's own cross-origin server, for browser mechanics a real witness cannot
 * demonstrate on demand: header echo, a redirect, response-header exposure and a slow event stream
 * whose close it records. Everything is open to any origin.
 */

const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, PUT, OPTIONS" };

/** Start the echo server on an ephemeral 127.0.0.1 port; its origin differs from the page's. */
export function startEcho(): { origin: string; server: Deno.HttpServer } {
  const streams = new Map<string, { sent: number; aborted: boolean }>();
  const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (request) => {
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    const reflect = request.headers.get("access-control-request-headers");
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: { ...CORS, ...(reflect ? { "access-control-allow-headers": reflect } : {}) },
      });
    }
    const json = (body: unknown) => Response.json(body, { headers: CORS });
    switch (url.pathname) {
      case "/echo": {
        const received = new Uint8Array(await request.arrayBuffer());
        return json({
          ...Object.fromEntries(request.headers),
          "content-length": String(received.length),
          method: request.method,
        });
      }
      case "/redirect":
        return new Response(null, { status: 307, headers: { ...CORS, location: "/echo" } });
      case "/expose":
        // Only KERI-AID is exposed; CESR-ATTACHMENT and X-Hidden are present but not readable.
        return new Response("{}", {
          headers: {
            ...CORS,
            "cesr-attachment": "-AAA",
            "keri-aid": "Eaid",
            "x-hidden": "1",
            "access-control-expose-headers": "KERI-AID",
          },
        });
      case "/sse": {
        const state = { sent: 0, aborted: false };
        streams.set(id, state);
        const events = Number(url.searchParams.get("events") ?? 4);
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            for (; state.sent < events && !state.aborted; state.sent++) {
              controller.enqueue(new TextEncoder().encode(`id: ${state.sent}\nevent: /reply\ndata: x\n\n`));
              await new Promise((resolve) => setTimeout(resolve, 250));
            }
            if (!state.aborted) controller.close();
          },
          // The client closing the connection cancels the stream; that is the abort evidence.
          cancel() {
            state.aborted = true;
          },
        });
        return new Response(body, {
          headers: { ...CORS, "content-type": "text/event-stream", "cache-control": "no-cache" },
        });
      }
      case "/sse-state":
        return json(streams.get(id) ?? { sent: 0, aborted: false });
    }
    return new Response("not found", { status: 404, headers: CORS });
  });
  return { origin: `http://127.0.0.1:${server.addr.port}`, server };
}
