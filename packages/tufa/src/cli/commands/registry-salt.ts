/** Operator-selected encrypted salt replies using ordinary protocol owners. */
import { startServer } from "@keri-ts/hosting";
import { RegistryCustody, RegistrySaltService } from "@keri-ts/wallet";
import { Counter, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, race, scoped, sleep, spawn } from "effection";
import { parseBooleanOption, parseNumberOption, parseStringOption } from "keri-ts/cli";
import {
  acceptedEventReplayMessage,
  chunkBytes,
  essrEnvelope,
  groupSigningMembers,
  isLocalGroupHab,
  localGroupMember,
  postCesr,
  publishProposal,
  runAgentRuntime,
  ValidationError,
} from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { walletStoreArgs } from "../support/wallet.ts";

/** Create, ingest, or inspect one registry's salt without opening inventory.
 * Evidence files are ordinary public CESR streams. Output files contain signed
 * recipient ciphertext, never plaintext custody. Group output requires verified
 * threshold signatures; submission does not claim remote acceptance. Existing
 * Revery escrows own partial reply signatures.
 */
export function* registrySaltCommand(args: Record<string, unknown>): Operation<void> {
  const operation = parseStringOption(args.operation, "operation");
  const alias = parseStringOption(args.alias, "alias");
  const registry = parseStringOption(args.registry, "registry");
  const party = parseStringOption(args.party, "party");
  const target = parseStringOption(args.target, "target");
  const input = parseStringOption(args.input, "input");
  const output = parseStringOption(args.output, "output");
  const essr = parseBooleanOption(args.essr, "essr") ?? false;
  const deliver = parseBooleanOption(args.deliver, "deliver") ?? false;
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
  if (operation === "send" && (!party || (!output && !endpoint && !deliver))) {
    throw new ValidationError("Salt send requires --party and --output, --endpoint or --deliver");
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
    function*({ hby, runtime, hab }) {
      if (!runtime.acdc) throw new ValidationError("ACDC v2 registry processing is unavailable");
      const custody = new RegistryCustody({ hby, registry: runtime.acdc.store });
      const service = new RegistrySaltService(custody, runtime.protocol.rvy);
      service.register();
      const member = isLocalGroupHab(hby, hab) ? localGroupMember(hby, hab.pre) : hab;
      service.registerEnvelope(member, runtime.exc, runtime.reactor);
      for (const path of evidence) {
        yield* runtime.reactor.processBytes(yield* call(() => Deno.readFile(path)));
      }
      if (operation === "serve") {
        yield* scoped(function*() {
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
        // ESSR supplies the stream genus outside the exact signed inner reply.
        let wire = hab.endorse(body, { pipelined: false, gvrsn: Vrsn_2_0, genusify: !essr });
        if (isLocalGroupHab(hby, hab)) {
          wire = yield* scoped(function*() {
            yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: true }));
            yield* runtime.reactor.processBytes(wire, { local: true });
            for (const peer of groupSigningMembers(hby, hab.pre)) {
              if (peer === member.pre) continue;
              yield* spawn(function*() {
                try {
                  const published = yield* publishProposal(
                    hby,
                    runtime.protocol,
                    runtime.postman,
                    member,
                    [peer],
                    { route: "/multisig/rpy", attrs: { gid: hab.pre } },
                    hab.endorse(body, { pipelined: false, gvrsn: Vrsn_2_0 }),
                    { childGvrsn: Vrsn_2_0, pvrsn: Vrsn_2_0 },
                  );
                  writeJsonLine({ proposals: published.messages });
                } catch (error) {
                  // A failed member transport is not an extra signature requirement.
                  // Ordinary reply proofs still decide success; no retry is scheduled.
                  console.error(`Salt proposal to ${peer} did not complete: ${error}`);
                }
              });
            }
            const deadline = performance.now() + timeout * 1000;
            while (true) {
              yield* runtime.protocol.processEscrowsOnce();
              const complete = service.verifiedReply(body);
              if (complete) return complete;
              if (performance.now() >= deadline) {
                throw new ValidationError("Registry salt reply awaits the group signing threshold");
              }
              yield* sleep(100);
            }
          });
        }
        if (essr) {
          const destination = target ?? party!;
          const key = hby.db.getKever(destination)?.verfers[0];
          if (!key) throw new ValidationError("ESSR requires a known individual recipient key");
          wire = essrEnvelope(member, wire, destination, key);
        }
        if (output) yield* call(() => Deno.writeFile(output, wire, { createNew: true, mode: 0o600 }));
        if (endpoint) {
          yield* postCesr(endpoint, (signal) => chunkBytes(wire, { signal }), runtime.http, {
            signal: AbortSignal.timeout(timeout * 1000),
            destination: target ?? party,
          });
        }
        if (deliver) {
          yield* scoped(function*() {
            yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: true }));
            const issuer = runtime.acdc!.store.seqEvent(registry, 0)!.issuer!;
            const msgs: Uint8Array[] = [Counter.makeGVC(Vrsn_2_0)];
            for (const aid of new Set([issuer, hab.pre])) {
              const state = hby.db.getKever(aid);
              if (!state) throw new ValidationError("Salt delivery requires accepted author keys");
              for (let sn = 0; sn <= state.sn; sn++) {
                msgs.push(acceptedEventReplayMessage(hby, aid, sn, Vrsn_2_0).message);
              }
            }
            msgs.push(runtime.acdc!.store.cloneTel(registry), wire);
            const evt = runtime.postman.sendStream({
              src: member.pre,
              dest: target ?? party!,
              topic: "credential",
              msgs,
            }, { notify: true });
            yield* race([
              (function*() {
                const outcome = yield* runtime.postman.wait(evt);
                if (outcome.kin === "failed") throw outcome.error;
              })(),
              (function*() {
                yield* sleep(timeout * 1000);
                throw new ValidationError("Salt transport submission timed out");
              })(),
            ]);
          });
        }
        return { registry, said: body.said, submitted: !!endpoint || deliver };
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
