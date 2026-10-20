import { type Operation } from "npm:effection@^3.6.0";
import { createKeeper, Keeper } from "../../../db/keeping.ts";
import type { Configer } from "../../configing.ts";
import { createHabery, Habery } from "../../habbing.ts";
import { readPasscode } from "./passcode.ts";

/** Low-level habery-open knobs shared by CLI startup helpers. */
interface OpenHaberyOptions {
  compat?: boolean;
  readonly?: boolean;
  skipConfig?: boolean;
  skipSignator?: boolean;
  cf?: Configer;
}

/** Result of "open if present, create if absent" CLI startup behavior. */
export interface EnsuredHabery {
  hby: Habery;
  created: boolean;
}

/**
 * Return true when the named keeper already exists and contains keeper globals.
 *
 * Readonly keeper opens are used on purpose here so create-if-missing porcelain
 * commands can distinguish "missing keystore" from "existing encrypted
 * keystore" without mutating on-disk state during the probe.
 */
function* keeperExists(
  name: string,
  base = "",
  temp = false,
  headDirPath?: string,
  compat = false,
): Operation<boolean> {
  const keeper = new Keeper({
    name,
    base,
    temp,
    headDirPath,
    compat,
  });
  try {
    const opened = yield* keeper.reopen({
      name,
      base,
      temp,
      headDirPath,
      compat,
      reopen: true,
      readonly: true,
    });
    if (!opened) {
      return false;
    }
    return keeper.getGbls("aeid") !== null;
  } finally {
    yield* keeper.close();
  }
}

/**
 * Reopen an existing keystore/habery pair, prompting for passcode retries when
 * encrypted keeper state requires it.
 */
export function* setupHby(
  name: string,
  base = "",
  bran?: string,
  temp = false,
  headDirPath?: string,
  options: OpenHaberyOptions = {},
): Operation<Habery> {
  const ks = yield* createKeeper({
    name,
    base,
    temp,
    headDirPath,
    compat: options.compat,
    reopen: true,
    readonly: true,
  });
  const aeid = ks.getGbls("aeid");
  yield* ks.close();
  if (aeid === null) {
    throw new Error("Keystore must already exist, exiting");
  }

  let retries = 0;
  let passcode = bran;
  while (true) {
    try {
      retries += 1;
      return yield* createHabery({
        name,
        base,
        temp,
        headDirPath,
        compat: options.compat,
        readonly: options.readonly,
        cf: options.cf,
        skipConfig: options.skipConfig,
        skipSignator: options.skipSignator,
        bran: passcode?.replaceAll("-", ""),
      });
    } catch (error) {
      if (!Deno.stdin.isTerminal()) throw error;
      if (retries >= 3) {
        throw new Error("too many attempts");
      }
      const message = error instanceof Error ? error.message : String(error);
      console.error(message);
      console.error("Valid passcode required, try again...");
      // Match the long-standing CLI operator contract: retry interactively
      // instead of failing immediately on the first decrypt/auth attempt.
      passcode = yield* readPasscode("Passcode:");
    }
  }
}

/**
 * Open an existing habery when present or create a new one when absent.
 *
 * This helper exists for porcelain startup commands such as `mailbox start`
 * that need "create if missing" behavior without changing the stricter
 * semantics of `setupHby()` used by normal mutation commands.
 */
export function* ensureHby(
  name: string,
  base = "",
  bran?: string,
  temp = false,
  headDirPath?: string,
  options: OpenHaberyOptions = {},
): Operation<EnsuredHabery> {
  const exists = yield* keeperExists(
    name,
    base,
    temp,
    headDirPath,
    options.compat ?? false,
  );
  if (exists) {
    return {
      hby: yield* setupHby(name, base, bran, temp, headDirPath, options),
      created: false,
    };
  }

  const hby = yield* createHabery({
    name,
    base,
    temp,
    headDirPath,
    compat: options.compat,
    readonly: options.readonly,
    cf: options.cf,
    skipConfig: options.skipConfig,
    skipSignator: options.skipSignator,
    bran: bran?.replaceAll("-", ""),
  });

  return { hby, created: true };
}
