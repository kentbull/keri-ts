/** Exact public Grant files separate local view selection from group sender-threshold signatures. */
import { call, type Operation, scoped } from "effection";
import { parseBooleanOption, parseStringOption, withRuntimeWorkers } from "keri-ts/cli";
import {
  deliverPreparedGrant,
  isLocalGroupHab,
  localGroupMember,
  Organizer,
  preparePresentationFile,
  Receiptor,
  resumePresentationFile,
  ValidationError,
  waitForPresentation,
} from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";

/** Decode explicit JSON CLI values without changing the selected protocol inputs. */
function json(value: unknown, name: string): any {
  const text = parseStringOption(value, name);
  return text === undefined
    ? undefined
    : JSON.parse(text.startsWith("@") ? Deno.readTextFileSync(text.slice(1)) : text);
}
/** Refuse options that could rebuild a view while the operator selects a frozen authentication file. */
function forbid(args: Record<string, unknown>, names: readonly string[]): void {
  if (names.some(name => args[name])) {
    throw new ValidationError(`Frozen presentation does not accept ${names.map(name => `--${name}`).join(", ")}`);
  }
}
/** Explicit exact-file presentation preparation/resume, kept separate from ordinary issued-graph delivery. */
export function* ipexPresentationFileCommand(args: Record<string, unknown>): Operation<void> {
  const prepare = parseBooleanOption(args.prepare, "prepare") ?? false,
    resume = parseStringOption(args.resume, "resume");
  if (prepare === Boolean(resume)) throw new ValidationError("Select exactly one --prepare or --resume SAID");
  if (!(parseBooleanOption(args.acdcV2, "acdc-v2") ?? false)) {
    throw new ValidationError("Prepared presentation requires --acdc-v2");
  }
  forbid(args, [
    "issue",
    "credential",
    "artifact",
    "coordinator",
    "custodian",
    "proofOutput",
    "proposalOutput",
    "refresh",
    "derive",
    "opening",
    "presentationRegistry",
    "anchor",
  ]);
  const out = parseStringOption(args.out, "out");
  if (prepare && !out) throw new ValidationError("Preparation requires an exact Grant --out file");
  if (resume) {
    forbid(args, [
      "said",
      "fromGrant",
      "view",
      "presenterAuthorized",
      "disclose",
      "plan",
      "prior",
      "agree",
      "message",
      "proposal",
    ]);
  }
  const completed = yield* withHabAndAgentRuntime(walletStoreArgs(args), parseStringOption(args.alias, "alias"), {
    skipConfig: false,
  }, function*({ hby, hab, runtime }) {
    return yield* scoped(function*() {
      const wallet = yield* openWallet(hby, runtime.acdc!.store, runtime.exc);
      const files = {
        hby,
        rgy: runtime.acdc!,
        exc: runtime.exc,
        receiptor: new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock),
        reactor: runtime.reactor,
        protocol: runtime.protocol,
        clock: runtime.clock,
        views: wallet,
      };
      const recipientText = parseStringOption(args.recipient, "recipient");
      if (!recipientText) throw new ValidationError("Select the exact presentation --recipient");
      const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(recipientText);
      const filename = parseStringOption(args.input, "input");
      if (prepare) {
        if (filename) {
          yield* runtime.reactor.processBytes(yield* call(() => Deno.readFile(filename)));
          yield* runtime.protocol.processEscrowsOnce();
        }
        const proposal = parseStringOption(args.proposal, "proposal");
        const prepared = yield* preparePresentationFile(files, hab, {
          said: parseStringOption(args.said, "said"),
          fromGrant: parseStringOption(args.fromGrant, "from-grant"),
          transferred: args.view ? yield* call(() => Deno.readFile(parseStringOption(args.view, "view")!)) : undefined,
          presenterAuthorized: parseBooleanOption(args.presenterAuthorized, "presenter-authorized"),
          disclose: json(args.disclose, "disclose"),
        }, {
          recipient,
          message: parseStringOption(args.message, "message") ?? "",
          plan: json(args.plan, "plan"),
          priorSaid: parseStringOption(args.prior ?? args.agree, "prior"),
        }, proposal ? yield* call(() => Deno.readFile(proposal)) : undefined);
        yield* call(() => Deno.writeFile(out!, prepared.wire, { createNew: true, mode: 0o600 }));
        const { wire: _, ...facts } = prepared;
        return { ...facts, output: out, transmitted: false };
      }
      if (!filename) throw new ValidationError("Resume requires the exact completed --input file");
      const original = runtime.exc.retainedInput(resume!);
      if (!original || original.serder.sad!.ri !== recipient) {
        throw new ValidationError("Recipient differs from the original prepared Grant");
      }
      const resumed = yield* resumePresentationFile(
        files,
        hab,
        resume!,
        yield* call(() => Deno.readFile(filename)),
      );
      let transmitted = false;
      if (out) yield* call(() => Deno.writeFile(out, resumed.delivery, { createNew: true, mode: 0o600 }));
      else {
        // The runtime's presentation owner delivers it when this member is the elected lead, with its retry,
        // bounded by the original Grant deadline.
        const ops = runtime.operations!.presentation;
        const member = isLocalGroupHab(hby, hab) ? localGroupMember(hby, hab.pre) : hab;
        const queued = deliverPreparedGrant(ops, { hab, said: resume!, delivery: resumed.delivery });
        if (queued) {
          const { status } = yield* withRuntimeWorkers(
            runtime,
            { hab: member, pollMailbox: false },
            () => waitForPresentation(ops, resume!, { timeoutMs: 2 ** 31 - 1 }),
          );
          if (status.state !== "done") {
            throw new ValidationError(
              status.state === "expired"
                ? "Original prepared presentation deadline expired during delivery"
                : status.state === "active"
                ? "Delivery did not finish"
                : status.reason,
            );
          }
          transmitted = true;
        }
      }
      return {
        grant: resume,
        deadline: resumed.deadline,
        accepted: runtime.exc.complete(resume!),
        transmitted,
        admitted: false,
        ...(out ? { output: out } : {}),
      };
    });
  });
  writeJsonLine(completed);
}
