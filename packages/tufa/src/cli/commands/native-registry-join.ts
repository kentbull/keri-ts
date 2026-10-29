/** Application-owned custody for an explicitly selected native group proposal. */
import { RegistryCustody, RegistrySaltService } from "@keri-ts/wallet";
import { concatBytes, Counter, Vrsn_2_0 } from "cesr-ts";
import { type Operation, race, scoped, sleep, spawn } from "effection";
import { parseBooleanOption, parseNumberOption, parseStringOption } from "keri-ts/cli";
import { loadNests } from "keri-ts/db";
import {
  acdcV2RegistryProposal,
  envelopeFromFrame,
  groupSigningMembers,
  isLocalGroupHab,
  localGroupMember,
  publishProposal,
  Receiptor,
  runAgentRuntime,
  ValidationError,
} from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { walletStoreArgs } from "../support/wallet.ts";
import { approveAcdcV2RegistryEvent } from "./acdc-v2-authoring.ts";

/** Join one retained RIP/BUP or salt-reply EXN using ordinary group owners.
 * --said fixes the user's selected proposal; there is no inventory-wide replay.
 * Cancellation or timeout closes the command's ordinary workers and stores.
 */
export function* nativeRegistryJoinCommand(args: Record<string, unknown>): Operation<{
  route: string;
  group: string;
  said: string;
  registry: string;
  accepted?: true;
  approved?: true;
}> {
  const group = parseStringOption(args.group, "group"), said = parseStringOption(args.said, "said");
  const seconds = parseNumberOption(args.approvalTimeoutSeconds, "approval-timeout") ?? 60;
  const auto = parseBooleanOption(args.auto, "auto") ?? false;
  if (!group || !said) throw new ValidationError("Native registry join requires --group and --said");
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ValidationError("Approval timeout must be positive");
  return yield* race([
    (function* () {
      return yield* withHabAndAgentRuntime(
        walletStoreArgs(args),
        group,
        { skipConfig: false },
        function* ({ hby, runtime, hab }) {
          return yield* scoped(function* () {
            if (!isLocalGroupHab(hby, hab) || !runtime.acdc) {
              throw new ValidationError("Native registry join requires an existing local group and registry owner");
            }
            yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: true }));
            while (!runtime.exc.complete(said)) yield* sleep(100);
            const wrapper = hby.db.exns.get([said]);
            if (!wrapper || !runtime.exc.verifyAccepted(said, wrapper.route!)) {
              throw new ValidationError("Registry proposal is not an authenticated exchange");
            }
            if (wrapper.route === "/multisig/rpy") {
              const custody = new RegistryCustody({ hby, registry: runtime.acdc.store });
              const service = new RegistrySaltService(custody, runtime.protocol.rvy);
              service.register();
              const approved = service.approveProposal(hab, runtime.exc, said, (reply) => {
                if (auto) return true;
                const { registry, recipient, target } = service.validate(reply).data;
                console.log(
                  JSON.stringify({ group: hab.pre, reply: reply.said, registry, recipient, target }, null, 2),
                );
                return prompt("Approve this exact encrypted salt reply? [y/N]")?.toLowerCase() === "y";
              });
              yield* runtime.reactor.processBytes(concatBytes(Counter.makeGVC(Vrsn_2_0), approved.wire), {
                local: true,
              });
              // Return this contribution to the proposer. Offline nonapproving
              // members are not extra quorum requirements or delivery targets.
              yield* publishProposal(
                hby,
                runtime.protocol,
                runtime.postman,
                localGroupMember(hby, hab.pre),
                [approved.proposer],
                { route: "/multisig/rpy", attrs: { gid: hab.pre } },
                approved.wire,
                { childGvrsn: Vrsn_2_0, pvrsn: Vrsn_2_0 },
              );
              return {
                route: wrapper.route,
                group: hab.pre,
                said,
                registry: service.validate(approved.reply).data.registry,
                approved: true as const,
              };
            }
            const nests = loadNests(hby.db, said), selected = acdcV2RegistryProposal(wrapper, nests);
            if (
              !selected || selected.anchor.pre !== hab.pre ||
              !groupSigningMembers(hby, hab.pre).includes(wrapper.pre!)
            ) {
              throw new ValidationError("Registry proposal does not belong to this signing group");
            }
            const factors = envelopeFromFrame(nests[0]);
            const openings = [...factors.bsqs, ...factors.bsss];
            if (openings.length > 1) throw new ValidationError("Registry proposal carries multiple openings");
            const custody = selected.salts ? new RegistryCustody({ hby, registry: runtime.acdc.store }) : undefined;
            if (selected.salts) custody!.openMemberCopy(hab, selected.salts);
            if (!auto) {
              console.log(
                JSON.stringify(
                  { route: wrapper.route, group: hab.pre, event: selected.tel.said, encryptedSalt: !!selected.salts },
                  null,
                  2,
                ),
              );
              const answer = prompt("Approve this registry event? [y/N]");
              if (answer?.toLowerCase() !== "y") throw new ValidationError("Registry approval declined");
            }
            yield* approveAcdcV2RegistryEvent(
              hby,
              runtime,
              hab,
              new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock),
              selected.tel,
              openings[0],
              { anchor: selected.anchor, salts: selected.salts },
            );
            const registry = selected.tel.ilk === "rip" ? selected.tel.said! : selected.tel.regid!;
            if (selected.salts) custody!.retainMemberCopy(registry, hab, selected.salts);
            return { route: wrapper.route!, group: hab.pre, said, registry, accepted: true as const };
          });
        },
      );
    })(),
    (function* (): Operation<never> {
      yield* sleep(seconds * 1000);
      throw new ValidationError("Native registry approval timed out before authenticated acceptance");
    })(),
  ]);
}
