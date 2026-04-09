export interface TestListenAddress {
  hostname: string;
  port: number;
}

export interface StartedStaticHost extends TestListenAddress {
  origin: string;
  close(): Promise<void>;
}

function assertTcpAddress(
  address: Deno.NetAddr | Deno.UnixAddr,
): Deno.NetAddr {
  if (address.transport !== "tcp") {
    throw new Error(`Expected TCP address, got ${address.transport}`);
  }
  return address;
}

/** Reserve one ephemeral localhost TCP port for tests that must know it up front. */
export function reserveTcpPort(hostname = "127.0.0.1"): number {
  const listener = Deno.listen({
    hostname,
    port: 0,
    transport: "tcp",
  });
  try {
    return assertTcpAddress(listener.addr).port;
  } finally {
    listener.close();
  }
}

/** Return one standard controller OOBI HTTP response for a seeded test host. */
export function controllerOobiResponse(
  pre: string,
  controllerBytes: Uint8Array,
): Response {
  return new Response(new Uint8Array(controllerBytes).buffer, {
    status: 200,
    headers: { "Content-Type": "application/cesr", "Oobi-Aid": pre },
  });
}

/**
 * Start a minimal static localhost host for OOBI and mailbox tests.
 *
 * The host binds on port `0` by default so tests can safely run in parallel
 * without hard-coded port literals.
 */
export async function startStaticHttpHost(
  handler: (request: Request, url: URL) => Response | Promise<Response>,
  {
    hostname = "127.0.0.1",
    port = 0,
  }: {
    hostname?: string;
    port?: number;
  } = {},
): Promise<StartedStaticHost> {
  const controller = new AbortController();
  const server = Deno.serve({
    hostname,
    port,
    signal: controller.signal,
  }, async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return new Response("ok", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
    return await handler(request, url);
  });

  const address = assertTcpAddress(server.addr);
  return {
    hostname: address.hostname,
    port: address.port,
    origin: `http://${address.hostname}:${address.port}`,
    async close() {
      controller.abort();
      try {
        await server.finished;
      } catch {
        // Abort-driven shutdown is expected here.
      }
    },
  };
}
