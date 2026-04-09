import { action, type Operation, spawn, type Task } from "effection";
import type { AgentRuntime } from "../../keri/runtime.ts";
import { type RuntimeHttpHostOptions, startServer } from "../src/host/http-server.ts";

export interface CmdResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type SpawnedChild = Deno.ChildProcess;

export interface TestListenAddress {
  hostname: string;
  port: number;
}

export interface StartedRuntimeServer {
  address: TestListenAddress;
  task: Task<void>;
}

export function packageRoot(): string {
  return new URL("../", import.meta.url).pathname;
}

export async function runCmd(
  command: string,
  args: string[],
  cwd = packageRoot(),
): Promise<CmdResult> {
  const out = await new Deno.Command(command, {
    args,
    cwd,
    stdout: "piped",
    stderr: "piped",
  }).output();

  const decoder = new TextDecoder();
  return {
    code: out.code,
    stdout: decoder.decode(out.stdout),
    stderr: decoder.decode(out.stderr),
  };
}

export async function runTufa(args: string[]): Promise<CmdResult> {
  return await runCmd(
    Deno.execPath(),
    ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
  );
}

export function spawnTufa(args: string[]): SpawnedChild {
  return new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-all", "--unstable-ffi", "mod.ts", ...args],
    cwd: packageRoot(),
    stdout: "piped",
    stderr: "piped",
  }).spawn();
}

function assertTcpAddress(
  address: Deno.NetAddr | Deno.UnixAddr,
): Deno.NetAddr {
  if (address.transport !== "tcp") {
    throw new Error(`Expected TCP address, got ${address.transport}`);
  }
  return address;
}

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

export async function waitForHealth(
  port: number,
  attempts = 40,
  host = "127.0.0.1",
): Promise<void> {
  const url = `http://${host}:${port}/health`;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        await response.text();
        return;
      }
    } catch {
      // Keep polling until the child is ready or exits.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for ${url}`);
}

export async function readChildOutput(child: SpawnedChild): Promise<string> {
  const [stdout, stderr] = await Promise.all([
    child.stdout ? new Response(child.stdout).text() : Promise.resolve(""),
    child.stderr ? new Response(child.stderr).text() : Promise.resolve(""),
  ]);
  return `${stdout}\n${stderr}`.trim();
}

export async function stopChild(child: SpawnedChild): Promise<string> {
  try {
    child.kill("SIGTERM");
  } catch {
    // The child may already be gone.
  }
  await child.status.catch(() => undefined);
  return await readChildOutput(child);
}

export function* fetchOp(url: string, init?: RequestInit): Operation<Response> {
  return yield* action((resolve, reject) => {
    const controller = new AbortController();
    const upstreamSignal = init?.signal;
    const abortUpstream = () => controller.abort(upstreamSignal?.reason);
    let settled = false;

    if (upstreamSignal) {
      if (upstreamSignal.aborted) {
        controller.abort(upstreamSignal.reason);
      } else {
        upstreamSignal.addEventListener("abort", abortUpstream, { once: true });
      }
    }

    fetch(url, { ...init, signal: controller.signal }).then((response) => {
      settled = true;
      resolve(response);
    }).catch(reject);

    return () => {
      upstreamSignal?.removeEventListener("abort", abortUpstream);
      if (!settled) {
        controller.abort();
      }
    };
  });
}

export function* promiseOp<T>(promise: Promise<T>): Operation<T> {
  return yield* action((resolve, reject) => {
    promise.then(resolve).catch(reject);
    return () => {};
  });
}

export function* textOp(response: Response): Operation<string> {
  return yield* action((resolve, reject) => {
    response.text().then(resolve, reject);
    return () => {};
  });
}

export function* sleepOp(ms: number): Operation<void> {
  yield* action((resolve) => {
    const timeoutId = setTimeout(() => resolve(undefined), ms);
    return () => clearTimeout(timeoutId);
  });
}

export function* waitForServer(
  port: number,
  {
    host = "127.0.0.1",
    maxAttempts = 20,
    attemptTimeoutMs = 100,
    retryDelayMs = 50,
  }: {
    host?: string;
    maxAttempts?: number;
    attemptTimeoutMs?: number;
    retryDelayMs?: number;
  } = {},
): Operation<void> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = yield* fetchOp(`http://${host}:${port}/health`, {
        signal: AbortSignal.timeout(attemptTimeoutMs),
      });
      if (response.ok) {
        yield* textOp(response);
        return;
      }
      yield* textOp(response);
    } catch {
      // Wait and retry until the server is reachable.
    }
    yield* sleepOp(retryDelayMs);
  }

  throw new Error(
    `Server on port ${port} did not become ready within ${maxAttempts} attempts.`,
  );
}

export function* waitForTaskHalt(
  task: Task<void>,
  settleMs = 50,
): Operation<void> {
  yield* task.halt();
  yield* sleepOp(settleMs);
}

export function* startTestServer(
  runtime?: AgentRuntime,
  options: RuntimeHttpHostOptions = {},
): Operation<StartedRuntimeServer> {
  const listening = Promise.withResolvers<TestListenAddress>();
  const task = yield* spawn(function*() {
    yield* startServer(0, undefined, runtime, {
      ...options,
      onListen: ({ hostname, port }) => {
        options.onListen?.({ hostname, port });
        listening.resolve({ hostname, port });
      },
    });
  });

  const address = yield* promiseOp(listening.promise);
  yield* waitForServer(address.port, {
    host: address.hostname,
    maxAttempts: 30,
  });
  return { address, task };
}
