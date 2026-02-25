import { ValidationError } from "../../../core/errors.ts";
import {
  each,
  type Operation,
  spawn,
  type Stream,
  stream,
  type Subscription,
  withResolvers,
} from "npm:effection@^3.6.0";

export interface KliExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Runs `kli` as a child process and collects exit code and stdio. */
export async function runKli(
  args: string[],
  env?: Record<string, string>,
): Promise<KliExecResult> {
  try {
    const cmd = new Deno.Command("kli", {
      args,
      stdout: "piped",
      stderr: "piped",
      env,
    });
    const out = await cmd.output();
    return {
      code: out.code,
      stdout: new TextDecoder().decode(out.stdout),
      stderr: new TextDecoder().decode(out.stderr),
    };
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new ValidationError(
        "kli executable not found on PATH. Install KERIpy CLI to use interoperability bridge.",
      );
    }
    throw error;
  }
}

/** Effection operation wrapper around {@link runKli}. */
export function* runKliOp(
  args: string[],
  env?: Record<string, string>,
): Operation<KliExecResult> {
  const { operation, resolve, reject } = withResolvers<KliExecResult>();
  const task = yield* spawn(function* () {
    runKli(args, env)
      .then(resolve)
      .catch((error) =>
        reject(error instanceof Error ? error : new Error(String(error)))
      );
  });
  yield* task;
  return yield* operation;
}

/** Replays captured bridge stdout/stderr through this process output streams. */
export function* relayBridgeOutput(result: KliExecResult): Operation<void> {
  const tasks = [];
  if (result.stdout.trim().length > 0) {
    tasks.push(yield* spawn(() => processText(result.stdout, console.log)));
  }
  if (result.stderr.trim().length > 0) {
    tasks.push(yield* spawn(() => processText(result.stderr, console.error)));
  }
  for (const task of tasks) {
    yield* task;
  }
}

/** Splits text into lines and emits them through a provided output sink. */
function* processText(
  text: string,
  out: (line: string) => void,
): Operation<void> {
  const lineStream: Stream<string, void> = stream(lineGenerator(text));
  const _subscription: Subscription<string, void> = yield* lineStream;

  for (const line of yield* each(lineStream)) {
    out(line);
    yield* each.next();
  }
}

/** Async line generator used to create an Effection stream from static text. */
async function* lineGenerator(
  text: string,
): AsyncGenerator<string, void, void> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    if (line.length > 0) yield line;
  }
}
