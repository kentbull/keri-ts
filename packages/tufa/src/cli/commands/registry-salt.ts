/** Operator-selected encrypted salt replies using ordinary protocol owners. */
import { RegistryCustody, RegistrySaltService } from "@keri-ts/wallet";
import { call, type Operation } from "effection";
import { parseStringOption } from "keri-ts/cli";
import { ValidationError } from "keri-ts/runtime";
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
  const evidence = args.evidence ?? [];
  if (!alias || !registry || !["send", "receive", "status"].includes(operation ?? "")) {
    throw new ValidationError("Registry salt requires send, receive or status, an alias and a registry");
  }
  if (!Array.isArray(evidence) || evidence.some((path) => typeof path !== "string")) {
    throw new ValidationError("Registry evidence must be CESR file paths");
  }
  if (operation === "send" && (!party || !output)) throw new ValidationError("Salt send requires --party and --output");
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
      if (operation === "send") {
        const body = service.makeReply(hab, registry, party!, target);
        const wire = hab.endorse(body);
        yield* call(() => Deno.writeFile(output!, wire, { createNew: true, mode: 0o600 }));
        return { registry, said: body.said, submitted: false };
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
