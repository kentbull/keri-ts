import { type Operation } from "npm:effection@^3.6.0";
import { createKeeper } from "../../../db/keeping.ts";
import { createHabery, Habery } from "../../habbing.ts";

export function* setupHby(
  name: string,
  base = "",
  bran?: string,
  temp = false,
  headDirPath?: string,
  options: {
    compat?: boolean;
    readonly?: boolean;
    skipConfig?: boolean;
    skipSignator?: boolean;
  } = {},
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
        skipConfig: options.skipConfig,
        skipSignator: options.skipSignator,
        bran: passcode?.replaceAll("-", ""),
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
