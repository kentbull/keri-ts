/** IPEX presentation after the KERI command has joined workers and closed owned stores. */
import { RegistryCustody, type Wallet, WalletDiscloser } from "@keri-ts/wallet";
import {
  BlindState,
  BoundState,
  concatBytes,
  Matter,
  parseBytes,
  type SerderACDC,
  type SerderKERI,
  type Versionage,
} from "cesr-ts";
import { call, type Operation, race, scoped, sleep, spawn } from "effection";
import {
  ipexAdmitCommand as admit,
  ipexAgreeCommand as agree,
  ipexApplyCommand as apply,
  ipexGrantCommand as grant,
  type IpexJoinOptions,
  type IpexJoinResult,
  ipexOfferCommand as offer,
  ipexPollCommand as poll,
  type IpexSendResult,
  ipexSpurnCommand as spurn,
  joinIpexProposal,
  parseBooleanOption,
  parseGvrsn,
  parseNumberOption,
  parseStringOption,
  withRuntimeWorkers,
} from "keri-ts/cli";
import {
  admitIssuance,
  type AgentRuntime,
  deliverIssuanceAdmit,
  type GroupIpexBegun,
  type GroupIpexOperations,
  type Hab,
  isLocalGroupHab,
  Organizer,
  posterDelivery,
  preparePresentation,
  present,
  type PresentationDeps,
  type PresentationInput,
  PresentationOperations,
  proposeGroupIpex,
  proposeGroupPresentation,
  Receiptor,
  type RegistryDisclosure,
  runAgentRuntime,
  ValidationError,
  waitForGroupIpex,
  waitForPresentation,
} from "keri-ts/runtime";
import { withAgentRuntime, withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";
import { authoringWitnessAuths } from "../support/witness-auth.ts";
import { approveAcdcV2RegistryEvent } from "./acdc-v2-authoring.ts";

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

/**
 * Propose a group-authored v2 IPEX message through the runtime's group IPEX owner and observe it to the finite
 * approval wait. The owner publishes, collects, authorizes graph use and, unless `--out` takes the completed
 * message, lets the elected lead send it; this only hosts the workers and writes the file.
 */
function* acdcV2GroupDisclosure(
  runtime: AgentRuntime,
  hab: Hab,
  begin: (ops: GroupIpexOperations, deliver: boolean) => Operation<GroupIpexBegun>,
  args: Record<string, unknown>,
) {
  const timeout = parseNumberOption(args.approvalTimeoutSeconds, "approval-timeout") ?? 60;
  if (!Number.isFinite(timeout) || timeout < 0) throw new ValidationError("--approval-timeout must be nonnegative.");
  const ops = runtime.operations?.groupIpex;
  if (!ops) throw new ValidationError("ACDC v2 group IPEX requires the runtime's operation owners.");
  const out = parseStringOption(args.out, "out");
  const { said } = yield* begin(ops, !out);
  yield* withRuntimeWorkers(
    runtime,
    { hab, pollMailbox: true },
    () => waitForGroupIpex(ops, said, { timeoutMs: timeout * 1000 }),
  );
  const outcome = ops.outcomes.get(said);
  if (!runtime.exc.complete(said)) {
    return { said, accepted: false, status: "multisig-pending", ...(outcome ?? { messages: [], deliveries: [] }) };
  }
  if (out) {
    const chunks: Uint8Array[] = [];
    yield* call(async () => {
      for await (const chunk of runtime.exc.replay(said)) chunks.push(chunk);
    });
    Deno.writeFileSync(out, concatBytes(...chunks));
  }
  return {
    said,
    accepted: true,
    status: "multisig-complete",
    messages: outcome?.messages ?? [],
    deliveries: [...(outcome?.deliveries ?? []), ...(outcome?.sent ?? [])],
  };
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
  if (args.listen !== undefined && !args.issue) throw new ValidationError("--listen requires live group --issue");
  if (args.prepare && args.issue) {
    throw new ValidationError("Presentation --prepare and fresh --issue are separate actions");
  }
  if (args.prepare || args.resume && !args.issue) {
    const { ipexPresentationFileCommand } = yield* call(() => import("./ipex-presentation.ts"));
    return yield* ipexPresentationFileCommand(args);
  }
  if (parseBooleanOption(args.issue, "issue") ?? false) {
    const { ipexIssueCommand } = yield* call(() => import("./ipex-issuance.ts"));
    return yield* ipexIssueCommand(args);
  }
  if (
    args.credential || args.resume || args.artifact || args.coordinator || args.custodian || args.proposal
    || args.proposalOutput || args.proofOutput
  ) {
    throw new ValidationError("Fresh issuance options require --issue");
  }
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
    { skipConfig: false },
    function*({ hby, runtime, hab }) {
      return yield* scoped(function*() {
        if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
        const auths = authoringWitnessAuths(hab, args);
        const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
        if (isLocalGroupHab(hby, hab)) {
          const admit = yield* wallet.prepareAdmitBody(said, hab.pre, { consent, message, gvrsn });
          const result = yield* acdcV2GroupDisclosure(
            runtime,
            hab,
            (ops, deliver) => proposeGroupIpex(ops, { hab, exn: admit, gvrsn, deliver }),
            args,
          );
          if (!result.accepted) return { ...result, grant: said };
          const admission = yield* call(() => wallet.recordAdmission(said, admit.said!, { consent }));
          return { ...result, ...admission };
        }
        const deps = {
          hby,
          rgy: runtime.acdc,
          exc: runtime.exc,
          receiptor: new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock, {
            gvrsn: parseGvrsn(args.witnessGvrsn ?? "1"),
          }),
          reactor: runtime.reactor,
          protocol: runtime.protocol,
          delivery: posterDelivery(runtime.postman),
          clock: runtime.clock,
        };
        const admitted = yield* admitIssuance(deps, { hab, grant: said, message, gvrsn, auths });
        // The inventory record precedes delivery, as before: the embedder reacts to the accepted Admit.
        const admission = yield* call(() => wallet.recordAdmission(said, admitted.admit.said!, { consent }));
        let deliveries: string[] = [];
        if (out) Deno.writeFileSync(out, admitted.wire);
        else {
          const host = yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: false }));
          try {
            deliveries = yield* deliverIssuanceAdmit(deps, hab, admitted);
          } finally {
            yield* host.halt();
          }
        }
        return { ...admission, said: admitted.admit.said!, deliveries };
      });
    },
  );
  writeJsonLine(completed);
}

