import { action, type Operation } from "effection";

interface HookDemoArgs {
  http?: number;
}

interface HookPresentation {
  credential: string;
  type: string;
  issuer: string;
  holder: string;
  schema: string;
  attributes: Record<string, unknown>;
}

/** Start a Sally-style sample webhook target for verifier callbacks. */
export function* hookDemoCommand(args: Record<string, unknown>): Operation<void> {
  const commandArgs: HookDemoArgs = {
    http: args.http ? Number(args.http) : 9923,
  };
  const port = commandArgs.http ?? 9923;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid hook demo HTTP port: ${port}`);
  }

  const received = new Map<string, HookPresentation>();
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  Deno.addSignalListener("SIGINT", shutdown);
  Deno.addSignalListener("SIGTERM", shutdown);
  const server = Deno.serve(
    {
      port,
      hostname: "127.0.0.1",
      signal: controller.signal,
      onListen: ({ port }) => {
        console.log(`Tufa hook demo listening on ${port}`);
      },
    },
    async (request) => handleHookRequest(request, received),
  );

  try {
    yield* action<void>((resolve, reject) => {
      server.finished.then(resolve).catch((error) => {
        if (controller.signal.aborted) {
          resolve();
          return;
        }
        reject(error);
      });
      return () => controller.abort();
    });
  } finally {
    Deno.removeSignalListener("SIGINT", shutdown);
    Deno.removeSignalListener("SIGTERM", shutdown);
    controller.abort();
  }
}

async function handleHookRequest(
  request: Request,
  received: Map<string, HookPresentation>,
): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/health") {
    return Response.json({ status: "ok" });
  }
  if (url.pathname !== "/") {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  if (request.method === "GET") {
    const holder = url.searchParams.get("holder");
    if (!holder) {
      return Response.json({ error: "Missing holder query parameter" }, { status: 400 });
    }
    const presentation = received.get(holder);
    if (!presentation) {
      return Response.json({ error: `No credential presented by ${holder}` }, { status: 404 });
    }
    return Response.json(presentation);
  }
  if (request.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!isRecord(body) || !isRecord(body.data)) {
    return Response.json({ error: "No data in body" }, { status: 400 });
  }
  const data = body.data;
  const holder = typeof data.recipient === "string" ? data.recipient : "";
  if (!holder) {
    return Response.json({ error: "No recipient in body data" }, { status: 400 });
  }
  const schema = typeof data.schema === "string" ? data.schema : "";
  const presentation: HookPresentation = {
    credential: typeof data.credential === "string" ? data.credential : "",
    type: schema,
    issuer: typeof body.actor === "string" ? body.actor : "",
    holder,
    schema,
    attributes: isRecord(data.attributes) ? data.attributes : {},
  };
  received.set(holder, presentation);
  console.log(JSON.stringify({ received: presentation }));
  return new Response("", { status: 202 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
