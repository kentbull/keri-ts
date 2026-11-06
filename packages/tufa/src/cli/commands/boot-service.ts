/** Resolve `tufa boot backend` flags over `KF_BOOT_*` variables and run the boot service. */
import type { Operation } from "effection";
import { parseStringOption } from "keri-ts/cli";
import { bootServiceConfig, runBootService } from "../../roles/boot-service.ts";
import { BOOT_BACKEND_FLAGS } from "../command-definitions/boot.ts";

/** Commander's camel-case property for a long flag such as `--watcher-boot-url <url>`. */
function property(flag: string): string {
  return flag.split(" ")[0].slice(2).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/** Start the boot service; flags win over `KF_BOOT_*`, which win over kf-boot defaults. */
export function* bootBackendCommand(args: Record<string, unknown>): Operation<void> {
  const values: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(Deno.env.toObject())) {
    if (key.startsWith("KF_BOOT_")) values[key.slice("KF_BOOT_".length)] = value;
  }
  for (const [flag, variable] of BOOT_BACKEND_FLAGS) {
    const value = parseStringOption(args[property(flag)], flag.split(" ")[0].slice(2));
    if (value !== undefined) values[variable] = value;
  }
  yield* runBootService({
    name: parseStringOption(args.name, "name") ?? values.KERI_NAME ?? "kf-boot",
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "head-dir") ?? values.KERI_DIR,
    passcode: parseStringOption(args.passcode, "passcode"),
    config: bootServiceConfig(values),
  });
}
