import { Encrypter } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import {
  type AgentRuntime,
  createAgentRuntime,
  runAgentRuntimeUntil,
  runtimeHasPendingWork,
  runtimeHasWellKnownAuth,
  runtimeOobiTerminalState,
} from "../agent-runtime.ts";
import { type Configer, createConfiger } from "../configing.ts";
import { branToSeedAeid, createHabery, type Habery } from "../habbing.ts";
import { FetchHttpClient } from "../http-client.ts";
import { systemClock } from "../runtime-clock.ts";
import { readPasscode } from "./common/passcode.ts";

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
  /** Encryption passcode; the existing derivation uses its first 21 characters. */
  passcode?: string;
  /** Create an unencrypted keystore */
  nopasscode?: boolean;
  /** Qualified base64 of non-transferable identifier prefix for authentication and encryption of secrets in keystore */
  aeid?: string;
  /** Qualified base64 private-signing key (seed) for the aeid from which the private decryption key may be derived */
  seed?: string;
}

/**
 * Implements `tufa init`.
 *
 * Creates/open a habery keystore and database.
 *
 * @param args Parsed command flags and positionals; required identifiers and policy values are validated before effects.
 */
export function* initCommand(args: Record<string, unknown>): Operation<void> {
  // Extract values from args
  const initArgs: InitArgs = {
    name: stringOption(args.name, "--name"),
    base: stringOption(args.base, "--base"),
    headDirPath: stringOption(args.headDirPath, "--head-dir"),
    temp: booleanOption(args.temp, "--temp"),
    salt: stringOption(args.salt, "--salt"),
    configDir: stringOption(args.configDir, "--config-dir"),
    configFile: stringOption(args.configFile, "--config-file"),
    passcode: stringOption(args.passcode, "--passcode"),
    nopasscode: booleanOption(args.nopasscode, "--nopasscode"),
    aeid: stringOption(args.aeid, "--aeid"),
    seed: stringOption(args.seed, "--seed"),
  };

  const name = initArgs.name;
  if (!name || name.trim().length === 0) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  let credentials = resolveCredentials(initArgs);
  if (credentials.kind === "prompt") {
    const passcode = yield* readPasscode("Passcode:");
    requirePasscode(passcode);
    const retry = yield* readPasscode("Re-enter passcode:");
    requirePasscode(retry);
    if (passcode !== retry) throw new ValidationError("Passcodes do not match");
    credentials = passcodeCredentials(passcode);
  }

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
  let hby: Habery | undefined;
  try {
    let seed: string | undefined;
    let aeid: string | undefined;
    if (credentials.kind === "encrypted") {
      seed = credentials.seed;
      aeid = credentials.aeid;
    }
    hby = yield* createHabery({
      name,
      base: initArgs.base ?? "",
      headDirPath: initArgs.headDirPath,
      temp: initArgs.temp ?? false,
      cf,
      skipConfig: !cf,
      skipSignator: true,
      aeid,
      seed,
      salt: initArgs.salt,
    });
    if (runtimeBootstrapNeeded(hby)) {
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
      try {
        yield* runAgentRuntimeUntil(
          runtime,
          () => !runtimeHasPendingWork(runtime),
          { timeoutMs: 30_000, pollMailbox: false },
        );
        if (hby.db.eoobi.cnt() > 0) {
          throw new ValidationError(
            "Bootstrap OOBI resolution failed during init.",
          );
        }
        assertConfiguredWellKnownAuth(runtime, hby, "init");
      } finally {
        yield* runtime.close();
      }
    }

    console.log("KERI Keystore created at:", hby.ks.path);
    console.log("KERI Database created at:", hby.db.path);
    if (hby.mgr.aeid) {
      console.log("\taeid:", hby.mgr.aeid);
    }
  } finally {
    if (hby) yield* hby.close();
    else if (cf) yield* cf.close();
  }
}

/** Mutually exclusive initialization choices, resolved before opening stores. */
type InitCredentials =
  | { kind: "plaintext" }
  | { kind: "encrypted"; aeid: string; seed: string }
  | { kind: "prompt" };

/** Validate the open CLI-helper argument boundary without coercing credentials. */
function stringOption(value: unknown, flag: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new ValidationError(`${flag} must be a string`);
  return value;
}

/** Flags are booleans; truthy strings/numbers cannot select plaintext or temp. */
function booleanOption(value: unknown, flag: string): boolean {
  if (value === undefined) return false;
  if (typeof value !== "boolean") throw new ValidationError(`${flag} must be a boolean`);
  return value;
}

/** Refuse empty secrets without changing passcode normalization or derivation. */
function requirePasscode(passcode: string): void {
  if (passcode.trim().length === 0) throw new ValidationError("Passcode cannot be empty");
  if (passcode.length < 21) throw new ValidationError("Passcode must contain at least 21 characters");
}

/** Derive once through the same primitive path used for encrypted Habery reopen. */
function passcodeCredentials(passcode: string): Extract<InitCredentials, { kind: "encrypted" }> {
  requirePasscode(passcode);
  return { kind: "encrypted", ...branToSeedAeid(passcode) };
}

/** Validate one explicit encryption method, including a matching AEID/seed pair. */
function resolveCredentials(args: InitArgs): InitCredentials {
  const passcodeProvided = args.passcode !== undefined;
  const aeidProvided = args.aeid !== undefined;
  const seedProvided = args.seed !== undefined;
  if (args.nopasscode) {
    if (passcodeProvided || aeidProvided || seedProvided) {
      throw new ValidationError("--nopasscode cannot be combined with --passcode, --aeid or --seed");
    }
    return { kind: "plaintext" };
  }
  if (passcodeProvided) {
    if (aeidProvided || seedProvided) {
      throw new ValidationError("Choose either --passcode or --aeid with --seed");
    }
    return passcodeCredentials(args.passcode!);
  }
  if (aeidProvided || seedProvided) {
    if (!args.aeid || !args.seed) throw new ValidationError("--aeid and --seed must be supplied together");
    try {
      if (!new Encrypter({ verkey: args.aeid }).verifySeed(args.seed)) {
        throw new ValidationError("Seed is not associated with the supplied AEID");
      }
    } catch (cause) {
      if (cause instanceof ValidationError) throw cause;
      throw new ValidationError("Invalid AEID/seed credentials", { cause });
    }
    return { kind: "encrypted", aeid: args.aeid, seed: args.seed };
  }
  return { kind: "prompt" };
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
