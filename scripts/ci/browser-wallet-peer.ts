/**
 * Control server for the counterparty of the browser wallet scenario, run inside the lane's Docker
 * network. `POST /tufa` with `{ "args": [...], "timeoutMs": n }` runs one `tufa` command from this
 * working tree and answers `{ code, stdout, stderr }`; `GET /ready` answers 200. The scenario runner
 * decides what the peer does and when; the commands are the ordinary Tufa CLI over the peer's own
 * LMDB store under /work/peer. `POST /config` with `{ "name": store, "config": {...} }` replaces that
 * store's configuration file (the CLI has no flag for the KRAM setting an IPEX peer needs). `POST /file` with `{ "name", "content" }` writes a file under /work/peer/files and answers its path. Listens on 0.0.0.0:$PEER_PORT inside the lane's network namespace;
 * the anchor container publishes it on the host's loopback only.
 */

const port = Number(Deno.env.get("PEER_PORT") ?? "55811");
const decoder = new TextDecoder();

/** Request body of `POST /tufa`. */
interface TufaRequest {
  args: string[];
  timeoutMs?: number;
}

/** Run one tufa command and collect its output; a command that outlives its deadline is killed and reports code -1. */
async function runTufa({ args, timeoutMs = 120_000 }: TufaRequest) {
  const process = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "--unstable-ffi", "packages/tufa/mod.ts", ...args],
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const timer = setTimeout(() => process.kill("SIGKILL"), timeoutMs);
  try {
    const out = await process.output();
    return {
      code: out.success ? 0 : out.code,
      stdout: decoder.decode(out.stdout),
      stderr: decoder.decode(out.stderr),
      timedOut: out.signal === "SIGKILL",
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve({ hostname: "0.0.0.0", port }, async (request) => {
  const { pathname } = new URL(request.url);
  if (request.method === "GET" && pathname === "/ready") return new Response("ready");
  if (request.method === "POST" && pathname === "/tufa") {
    return Response.json(await runTufa(await request.json() as TufaRequest));
  }
  if (request.method === "POST" && pathname === "/config") {
    const { name, config } = await request.json() as { name: string; config: unknown };
    if (!/^[\w-]+$/.test(name)) return new Response("bad store name", { status: 400 });
    await Deno.mkdir("/work/peer/keri/cf", { recursive: true });
    await Deno.writeTextFile(`/work/peer/keri/cf/${name}.json`, JSON.stringify(config));
    return new Response("ok");
  }
  if (request.method === "POST" && pathname === "/file") {
    const { name, content } = await request.json() as { name: string; content: string };
    if (!/^[\w.-]+$/.test(name)) return new Response("bad file name", { status: 400 });
    await Deno.mkdir("/work/peer/files", { recursive: true });
    await Deno.writeTextFile(`/work/peer/files/${name}`, content);
    return Response.json({ path: `/work/peer/files/${name}` });
  }
  return new Response("not found", { status: 404 });
});
