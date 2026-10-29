/** Operator-selected encrypted salt replies using ordinary protocol owners. */
import { startServer } from "@keri-ts/hosting";
import { RegistryCustody, RegistrySaltService } from "@keri-ts/wallet";
import { call, type Operation, scoped, spawn } from "effection";
import { parseNumberOption, parseStringOption } from "keri-ts/cli";
import { chunkBytes, postCesr, runAgentRuntime, ValidationError } from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { walletStoreArgs } from "../support/wallet.ts";

/** Create, ingest, or inspect one registry's salt without opening inventory.
 * Evidence files are ordinary public CESR streams. Output files contain signed
 * recipient ciphertext, never plaintext custody. Group output is a member's
 * signature contribution; this command does not claim threshold completion or
 * remote delivery. Existing Revery escrows own partial reply signatures.
 */
export function* registrySaltCommand(args: Record<string, unknown>): Operation<void> {
  const operation = parseStringOption(args.operation, "operation");
  const alias = parseStringOption(args.alias, "alias");
  const registry = parseStringOption(args.registry, "registry");
  const party = parseStringOption(args.party, "party");
  const target = parseStringOption(args.target, "target");
  const input = parseStringOption(args.input, "input");
  const output = parseStringOption(args.output, "output");
  const endpoint = parseStringOption(args.endpoint, "endpoint");
  const host = parseStringOption(args.host, "host") ?? "127.0.0.1";
  const port = parseNumberOption(args.port, "port") ?? 7723;
  const timeout = parseNumberOption(args.timeout, "timeout") ?? 30;
  const evidence = args.evidence ?? [];
  if (!alias || !registry || !["send", "receive", "status", "serve"].includes(operation ?? "")) {
    throw new ValidationError("Registry salt requires send, receive, status or serve, an alias and a registry");
  }
  if (!Array.isArray(evidence) || evidence.some((path) => typeof path !== "string")) {
    throw new ValidationError("Registry evidence must be CESR file paths");
  }
  if (operation === "send" && (!party || (!output && !endpoint))) {
    throw new ValidationError("Salt send requires --party and --output or --endpoint");
  }
  if (endpoint && !["http:", "https:"].includes(new URL(endpoint).protocol)) {
    throw new ValidationError("Salt endpoint must use HTTP or HTTPS");
  }
  if (!Number.isFinite(timeout) || timeout <= 0) throw new ValidationError("Timeout must be positive");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ValidationError("Invalid listen port");
  if (operation === "receive" && !input) throw new ValidationError("Salt receive requires --input");
  const result = yield* withHabAndAgentRuntime(
    walletStoreArgs(args),
    alias,
    { skipConfig: true },
    function* ({ hby, runtime, hab }) {
      if (!runtime.acdc) throw new ValidationError("ACDC v2 registry processing is unavailable");
      const custody = new RegistryCustody({ hby, registry: runtime.acdc.store });
      const service = new RegistrySaltService(custody, runtime.protocol.rvy);
      service.register();
      for (const path of evidence) {
        yield* runtime.reactor.processBytes(yield* call(() => Deno.readFile(path)));
      }
      if (operation === "serve") {
        yield* scoped(function* () {
          yield* spawn(() => runAgentRuntime(runtime, { hab }));
          yield* startServer(port, undefined, runtime, {
            hostname: host,
            onListen: (address) => writeJsonLine({ listening: address }),
          });
        });
        return { registry, stopped: true };
      }
      if (operation === "send") {
        const body = service.makeReply(hab, registry, party!, target);
        const wire = hab.endorse(body);
        if (output) yield* call(() => Deno.writeFile(output, wire, { createNew: true, mode: 0o600 }));
        if (endpoint) {
          yield* postCesr(endpoint, (signal) => chunkBytes(wire, { signal }), runtime.http, {
            signal: AbortSignal.timeout(timeout * 1000),
            destination: target ?? party,
          });
        }
        return { registry, said: body.said, submitted: !!endpoint };
      }
      if (operation === "receive") {
        yield* runtime.reactor.processBytes(yield* call(() => Deno.readFile(input!)));
        yield* runtime.protocol.processEscrowsOnce();
      }
      return { registry, custody_present: hby.ks.custody.get([registry]) !== null };
    },
  );
  writeJsonLine(result);
}
