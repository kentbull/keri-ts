/** IPEX presentation after the KERI command has joined workers and closed owned stores. */
import { RegistryCustody, WalletDiscloser } from "@keri-ts/wallet";
import { BlindState, BoundState, concatBytes, isGroupTuple, NumberPrimitive, parseBlinder, Vrsn_2_0 } from "cesr-ts";
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
import { publicOpeningAttachment } from "keri-ts/db";
import {
  CREDENTIAL_MAILBOX_TOPIC,
  Organizer,
  Receiptor,
  type RegistryDisclosure,
  runAgentRuntime,
  ValidationError,
} from "keri-ts/runtime";
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
  if (args.acdcV2) return yield* acdcV2Disclosure(args, "apply");
  printSend(yield* apply(args));
}

/** Display a completed offer attempt after resource cleanup. */
export function* ipexOfferCommand(args: Record<string, unknown>): Operation<void> {
  if (args.acdcV2) return yield* acdcV2Disclosure(args, "offer");
  printSend(yield* offer(args));
}

/** Display a completed agree attempt after resource cleanup. */
export function* ipexAgreeCommand(args: Record<string, unknown>): Operation<void> {
  if (args.acdcV2) return yield* acdcV2Disclosure(args, "agree");
  printSend(yield* agree(args));
}

/** Display a completed spurn attempt after resource cleanup. */
export function* ipexSpurnCommand(args: Record<string, unknown>): Operation<void> {
  if (args.acdcV2) return yield* acdcV2Disclosure(args, "spurn");
  printSend(yield* spurn(args));
}

