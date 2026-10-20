import { Encrypter } from "cesr-ts";
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { resolveBootstrap } from "../bootstrapping.ts";
import { type Configer, createConfiger } from "../configing.ts";
import { branToSeedAeid, createHabery, type Habery } from "../habbing.ts";
import { FetchHttpClient } from "../http-client.ts";
import { systemClock } from "../runtime-clock.ts";
import { assertBootstrapComplete } from "./common/bootstrap.ts";
import { parseBooleanOption, parseStringOption } from "./common/parsing.ts";
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
    name: parseStringOption(args.name, "--name"),
    base: parseStringOption(args.base, "--base"),
    headDirPath: parseStringOption(args.headDirPath, "--head-dir"),
    temp: parseBooleanOption(args.temp, "--temp") ?? false,
    salt: parseStringOption(args.salt, "--salt"),
    configDir: parseStringOption(args.configDir, "--config-dir"),
    configFile: parseStringOption(args.configFile, "--config-file"),
    passcode: parseStringOption(args.passcode, "--passcode"),
    nopasscode: parseBooleanOption(args.nopasscode, "--nopasscode") ?? false,
    aeid: parseStringOption(args.aeid, "--aeid"),
    seed: parseStringOption(args.seed, "--seed"),
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
  let created: { keystore: string | null; database: string | null; aeid: string };
  let failure: { error: unknown } | undefined;
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
    assertBootstrapComplete(yield* resolveBootstrap(hby, new FetchHttpClient(), systemClock));

    created = { keystore: hby.ks.path, database: hby.db.path, aeid: hby.mgr.aeid };
  } catch (error) {
    failure = { error };
    throw error;
  } finally {
    try {
      if (hby) yield* hby.close();
      else if (cf) yield* cf.close();
    } catch (error) {
      if (failure) {
        // deno-lint-ignore no-unsafe-finally -- Preserve initialization and shutdown failures.
        throw new AggregateError([failure.error, error], "Initialization and database close failed", {
          cause: failure.error,
        });
      }
      // deno-lint-ignore no-unsafe-finally -- Final success requires resource closure.
      throw error;
    }
  }
  console.log("KERI Keystore created at:", created.keystore);
  console.log("KERI Database created at:", created.database);
  if (created.aeid) console.log("\taeid:", created.aeid);
}

/** Mutually exclusive initialization choices, resolved before opening stores. */
type InitCredentials =
  | { kind: "plaintext" }
  | { kind: "encrypted"; aeid: string; seed: string }
  | { kind: "prompt" };

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
