/**
 * Lifetime guard process for long-lived test subprocesses.
 *
 * Usage: `deno run --no-config --allow-run child-lifetime-guard.ts <cmd> [args...]`
 *
 * The owning test process holds the write end of this guard's stdin pipe and
 * never writes to it. When the owner exits for any reason, including SIGKILL or
 * a runtime panic that skips every cleanup hook, the kernel closes that pipe and
 * the guard reads EOF. The guard then stops its child (SIGTERM, then SIGKILL
 * after a grace period). SIGTERM/SIGINT/SIGHUP sent to the guard are forwarded
 * the same way. SIGKILL cannot be caught or forwarded, so the owner requests an
 * immediate child SIGKILL with SIGUSR2 instead; killing the guard itself would
 * orphan a child that still holds the owner's stdout/stderr pipes and ports.
 * The guard exits with the child's exit code as soon as the
 * child is gone, so normal test cleanup through `kill()` and `status` behaves as
 * it did without the guard. A child killed by a signal surfaces as code
 * `128 + signo` with no `signal`, because the guard itself exits normally.
 *
 * Kept import-free so it starts quickly under `--no-config`.
 */
const KILL_GRACE_MS = 3_000;

const [command, ...args] = Deno.args;
if (!command) {
  console.error("child-lifetime-guard: missing command");
  Deno.exit(2);
}

// Every signal handler is installed before the child exists. The owner learns the
// child is running only from the child's own output, so it can never signal a guard
// that has not yet armed its handlers: an unhandled SIGTERM/SIGUSR2 would kill the
// guard by default action (exit 143/140) and orphan the child it was about to start.
// Spawning is synchronous, so no handler can run between installing them and creating it.
let child: Deno.ChildProcess | undefined;
let stopping = false;

function killChild(signal: Deno.Signal): void {
  try {
    child?.kill(signal);
  } catch {
    // Already exited.
  }
}

function stopChild(): void {
  if (stopping) return;
  stopping = true;
  killChild("SIGTERM");
  setTimeout(() => killChild("SIGKILL"), KILL_GRACE_MS);
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  Deno.addSignalListener(signal, stopChild);
}
Deno.addSignalListener("SIGUSR2", () => {
  stopping = true;
  killChild("SIGKILL");
});

child = new Deno.Command(command, {
  args,
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

(async () => {
  try {
    for await (const _chunk of Deno.stdin.readable) {
      // The owner never writes; only EOF matters.
    }
  } catch {
    // A broken stdin means the owner is gone too.
  }
  stopChild();
})();

const status = await child.status;
Deno.exit(status.code);