/** Decode exactly one raw opening tuple through existing CESR primitive and record codecs. */
function openingFile(path: string): RegistryDisclosure {
  const raw = Deno.readFileSync(path), fields: Uint8Array[] = [];
  for (let offset = 0; offset < raw.length;) {
    const field = new Matter({ qb64b: raw.subarray(offset) }).qb64b;
    fields.push(field);
    offset += field.length;
  }
  if (fields.length === 6) {
    return BoundState.fromQb64bTuple([fields[0], fields[1], fields[2], fields[3], fields[4], fields[5]]);
  }
  if (fields.length === 4) return BlindState.fromQb64bTuple([fields[0], fields[1], fields[2], fields[3]]);
  throw new ValidationError("Opening file must carry exactly one raw blind or bound state tuple.");
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
    { skipConfig: false },
    function*({ hby, runtime, hab }) {
      return yield* scoped(function*() {
        if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
        const auths = verb === "grant" || verb === "agree" ? authoringWitnessAuths(hab, args) : undefined;
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
          derive ? new RegistryCustody({ hby, hab, registry: wallet.registry, db: wallet.db }) : undefined,
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
          openings: (Array.isArray(args.opening) ? args.opening as string[] : []).map(openingFile),
        };
        const options = {
          auths,
          attrs: json(args.attrs, "attrs"),
          gvrsn: parseGvrsn(args.gvrsn ?? "2"),
          message,
          recipient,
          plan,
          anchor: parseBooleanOption(args.anchor, "anchor"),
          priorSaid,
        };
        const registryName = parseStringOption(args.presentationRegistry, "presentation-registry");
        if (registryName && !runtime.acdc.registryByName(registryName)) {
          throw new ValidationError("Unknown presentation registry.");
        }
        const custody = derive
          ? new RegistryCustody({ hby, hab, registry: wallet.registry, db: wallet.db })
          : undefined;
        const deps: PresentationDeps = {
          hby,
          rgy: runtime.acdc,
          exc: runtime.exc,
          receiptor: discloser.receiptor,
          reactor: runtime.reactor,
          protocol: runtime.protocol,
          delivery: posterDelivery(runtime.postman),
          clock: runtime.clock,
          views: wallet,
          derived: custody?.options.store,
        };
        if (isLocalGroupHab(hby, hab) && verb === "grant") {
          if (!registryName) {
            // A group presents through the runtime: the Grant is frozen once and approved by the other members.
            return yield* acdcV2GroupDisclosure(
              runtime,
              hab,
              (ops, deliver) => proposeGroupPresentation(deps, ops, { hab, selection, options, deliver }),
              args,
            );
          }
          let selected = yield* discloser.prepareGrantBody(hab.pre, selection, options);
          if (registryName) {
            const reg = runtime.acdc.registryByName(registryName)!;
            const node = parseBytes(selected.raw)[0].body as SerderACDC;
            if (
              reg.hab.pre !== hab.pre || node.issuee !== hab.pre || (node.sad!.a as { rd?: unknown }).rd !== reg.regk
            ) {
              throw new ValidationError(
                "Presentation registry must match the selected disclosed local Issuee declaration.",
              );
            }
            const timeout = parseNumberOption(args.approvalTimeoutSeconds, "approval-timeout") ?? 60;
            if (!Number.isFinite(timeout) || timeout < 0) {
              throw new ValidationError("--approval-timeout must be nonnegative.");
            }
            const [proof, update] = reg.present(selected.exn, "presented");
            yield* race([
              (function*() {
                yield* scoped(function*() {
                  yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: true }));
                  yield* approveAcdcV2RegistryEvent(hby, runtime, hab, discloser.receiptor, update, proof, auths);
                });
              })(),
              (function*() {
                yield* sleep(timeout * 1000);
                throw new ValidationError("Group presentation approval remains pending.");
              })(),
            ]);
            const seal = runtime.acdc.store.anchor(update.said!)!;
            selected = yield* discloser.attachPresentationProof(selected, proof, { s: seal[0], d: seal[1] });
          }
          return yield* acdcV2GroupDisclosure(
            runtime,
            hab,
            (ops, deliver) =>
              proposeGroupIpex(ops, { hab, exn: selected.exn, nests: selected.nests, gvrsn: options.gvrsn, deliver }),
            args,
          );
        }
        const request: PresentationInput = verb === "apply"
          ? { verb, hab, options }
          : verb === "agree" || verb === "spurn"
          ? { verb, hab, prior: priorSaid ?? "", message, recipient, auths }
          : { verb, hab, selection, options: { ...options, presentationRegistry: registryName } };
        if (out) {
          const prepared = yield* preparePresentation(deps, request);
          Deno.writeFileSync(out, prepared.wire);
          return { said: prepared.exn.said, accepted: true, deliveries: [] as string[] };
        }
        const ops = new PresentationOperations(deps);
        const { said } = yield* present(ops, request, { maxAttempts: 1 });
        // Delivery has no CLI deadline of its own: the transport outcome or the Grant's original deadline ends it.
        const { status } = yield* withRuntimeWorkers(runtime, { hab, pollMailbox: false }, function*() {
          const driver = yield* spawn(function*() {
            while (true) {
              yield* ops.processOnce();
              yield* sleep(50);
            }
          });
          try {
            return yield* waitForPresentation(ops, said, { timeoutMs: 2 ** 31 - 1 });
          } finally {
            yield* driver.halt();
          }
        });
        if (status.state === "done") return { said, accepted: true, deliveries: [...status.deliveries ?? []] };
        if (status.state === "active") throw new ValidationError("ACDC v2 presentation delivery did not finish.");
        throw status.state === "failed" ? new Error(status.reason) : new ValidationError(status.reason);
      });
    },
  );
  writeJsonLine(completed);
}

