/**
 * Spawn long-lived test subprocesses that cannot outlive the test process.
 *
 * Cleanup hooks (`finally`, unload, signal listeners) never run when the test
 * runtime is SIGKILLed or panics, and Deno cannot place children in their own
 * process group, so a crashed test used to orphan witnesses and agents to
 * launchd/init. Instead, each child runs under `child-lifetime-guard.ts`, which
 * holds a stdin pipe from this process and stops the child on EOF. The kernel
 * closes that pipe however this process dies, so no polling or signal handling
 * is needed here. See the guard module for the signal and exit-code contract.
 */

const GUARD_PATH = new URL("./child-lifetime-guard.ts", import.meta.url).pathname;

/** Command options accepted by {@link spawnGuardedChild}; stdin is reserved. */
export type GuardedCommandOptions = Omit<Deno.CommandOptions, "stdin">;

/** Child handle without stdin, which the lifetime guard owns. */
export type GuardedChild = Pick<Deno.ChildProcess, "pid" | "status" | "stdout" | "stderr" | "kill">;

/**
 * Spawn `command` under the lifetime guard.
 *
 * The returned handle's `kill()` signals the guard, which forwards SIGTERM,
 * SIGINT, and SIGHUP to the real child. `kill("SIGKILL")` asks the guard to
 * SIGKILL the real child, which then exits with code 137 (no `signal`); a
 * SIGKILL on the guard alone would orphan the child. The guard's stdin pipe is closed once
 * the child exits so test resource sanitizers see no leaked handle.
 */
export function spawnGuardedChild(
  command: string,
  options: GuardedCommandOptions = {},
): GuardedChild {
  const { args = [], ...rest } = options;
  const child = new Deno.Command(Deno.execPath(), {
    ...rest,
    args: ["run", "--quiet", "--no-config", "--allow-run", GUARD_PATH, command, ...args],
    stdin: "piped",
  }).spawn();
  const lifetime = child.stdin;
  const status = child.status.finally(async () => {
    await lifetime.close().catch(() => undefined);
  });
  return {
    pid: child.pid,
    status,
    get stdout() {
      return child.stdout;
    },
    get stderr() {
      return child.stderr;
    },
    // SIGKILL cannot be forwarded; the guard maps SIGUSR2 to a child SIGKILL.
    kill: (signal?: Deno.Signal) => child.kill(signal === "SIGKILL" ? "SIGUSR2" : signal),
  };
}
