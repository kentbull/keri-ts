/** Normal registry service startup with persisted identities and explicit TLS files. */
import { Command } from "npm:commander@^10.0.1";
import type { CommandDispatch } from "../command-types.ts";
import { collectOption, dispatchArgs } from "./options.ts";
import { registerDispatchedCommand } from "./shared.ts";

/** Register registrar publication and observer acquisition as separate service roles. */
export function registerRegistryServiceCmds(program: Command, dispatch: CommandDispatch): void {
  const registrar = serviceStart(program, "registrar", "6632", "6631")
    .option("--observer <aid>", "Allowed observer service AID (repeatable)", collectOption, []);
  const observer = serviceStart(program, "observer", "6633", "6634")
    .option("--registrar <url>", "HTTPS registrar origin (repeatable)", collectOption, [])
    .option("--registrar-ca <path>", "Explicit registrar CA PEM bundle")
    .option("--registrar-cert-name <name>", "Registrar certificate server name")
    .option("--poll-interval <seconds>", "Positive polling interval in seconds", "5")
    .option("--timeout <seconds>", "Positive acquisition timeout in seconds", "5")
    .option("--maximum-age <seconds>", "Positive observation maximum age in seconds", "15");
  registerDispatchedCommand(registrar, dispatch, {
    name: "registrar.start",
    load: () => import("../commands/registry-services.ts"),
    exportName: "registrarStartCommand",
    args: dispatchArgs,
  });
  registerDispatchedCommand(observer, dispatch, {
    name: "observer.start",
    load: () => import("../commands/registry-services.ts"),
    exportName: "observerStartCommand",
    args: dispatchArgs,
  });
}

/** Keep public HTTPS binding separate from the role's loopback administration port. */
function serviceStart(program: Command, role: string, http: string, boot: string): Command {
  return program.command(role).description(`Run a registry ${role} service`)
    .command("start").description(`Start the ${role} using an existing local service AID`)
    .requiredOption("-n, --name <name>", "Existing keystore name")
    .requiredOption("-a, --alias <alias>", "Existing service identifier alias")
    .requiredOption("-u, --url <url>", "Advertised public HTTPS origin")
    .requiredOption("--tls-key <path>", "TLS private key PEM file")
    .requiredOption("--tls-cert <path>", "TLS certificate PEM file")
    .option("-H, --http <port>", "Public HTTPS listener port", http)
    .option("--boot-port <port>", "Private loopback administration port", boot)
    .option("--listen-host <host>", "Public HTTPS listener bind host", "127.0.0.1")
    .option("--kel <path>", "Public KEL evidence file (repeatable)", collectOption, [])
    .option("-b, --base <base>", "Optional base path prefix")
    .option("--head-dir <dir>", "Directory override for database and keystore root")
    .option("-p, --passcode <passcode>", "Encryption passcode for keystore");
}