/** Project grant facts, retaining the distinction between pending group evidence and completed business EXNs. */
export function* ipexGrantCommand(args: Record<string, unknown>): Operation<void> {
  if (args.acdcV2) return yield* acdcV2Disclosure(args, "grant");
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
  if (parseBooleanOption(args.acdcV2, "acdc-v2") ?? false) {
    yield* acdcV2Admit(args);
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

/** Compose a single-holder ACDC v2 admission; domain checks and signing belong to Wallet. */
function* acdcV2Admit(args: Record<string, unknown>): Operation<void> {
  const consent = parseBooleanOption(args.consent, "consent") ?? false;
  if (!consent) throw new ValidationError("ACDC v2 wallet admission requires explicit --consent.");
  const said = parseStringOption(args.said, "said"), alias = parseStringOption(args.alias, "alias");
  if (!said) throw new ValidationError("Accepted ACDC v2 Grant --said is required.");
  if (args.grantFile) throw new ValidationError("ACDC v2 wallet admission selects an accepted Grant with --said.");
  const out = parseStringOption(args.out, "out"), message = parseStringOption(args.message, "message") ?? "";
  const gvrsn = parseGvrsn(args.gvrsn ?? "2");
  const completed = yield* withHabAndAgentRuntime(
    walletStoreArgs(args),
    alias,
    { skipConfig: true },
    function*({ hby, runtime, hab }) {
      return yield* scoped(function*() {
        if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
        const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
        const prepared = yield* wallet.prepareAdmit(said, hab.pre, {
          consent,
          message,
          gvrsn,
          receiptor: new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock, {
            gvrsn: parseGvrsn(args.witnessGvrsn ?? "1"),
          }),
        });
        const wire = concatBytes(prepared.support, prepared.wire);
        yield* runtime.reactor.processBytes(wire, { local: true });
        yield* runtime.protocol.processEscrowsOnce();
        if (!runtime.exc.complete(prepared.admit.said!)) {
          throw new ValidationError("Local ACDC v2 Admit was not accepted.");
        }
        const admission = yield* call(() => wallet.recordAdmission(said, prepared.admit.said!, { consent }));
        let deliveries: string[] = [];
        if (out) Deno.writeFileSync(out, wire);
        else {
          const host = yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: false }));
          try {
            const event = runtime.postman.send({
              src: hab.pre,
              dest: prepared.admit.sad!.ri as string,
              topic: CREDENTIAL_MAILBOX_TOPIC,
              msg: wire,
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

/** Decode an explicitly supplied counted opening through the shared CESR tuple codec. */
function openingFile(path: string): RegistryDisclosure {
  const raw = Deno.readFileSync(path), group = parseBlinder(raw, Vrsn_2_0, "txt"), tuple = group.items[0];
  if (group.consumed !== raw.length || group.items.length !== 1 || !isGroupTuple(tuple)) {
    throw new ValidationError("Opening file must carry exactly one counted blind/bound tuple.");
  }
  const fields = tuple.map((field) => {
    if (isGroupTuple(field) || !("qb64" in field)) throw new ValidationError("Invalid opening tuple field.");
    return field.qb64;
  });
  const common = { d: fields[0], u: fields[1], td: fields[2], ts: fields[3] };
  return fields.length === 6
    ? BoundState.fromSad({ ...common, bn: new NumberPrimitive({ qb64: fields[4] }).numh, bd: fields[5] })
    : BlindState.fromSad(common);
}

/** Thin ACDC v2 argument/delivery wiring; wallet owns view selection, root gates, signing and source receipts. */
function* acdcV2Disclosure(
  args: Record<string, unknown>,
  verb: "apply" | "offer" | "agree" | "spurn" | "grant",
): Operation<void> {
  const alias = parseStringOption(args.alias, "alias"), out = parseStringOption(args.out, "out");
  const message = parseStringOption(args.message, "message") ?? "";
  const json = (value: unknown, name: string) => {
    const text = parseStringOption(value, name);
    return text === undefined
      ? undefined
      : JSON.parse(text.startsWith("@") ? Deno.readTextFileSync(text.slice(1)) : text);
  };
  const completed = yield* withHabAndAgentRuntime(
    walletStoreArgs(args),
    alias,
    { skipConfig: true },
    function*({ hby, runtime, hab }) {
      return yield* scoped(function*() {
        if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
        const input = parseStringOption(args.input, "input");
        if (input) {
          yield* runtime.reactor.processBytes(Deno.readFileSync(input));
          yield* runtime.protocol.processEscrowsOnce();
        }
        const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
        const derive = parseBooleanOption(args.derive, "derive") ?? false;
        const discloser = new WalletDiscloser(
          wallet,
          new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock, {
            gvrsn: parseGvrsn(args.witnessGvrsn ?? "1"),
          }),
          derive ? new RegistryCustody({ hby, registry: wallet.registry, db: wallet.db }) : undefined,
        );
        const requestedRecipient = parseStringOption(args.recipient, "recipient");
        const recipient = requestedRecipient
          ? new Organizer(hby.db, hby.signator).resolveRecipient(requestedRecipient)
          : undefined;
        const plan = json(args.plan, "plan");
        const priorSaid = parseStringOption(args.prior ?? args.agree ?? args.apply ?? args.offer, "prior");
        const selection = {
          transferred: args.view ? Deno.readFileSync(parseStringOption(args.view, "view")!) : undefined,
          said: parseStringOption(args.said, "said"),
          fromGrant: parseStringOption(args.fromGrant, "from-grant"),
          presenterAuthorized: parseBooleanOption(args.presenterAuthorized, "presenter-authorized"),
          disclose: json(args.disclose, "disclose"),
          refresh: parseBooleanOption(args.refresh, "refresh"),
          derive,
          boundEvent: parseStringOption(args.boundEvent, "bound-event"),
          openings: (Array.isArray(args.opening) ? args.opening as string[] : []).map(openingFile),
        };
        const options = {
          attrs: json(args.attrs, "attrs"),
          gvrsn: parseGvrsn(args.gvrsn ?? "2"),
          message,
          recipient,
          plan,
          xid: parseStringOption(args.xid, "xid"),
          anchor: parseBooleanOption(args.anchor, "anchor"),
          priorSaid,
        };
        const registryName = parseStringOption(args.presentationRegistry, "presentation-registry");
        if (registryName && !runtime.acdc.registryByName(registryName)) {
          throw new ValidationError("Unknown presentation registry.");
        }
        const prepared = verb === "apply"
          ? yield* discloser.prepareApply(hab.pre, options)
          : verb === "offer"
          ? yield* discloser.prepareOffer(hab.pre, selection, options)
          : verb === "grant"
          ? yield* discloser.prepareGrant(hab.pre, selection, {
            ...options,
            presentation: registryName ? runtime.acdc.registryByName(registryName) ?? undefined : undefined,
          })
          : yield* discloser.prepareReply(hab.pre, verb, priorSaid ?? "", message, recipient);
        const wire = concatBytes(discloser.kel(hab), prepared.support, prepared.wire);
        yield* runtime.reactor.processBytes(wire, { local: true });
        yield* runtime.protocol.processEscrowsOnce();
        if (!runtime.exc.complete(prepared.exn.said!)) {
          throw new ValidationError("ACDC v2 exchange remains pending authenticated intake.");
        }
        let deliveries: string[] = [];
        if (out) Deno.writeFileSync(out, wire);
        else {
          const host = yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: false }));
          try {
            const sent = runtime.postman.send({
              src: hab.pre,
              dest: prepared.exn.sad!.ri as string,
              topic: CREDENTIAL_MAILBOX_TOPIC,
              msg: wire,
            }, { notify: true });
            const result = yield* runtime.postman.wait(sent);
            if (result.kin === "failed") throw result.error;
            deliveries = result.deliveries;
          } finally {
            yield* host.halt();
          }
        }
        return { said: prepared.exn.said, accepted: true, deliveries };
      });
    },
  );
  writeJsonLine(completed);
}

/** Recover only the requested commitment candidate through CESR's existing unblind operation. */
export function* ipexUnblindCommand(args: Record<string, unknown>): Operation<void> {
  const path = parseStringOption(args.opening, "opening"), said = parseStringOption(args.said, "said");
  if (!path || !said) throw new ValidationError("Unblind requires --opening and --said.");
  const states = JSON.parse(parseStringOption(args.states, "states") ?? "[]");
  if (!Array.isArray(states) || !states.every(value => typeof value === "string")) {
    throw new ValidationError("--states must be a JSON string array.");
  }
  const completed = yield* withHabAndAgentRuntime(walletStoreArgs(args), parseStringOption(args.alias, "alias"), {
    skipConfig: true,
  }, function*({ hby, runtime }) {
    return yield* scoped(function*() {
      const wallet = yield* openWallet(hby, runtime.acdc!.store, runtime.exc);
      const discloser = new WalletDiscloser(wallet, new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock));
      const proof = discloser.unblind(openingFile(path), said, states);
      if (!proof) throw new ValidationError("Candidates do not match the exact opening commitment.");
      const out = parseStringOption(args.out, "out");
      if (out) Deno.writeFileSync(out, publicOpeningAttachment(proof));
      return { commitment: proof.d.nonce, credential: proof.td.nonce, state: proof.ts.label, matched: true };
    });
  });
  writeJsonLine(completed);
}

/** Project settled mailbox records without exposing Serder internals in CLI JSON. */
export function* ipexPollCommand(args: Record<string, unknown>): Operation<void> {
  const { batches, messages, ipex, saved } = yield* poll(args);
  writeJsonLine({
    batches,
    messages,
    ipex: ipex.map((exn) => ({ said: exn.said, route: exn.route, sender: exn.ked?.i, prior: exn.ked?.p })),
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
