import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../../core/errors.ts";
import { createKeeper, Keeper } from "../../../db/keeping.ts";
import { type CesrBodyMode, cesrBodyModeFromGlobal, normalizeCesrBodyMode } from "../../cesr-http.ts";
import type { Configer } from "../../configing.ts";
import { createHabery, Habery } from "../../habbing.ts";

interface OpenHaberyOptions {
  compat?: boolean;
  readonly?: boolean;
  skipConfig?: boolean;
  skipSignator?: boolean;
  cf?: Configer;
  outboxer?: boolean;
  cesrBodyMode?: CesrBodyMode;
}

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
  const outboxerEnabled = ks.getGbls("outboxer") === "1";
  const storedCesrBodyMode = cesrBodyModeFromGlobal(ks.getGbls("cesrBodyMode"));
  yield* ks.close();
  if (aeid === null) {
    throw new Error("Keystore must already exist, exiting");
  }
  if (options.outboxer && options.compat) {
    throw new ValidationError(
      "Outboxer is a tufa-only sidecar and is unavailable in compat mode.",
    );
  }
  if (options.outboxer && !outboxerEnabled) {
    throw new ValidationError(
      "Outboxer is not enabled for this keystore. Re-run `tufa init --outboxer` to create it.",
    );
  }
  const cesrBodyMode = normalizeCesrBodyMode(
    options.cesrBodyMode,
    storedCesrBodyMode,
  );

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
        outboxer: options.outboxer ? "open" : "disabled",
        cesrBodyMode,
      });
    } catch (error) {
      if (retries >= 3) {
        throw new Error("too many attempts");
      }
      const message = error instanceof Error ? error.message : String(error);
      console.log(message);
      console.log("Valid passcode required, try again...");
      passcode = prompt("Passcode: ") ?? undefined;
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
  if (options.outboxer && options.compat) {
    throw new ValidationError(
      "Outboxer is a tufa-only sidecar and is unavailable in compat mode.",
    );
  }

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
    outboxer: options.outboxer ? "create" : "disabled",
    cesrBodyMode: normalizeCesrBodyMode(options.cesrBodyMode),
  });
  if (options.outboxer) {
    hby.ks.pinGbls("outboxer", "1");
  }
  hby.ks.pinGbls("cesrBodyMode", normalizeCesrBodyMode(options.cesrBodyMode));
  return { hby, created: true };
}
