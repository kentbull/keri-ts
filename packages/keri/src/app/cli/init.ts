import { createQueue, type Operation, spawn } from "npm:effection@^3.6.0";
import { PathError, ValidationError } from "../../core/errors.ts";
import {
  createAgentRuntime,
  processRuntimeUntil,
  runtimeHasPendingWork,
  runtimeHasWellKnownAuth,
  runtimeOobiTerminalState,
  type AgentRuntime,
} from "../agent-runtime.ts";
import { type CesrBodyMode, normalizeCesrBodyMode } from "../cesr-http.ts";
import { type Configer, createConfiger } from "../configing.ts";
import { createHabery, type Habery } from "../habbing.ts";

/**
 * Arguments for `tufa init`.
 */
interface InitArgs {
  /** Keystore name and file location of KERI keystore */
  name?: string;
  /** Additional optional prefix to file location of KERI keystore */
  base?: string;
  /** Directory override for database and keystore root (default fallback: ~/.tufa) */
  headDirPath?: string;
  /** Create a temporary keystore, used for testing */
  temp?: boolean;
  /** Qualified base64 salt for creating key pairs */
  salt?: string;
  /** Directory override for configuration data */
  configDir?: string;
  /** Configuration filename override */
  configFile?: string;
  /** 22 character encryption passcode for keystore (is not saved) */
  passcode?: string;
  /** Create an unencrypted keystore */
  nopasscode?: boolean;
  /** Qualified base64 of non-transferable identifier prefix for authentication and encryption of secrets in keystore */
  aeid?: string;
  /** Qualified base64 private-signing key (seed) for the aeid from which the private decryption key may be derived */
  seed?: string;
  /** Enable the Tufa-only durable outbox sidecar for this keystore. */
  outboxer?: boolean;
  /** Transport form for outbound CESR HTTP requests. */
  cesrBodyMode?: CesrBodyMode;
}

/**
 * Implements `tufa init`.
 *
 * Creates/open a habery keystore and database.
 */
export function* initCommand(args: Record<string, unknown>): Operation<void> {
  // Extract values from args
  const initArgs: InitArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    temp: args.temp as boolean | undefined,
    salt: args.salt as string | undefined,
    configDir: args.configDir as string | undefined,
    configFile: args.configFile as string | undefined,
    passcode: args.passcode as string | undefined,
    nopasscode: args.nopasscode as boolean | undefined,
    aeid: args.aeid as string | undefined,
    seed: args.seed as string | undefined,
    outboxer: args.outboxer as boolean | undefined,
    cesrBodyMode: normalizeCesrBodyMode(args.cesrBodyMode as string | undefined),
  };

  // Validate required name
  const name = initArgs.name;
  if (!name || name === "") {
    throw new ValidationError("Name is required and cannot be empty");
  }

  const base = initArgs.base || "";
  const headDirPath = initArgs.headDirPath;
  const temp = initArgs.temp || false;
  let bran = initArgs.passcode;
  const nopasscode = initArgs.nopasscode || false;

  // Handle passcode input if not provided and not using nopasscode
  if (!nopasscode && !bran) {
    console.log(
      "Creating encrypted keystore, please enter your 22 character passcode:",
    );

    // For now, we'll use a simple prompt since Deno doesn't have getpass equivalent
    // In a real implementation, you'd want to use a proper password input library
    const passcode = prompt("Passcode: ");
    const retry = prompt("Re-enter passcode: ");

    if (passcode !== retry) {
      throw new ValidationError("Passcodes do not match");
    }

    bran = passcode || undefined;
  }

  const cues = createQueue<{ kin: string; mode: string; name: string }, void>();
  const doer = yield* spawn(function*() {
    const cf: Configer | undefined = initArgs.configFile
      ? (yield* createConfiger({
        name: initArgs.configFile,
        base: "",
        temp: false,
        headDirPath: initArgs.configDir,
        reopen: true,
        clear: false,
      }))
      : undefined;
    let hby;
    try {
      hby = yield* createHabery({
        name,
        base,
        headDirPath,
        temp,
        cf,
        skipConfig: !cf,
        skipSignator: true,
        bran: bran ?? undefined,
        aeid: initArgs.aeid,
        seed: initArgs.seed,
        salt: initArgs.salt,
        outboxer: initArgs.outboxer ? "create" : "disabled",
        cesrBodyMode: initArgs.cesrBodyMode,
      });
    } catch (error) {
      if (temp || !(error instanceof PathError)) {
        throw error;
      }
      console.log(
        "Persistent keystore path unavailable, retrying with temporary keystore mode.",
      );
      hby = yield* createHabery({
        name,
        base,
        headDirPath,
        temp: true,
        cf,
        skipConfig: !cf,
        skipSignator: true,
        bran: bran ?? undefined,
        aeid: initArgs.aeid,
        seed: initArgs.seed,
        salt: initArgs.salt,
        outboxer: initArgs.outboxer ? "create" : "disabled",
        cesrBodyMode: initArgs.cesrBodyMode,
      });
    }

    try {
      if (initArgs.outboxer) {
        hby.ks.pinGbls("outboxer", "1");
      }
      hby.ks.pinGbls("cesrBodyMode", initArgs.cesrBodyMode ?? "header");
      if (runtimeBootstrapNeeded(hby)) {
        const runtime = yield* createAgentRuntime(hby, { mode: "local" });
        yield* processRuntimeUntil(
          runtime,
          () => !runtimeHasPendingWork(runtime),
          { maxTurns: 128 },
        );
        if (hby.db.eoobi.cnt() > 0) {
          throw new ValidationError(
            "Bootstrap OOBI resolution failed during init.",
          );
        }
        assertConfiguredWellKnownAuth(runtime, hby, "init");
      }

      console.log("KERI Keystore created at:", hby.ks.path);
      console.log("KERI Database created at:", hby.db.path);
      console.log("KERI Credential Store created at:", hby.db.path);
      if (hby.mgr.aeid) {
        console.log("\taeid:", hby.mgr.aeid);
      }
      cues.add({ kin: "init", mode: "native", name });
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
  const cue = yield* cues.next();
  if (cue.done) return;
}

function runtimeBootstrapNeeded(
  hby: Habery,
): boolean {
  return hby.db.oobis.cnt() > 0 || hby.db.woobi.cnt() > 0;
}

function configuredWellKnownUrls(hby: Habery): string[] {
  return Array.isArray(hby.config.wurls)
    ? hby.config.wurls.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function assertConfiguredWellKnownAuth(
  runtime: AgentRuntime,
  hby: Habery,
  context: string,
): void {
  const failed = configuredWellKnownUrls(hby).filter((url) => !runtimeHasWellKnownAuth(runtime, url));
  if (failed.length === 0) {
    return;
  }

  const details = failed.map((url) => {
    const terminal = runtimeOobiTerminalState(runtime, url);
    return `${url} (${terminal.record?.state ?? terminal.status})`;
  }).join(", ");
  throw new ValidationError(
    `Bootstrap well-known auth failed during ${context}: ${details}`,
  );
}
