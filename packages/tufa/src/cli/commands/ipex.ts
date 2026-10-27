/** IPEX presentation after the KERI command has joined workers and closed owned stores. */
import { call, type Operation, scoped, spawn } from "effection";
import {
  ipexAdmitCommand as admit,
  ipexAgreeCommand as agree,
  ipexApplyCommand as apply,
  ipexGrantCommand as grant,
  ipexJoinCommand as join,
  ipexOfferCommand as offer,
  ipexPollCommand as poll,
  type IpexSendResult,
  ipexSpurnCommand as spurn,
  parseBooleanOption,
  parseGvrsn,
  parseStringOption,
} from "keri-ts/cli";
import { CREDENTIAL_MAILBOX_TOPIC, runAgentRuntime, ValidationError } from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";

/** Completed transport destinations do not establish peer protocol acceptance. */
function printSend({ exn, deliveries, group }: IpexSendResult): void {
  if (!group) writeJsonLine({ said: exn.said, deliveries });
  else {writeJsonLine({
      said: exn.said,
      status: group.complete ? "multisig-complete" : "multisig-pending",
      lead: group.lead,
      messages: group.messages,
      deliveries,
    });}
}

/** Display a completed apply attempt after resource cleanup. */
export function* ipexApplyCommand(args: Record<string, unknown>): Operation<void> {
  printSend(yield* apply(args));
}

/** Display a completed offer attempt after resource cleanup. */
export function* ipexOfferCommand(args: Record<string, unknown>): Operation<void> {
  printSend(yield* offer(args));
}

/** Display a completed agree attempt after resource cleanup. */
export function* ipexAgreeCommand(args: Record<string, unknown>): Operation<void> {
  printSend(yield* agree(args));
}

/** Display a completed spurn attempt after resource cleanup. */
export function* ipexSpurnCommand(args: Record<string, unknown>): Operation<void> {
  printSend(yield* spurn(args));
}

/** Project grant facts, retaining the distinction between pending group evidence and completed business EXNs. */
export function* ipexGrantCommand(args: Record<string, unknown>): Operation<void> {
  const { grant: exn, credential, support, deliveries, group } = yield* grant(args);
  const identity = { said: exn.said, credential, support, deliveries };
  if (!group) {
    writeJsonLine(identity);
  } else if (!group.complete) {
    writeJsonLine({ ...identity, status: "multisig-pending", messages: group.messages });
  } else {
    writeJsonLine({
      ...identity,
      status: "multisig-complete",
      lead: group.lead,
      messages: group.messages,
    });
  }
}

/** Display the admit/grant relationship after cleanup; wallet acceptance remains a protocol fact. */
export function* ipexAdmitCommand(args: Record<string, unknown>): Operation<void> {
  if (parseBooleanOption(args.native, "native") ?? false) {
    yield* nativeAdmit(args);
    return;
  }
  const { admit: exn, grant, credential, saved, deliveries, group } = yield* admit(args);
  const facts = { grant: grant.said, credential, saved, deliveries };
  if (!exn) writeJsonLine({ ...facts, status: "credential-pending" });
  else if (!group) writeJsonLine({ ...facts, said: exn.said });
  else {writeJsonLine({
      ...facts,
      said: exn.said,
      status: group.complete ? "multisig-complete" : "multisig-pending",
      lead: group.lead,
      messages: group.messages,
    });}
}

/** Compose a single-holder native admission; domain checks and signing belong to Wallet. */
function* nativeAdmit(args: Record<string, unknown>): Operation<void> {
  const consent = parseBooleanOption(args.consent, "consent") ?? false;
  if (!consent) throw new ValidationError("Native wallet admission requires explicit --consent.");
  const said = parseStringOption(args.said, "said"), alias = parseStringOption(args.alias, "alias");
  if (!said) throw new ValidationError("Accepted native Grant --said is required.");
  if (args.grantFile) throw new ValidationError("Native wallet admission selects an accepted Grant with --said.");
  const out = parseStringOption(args.out, "out"), message = parseStringOption(args.message, "message") ?? "";
  const gvrsn = parseGvrsn(args.gvrsn ?? "2");
  const completed = yield* withHabAndAgentRuntime(
    walletStoreArgs(args),
    alias,
    { skipConfig: true },
    function*({ hby, runtime, hab }) {
      return yield* scoped(function*() {
        if (!runtime.acdc) throw new ValidationError("Native registry evidence is unavailable.");
        const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
        const prepared = yield* call(() => wallet.prepareAdmit(said, hab.pre, { consent, message, gvrsn }));
        yield* runtime.reactor.processBytes(prepared.wire, { local: true });
        yield* runtime.protocol.processEscrowsOnce();
        if (!runtime.exc.complete(prepared.admit.said!)) {
          throw new ValidationError("Local native Admit was not accepted.");
        }
        const admission = yield* call(() => wallet.recordAdmission(said, prepared.admit.said!, { consent }));
        let deliveries: string[] = [];
        if (out) Deno.writeFileSync(out, prepared.wire);
        else {
          const host = yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: false }));
          try {
            const event = runtime.postman.send({
              src: hab.pre,
              dest: prepared.admit.sad!.ri as string,
              topic: CREDENTIAL_MAILBOX_TOPIC,
              msg: prepared.wire,
            }, { notify: true });
            const outcome = yield* runtime.postman.wait(event);
            if (outcome.kin === "failed") throw outcome.error;
            deliveries = outcome.deliveries;
          } finally {
            yield* host.halt();
          }
        }
        return { ...admission, said: prepared.admit.said!, deliveries };
      });
    },
  );
  writeJsonLine(completed);
}

/** Project settled mailbox records without exposing Serder internals in CLI JSON. */
export function* ipexPollCommand(args: Record<string, unknown>): Operation<void> {
  const { batches, messages, ipex, saved } = yield* poll(args);
  writeJsonLine({
    batches,
    messages,
    ipex: ipex.map(exn => ({ said: exn.said, route: exn.route, sender: exn.ked?.i, prior: exn.ked?.p })),
    saved,
  });
}

/** Display selected coordination identity and approval facts, including poll-discovered outer SAIDs. */
export function* ipexJoinCommand(args: Record<string, unknown>): Operation<void> {
  const { exn, group } = yield* join(args);
  if (!group) {
    writeJsonLine({ said: exn.said, route: exn.route, status: "single-sig" });
    return;
  }
  const identity = {
    said: exn.said,
    route: exn.route,
    embedded: group.embedded.said,
    embeddedRoute: group.embedded.route,
    group: group.embedded.pre,
  };
  if (group.accepted === null) {
    writeJsonLine({ ...identity, status: "multisig-pending" });
  } else {
    let status = group.accepted ? "multisig-approved" : "multisig-escrowed";
    if (group.approved === false) status = "approval-pending";
    if (group.credentialSaved === false) status = "credential-pending";
    writeJsonLine({
      ...identity,
      status,
      accepted: group.accepted,
      approved: group.approved,
      lead: group.lead,
      messages: group.messages,
      deliveries: group.deliveries,
      saved: group.credentialSaved,
    });
  }
}
