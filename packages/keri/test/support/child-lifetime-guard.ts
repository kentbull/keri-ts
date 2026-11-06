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
 * the same way, and the guard exits with the child's exit code as soon as the
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

const child = new Deno.Command(command, {
  args,
  stdin: "null",
  stdout: "inherit",
  stderr: "inherit",
}).spawn();

let stopping = false;
function stopChild(): void {
  if (stopping) return;
  stopping = true;
  try {
    child.kill("SIGTERM");
  } catch {
    return; // Already exited.
  }
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      // Exited during the grace period.
    }
  }, KILL_GRACE_MS);
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  Deno.addSignalListener(signal, stopChild);
}

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