/**
 * Live exact-Grant Unblind qry/rpy is the default, as in KERIpy; offline candidate
 * recovery from an `--opening` file is the explicit fallback. Neither creates an Admit.
 */
export function* ipexUnblindCommand(args: Record<string, unknown>): Operation<void> {
  if (!args.opening) {
    const { ipexLiveUnblindCommand } = yield* call(() => import("./ipex-unblinding.ts"));
    return yield* ipexLiveUnblindCommand(args);
  }
  if (args.grant || args.listen !== undefined || args.timeout || args.input || args.proposer) {
    throw new ValidationError("Offline --opening recovery excludes the live --grant options");
  }
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
      if (out) Deno.writeFileSync(out, "bn" in proof ? BoundState.qb64b(proof) : BlindState.qb64b(proof));
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

/** Explicit peer consent records v2 inventory only after the exact Admit reaches threshold. */
export function* joinWalletIpex(
  wallet: Wallet,
  runtime: AgentRuntime,
  options: IpexJoinOptions,
): Operation<IpexJoinResult> {
  const result = yield* joinIpexProposal(wallet.hby, runtime, runtime.vdr?.reger ?? null, options);
  const group = result.group;
  if (
    group?.embedded.pvrsn.major === 2 && group.embedded.route === "/ipex/admit"
    && group.approved === true && group.accepted === true
  ) {
    yield* call(() => wallet.recordAdmission(group.embedded.ked!.p as string, group.embedded.said!, { consent: true }));
    group.credentialSaved = true;
  }
  return result;
}

/** Display selected coordination identity and approval facts, including poll-discovered outer SAIDs. */
export function* ipexJoinCommand(args: Record<string, unknown>): Operation<void> {
  const options: IpexJoinOptions = {
    alias: parseStringOption(args.alias, "alias"),
    said: parseStringOption(args.said, "said"),
    auto: parseBooleanOption(args.auto, "auto"),
    gvrsn: parseGvrsn(args.gvrsn),
    approvalTimeoutSeconds: parseNumberOption(args.approvalTimeoutSeconds, "approval-timeout") ?? 60,
  };
  if (!Number.isFinite(options.approvalTimeoutSeconds) || options.approvalTimeoutSeconds < 0) {
    throw new ValidationError("--approval-timeout must be nonnegative.");
  }
  const { exn, group } = yield* withAgentRuntime(
    walletStoreArgs(args),
    { skipConfig: false },
    function*({ hby, runtime }) {
      return yield* scoped(function*() {
        if (!runtime.acdc) throw new ValidationError("ACDC v2 registry evidence is unavailable.");
        const wallet = yield* openWallet(hby, runtime.acdc.store, runtime.exc);
        return yield* joinWalletIpex(wallet, runtime, options);
      });
    },
  );
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
