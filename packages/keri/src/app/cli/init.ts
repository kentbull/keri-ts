import { createQueue, type Operation, spawn } from "npm:effection@^3.6.0";
import { PathError, ValidationError } from "../../core/errors.ts";
import { type Configer, createConfiger } from "../configing.ts";
import { createHabery } from "../habbing.ts";

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
      });
    }

    try {
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
