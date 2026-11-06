/** Commander registration for the KF boot service backend. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { dispatchArgs } from "./options.ts";
import { registerDispatchedCommand } from "./shared.ts";

/**
 * Boot service flags and the `KF_BOOT_*` variable each one overrides.
 *
 * Flags carry no defaults so an unset flag falls back to its variable and then to
 * kf-boot's own default; the launcher can export one `KF_BOOT_*` block for either
 * implementation and change only the executable.
 */
export const BOOT_BACKEND_FLAGS: readonly (readonly [flag: string, variable: string, description: string])[] = [
  ["--host <host>", "HOST", "Public listener bind host (default 127.0.0.1)"],
  ["--port <port>", "PORT", "Public listener port (default 9723)"],
  ["--boot-hab-name <name>", "BOOT_HAB_NAME", "Boot server habitat name (default boot-server)"],
  ["--onboarding-path <path>", "ONBOARDING_PATH", "Onboarding surface path (default /onboarding)"],
  ["--account-path <path>", "ACCOUNT_PATH", "Account surface path (default /account)"],
  ["--onboarding-public-url <url>", "ONBOARDING_PUBLIC_URL", "Advertised onboarding surface URL"],
  ["--account-public-url <url>", "ACCOUNT_PUBLIC_URL", "Advertised account surface URL"],
  ["--region-id <id>", "REGION_ID", "Advertised region ID (default nyc)"],
  ["--region-name <name>", "REGION_NAME", "Advertised region name (default New York)"],
  ["--witness-backends <list>", "WITNESS_BACKENDS", "Witness providers: <id>|<boot_url>|<public_url>,…"],
  ["--wit-boot-url <url>", "WIT_BOOT_URL", "Single witness provider boot URL (without --witness-backends)"],
  ["--wit-public-url <url>", "WIT_PUBLIC_URL", "Single witness provider public URL"],
  ["--watcher-boot-url <url>", "WAT_BOOT_URL", "Watcher provider boot URL"],
  ["--watcher-public-url <url>", "WAT_PUBLIC_URL", "Watcher provider public URL"],
  ["--account-options <codes>", "BOOTSTRAP_ACCOUNT_OPTIONS", "Advertised profiles (default 1-of-1,3-of-4)"],
  ["--watcher-required <bool>", "BOOTSTRAP_WATCHER_REQUIRED", "Require one hosted watcher (default true)"],
  ["--session-ttl <seconds>", "SESSION_TTL_SECONDS", "Open session lease (default 300)"],
  ["--account-ttl <seconds>", "ACCOUNT_TTL_SECONDS", "Onboarded account idle lease (default 172800)"],
  ["--boot-api-timeout <seconds>", "BOOT_API_TIMEOUT_SECONDS", "Backend admin request deadline (default 10)"],
  ["--operation-max-attempts <n>", "OPERATION_FAILURE_MAX_ATTEMPTS", "Attempts before an operation fails (default 10)"],
  ["--registrar-boot-url <url>", "REGISTRAR_BOOT_URL", "Registrar loopback admin URL"],
  ["--registrar-public-url <url>", "REGISTRAR_PUBLIC_URL", "Registrar public HTTPS origin"],
  ["--registrar-service-aid <aid>", "REGISTRAR_SERVICE_AID", "Registrar service AID"],
  ["--registrar-ca-file <file>", "REGISTRAR_CA_FILE", "PEM whose certificates wallets trust for the registrar"],
  ["--observer-boot-url <url>", "OBSERVER_BOOT_URL", "Observer loopback admin URL"],
  ["--observer-public-url <url>", "OBSERVER_PUBLIC_URL", "Observer public HTTPS origin"],
  ["--observer-service-aid <aid>", "OBSERVER_SERVICE_AID", "Observer service AID"],
  ["--observer-ca-file <file>", "OBSERVER_CA_FILE", "PEM whose certificates wallets trust for the observer"],
];

/** Register `tufa boot backend`, the KF boot service beside the witness and watcher backends. */
export function registerBootCmds(program: Command, dispatch: CommandDispatch): void {
  const boot = program.command("boot").description("Run KERI Foundation boot (provisioning) services");
  let backend = boot.command("backend")
    .description("Run a KF boot service; each flag overrides its KF_BOOT_* variable")
    .option("-n, --name <name>", "Keystore name (env KF_BOOT_KERI_NAME, default kf-boot)")
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--head-dir <dir>", "Directory override for database and keystore root (env KF_BOOT_KERI_DIR)")
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore");
  for (const [flag, variable, description] of BOOT_BACKEND_FLAGS) {
    backend = backend.option(flag, `${description} [KF_BOOT_${variable}]`);
  }
  registerDispatchedCommand(backend, dispatch, {
    name: "boot.backend",
    load: () => import("../commands/boot-service.ts"),
    exportName: "bootBackendCommand",
    args: dispatchArgs,
  });
}
