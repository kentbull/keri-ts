/** Finite individual issuance over the selected runtime's DH owner; wallet owns issuance and Admit stays separate. */
import {
  exchangeWire,
  type IssuanceGrantOptions,
  RegistryCustody,
  type Wallet,
  WalletAuthor,
  WalletDiscloser,
} from "@keri-ts/wallet";
import {
  bytesEqual,
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  parseBytes,
  SerderACDC,
  SerderKERI,
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, race, scoped, spawn } from "effection";
import { parseBooleanOption, parseGvrsn, parseIntegerOption, parseNumberOption, parseStringOption } from "keri-ts/cli";
import {
  type AgentRuntime,
  createAgentRuntime,
  CREDENTIAL_MAILBOX_TOPIC,
  isLocalGroupHab,
  type KramConfig,
  localGroupMember,
  messagize,
  NodeHttpClient,
  Organizer,
  Receiptor,
  runAgentRuntime,
  type RuntimeClock,
  systemClock,
  timestampMicros,
  ValidationError,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import { withExistingHab } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";
import { authoringWitnessAuths } from "../support/witness-auth.ts";
import {
  acceptGroupIssuanceProof,
  awaitGroupIssuanceProof,
  prepareGroupDerivedIssuance,
  runGroupDerivedIssuance,
} from "./ipex-group-issuance.ts";

/** Explicit consent to one retained Grant, not a selector for other pending exchanges. */
export interface DerivedIssuanceRequest {
  role: "issuer" | "recipient";
  grant: string;
}
/** Local acceptance facts; successful delivery does not claim remote acceptance or admission. */
export interface DerivedIssuanceResult {
  grant: string;
  xid: string;
  registry: string;
  registryIssued: true;
  admitted: false;
}

/** Wait using the same timer owner as this runtime; cancellation releases the timer. */
function* wait(clock: RuntimeClock, milliseconds: number): Operation<void> {
  yield* action<void>(resolve => {
    const timer = clock.setTimeout(resolve, milliseconds);
    return () => clock.clearTimeout(timer);
  });
}

/** Check actual composition before any approval, signing or root access. */
function owners(runtime: AgentRuntime, wallet: Wallet) {
  const selected = runtime.ipexAuxiliary;
  if (
    selected?.kind !== "dhke" || !runtime.acdc || wallet.hby !== runtime.hby
    || wallet.registry !== runtime.acdc.store || wallet.exc !== runtime.exc
  ) {
    throw new ValidationError("Derived issuance requires the wallet's selected DH runtime and registry");
  }
  const dh = selected.owner, hab = dh.hab;
  if (isLocalGroupHab(runtime.hby, hab)) {
    throw new ValidationError(
      "This finite issuance workflow requires an individual habitat; group issuance needs explicit member coordination",
    );
  }
  return { dh, hab, rgy: runtime.acdc };
}

/** Prepare and locally authenticate a fresh pending Grant without generating a root or issuing a BUP. */
export function* prepareDerivedIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  credential: SerderACDC,
  options: IssuanceGrantOptions,
): Operation<{ grant: string; wire: Uint8Array }> {
  const { hab, rgy } = owners(runtime, wallet);
  if (!credential.regid || rgy.regs.get(credential.regid)?.hab !== hab) {
    throw new ValidationError("Fresh issuance requires the selected issuer's managed local registry");
  }
  hab.mgr.requireRegistryRootAccess();
  const discloser = new WalletDiscloser(
    wallet,
    new Receiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock),
  );
  const prepared = yield* discloser.prepareIssuanceGrantBody(hab.pre, credential, options);
  const wire = concatBytes(discloser.proofSupport(prepared.raw, hab), exchangeWire(hab, prepared.exn, prepared.nests));
  yield* runtime.reactor.processBytes(wire, { local: true });
  yield* runtime.protocol.processEscrowsOnce();
  const xid = prepared.exn.ilk === "xip" ? prepared.exn.said! : prepared.exn.sad!.x as string;
  if (!runtime.exc.pendingGrant(prepared.exn.said!, { xid, sender: hab.pre, recipient: options.recipient })) {
    throw new ValidationError("Fresh Grant did not reach authenticated pending issuance");
  }
  return { grant: prepared.exn.said!, wire };
}

/**
 * Run one explicitly selected individual issuance under an elapsed timeout and the original Grant deadline.
 * Start/join existing host workers, deliver through Poster, and abandon local DH on every exit.
 * Borrowed runtime and wallet lifetimes belong to the caller. This never prepares or records Admit.
 */
export function* runDerivedIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  request: DerivedIssuanceRequest,
  { timeoutMs, witnessGvrsn, auths }: { timeoutMs: number; witnessGvrsn?: Versionage; auths?: WitnessAuthMap },
): Operation<DerivedIssuanceResult> {
  const { dh, hab, rgy } = owners(runtime, wallet);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ValidationError("Issuance timeout must be finite and positive");
  }
  const input = runtime.exc.retainedInput(request.grant, { pending: true });
  const credential = input?.nests?.[0]?.body;
  if (
    !input || !(credential instanceof SerderACDC) || !credential.regid
    || (request.role === "issuer" ? input.serder.pre : input.serder.sad!.ri) !== hab.pre
    || input.sourceSeals?.length || input.ptds?.length || input.essrs?.length
  ) {
    throw new ValidationError("Select the exact unanchored pending issuance Grant for this local party");
  }
  const registry = credential.regid;
  const reg = rgy.regs.get(registry);
  if (request.role === "issuer" && (!reg || reg.hab !== hab)) {
    throw new ValidationError("Issuance requires the selected issuer's managed local registry");
  }
  const receiptor = new Receiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock, { gvrsn: witnessGvrsn });
  const discloser = new WalletDiscloser(wallet, receiptor);
  const raw = concatBytes(
    Counter.makeGVC(Vrsn_2_0),
    ...yield* call(() => Promise.all((input.nests ?? []).map(nest => collectPayload(framePayload(nest))))),
  );
  const frame = parseBytes(messagize(input.serder, { tsgs: input.tsgs, cigars: input.cigars, gvrsn: Vrsn_2_0 }))[0];
  frame.nests = [...input.nests ?? []];
  const grantWire = yield* call(() => collectPayload(framePayload(frame)));
  const deadline = runtime.exc.exchangeDeadline(input.serder);
  const expires = deadline ? timestampMicros(deadline) : null;
  if (expires === null) throw new Error("Authenticated pending Grant has a missing or corrupt deadline");
  const remainingMs = Number(expires - BigInt(runtime.clock.now()) * 1000n) / 1000;
  const xid = dh.approve(request.grant);
  try {
    return yield* race([
      call(function*() {
        return yield* scoped(function*() {
          const host = yield* spawn(() => runAgentRuntime(runtime, { hab, pollMailbox: true }));
          function* send(msg: Uint8Array, dest: string): Operation<void> {
            const event = runtime.postman.send({ src: hab.pre, dest, topic: CREDENTIAL_MAILBOX_TOPIC, msg }, {
              notify: true,
            });
            const outcome = yield* runtime.postman.wait(event);
            if (outcome.kin === "failed") throw outcome.error;
          }
          try {
            const peer = request.role === "issuer" ? input.serder.sad!.ri as string : input.serder.pre!;
            let query: Uint8Array | undefined;
            let nextQuery = 0;
            if (request.role === "issuer") {
              yield* send(concatBytes(discloser.proofSupport(raw, hab), grantWire), peer);
              query = dh.start(request.grant);
            }
            while (true) {
              while (dh.outgoing.length) {
                const message = dh.outgoing.pull()!;
                if (message.kin === "sign") {
                  throw new ValidationError("Individual issuance cannot process group contributions");
                }
                yield* send(message.msg, message.dest);
              }
              if (dh.complete(xid)) break;
              if (query && runtime.clock.now() >= nextQuery) {
                yield* send(query, peer);
                nextQuery = runtime.clock.now() + 1000;
              }
              yield* wait(runtime.clock, 50);
            }
            if (request.role === "issuer") {
              const custody = new RegistryCustody({ hby: runtime.hby, hab, registry: wallet.registry, db: wallet.db });
              yield* new WalletAuthor(wallet, rgy, receiptor, custody).issue(reg!, credential, { auths });
            } else {
              while (wallet.registry.headEvent(registry)?.ilk === "rip") {
                dh.complete(xid);
                yield* wait(runtime.clock, 50);
              }
            }
            yield* dh.finish(xid);
            if (!runtime.exc.complete(request.grant)) throw new ValidationError("Issued Grant remains unaccepted");
            if (request.role === "issuer") yield* send(discloser.proofSupport(raw, hab), peer);
            return { grant: request.grant, xid, registry, registryIssued: true, admitted: false } as const;
          } finally {
            yield* host.halt();
          }
        });
      }),
      call(function*(): Operation<never> {
        yield* wait(runtime.clock, Math.min(timeoutMs, Math.max(0, remainingMs)));
        throw new ValidationError(
          "Derived issuance reached its elapsed limit or original Grant deadline; no Admit was created",
        );
      }),
    ]);
  } finally {
    dh.abandon(xid);
  }
}

/** CLI resource boundary shared only by these two finite issuance actions. */
function* issuanceCommand(args: Record<string, unknown>, role: "issuer" | "recipient"): Operation<void> {
  const listen = parseIntegerOption(args.listen, "listen");
  if (listen !== undefined && (listen < 1 || listen > 65535)) {
    throw new ValidationError("--listen must be a port between 1 and 65535");
  }
  const alias = parseStringOption(args.alias, "alias");
  const timeout = parseNumberOption(args.timeout, "timeout") ?? 60;
  if (!Number.isFinite(timeout) || timeout <= 0) throw new ValidationError("--timeout must be finite and positive");
  for (
    const field of [
      "anchor",
      "derive",
      "opening",
      "fromGrant",
      "view",
      "refresh",
      "disclose",
      "presentationRegistry",
      "presenterAuthorized",
    ]
  ) {
    if (args[field]) throw new ValidationError(`--${field} is outside fresh derived issuance`);
  }
  if (args.gvrsn && parseGvrsn(args.gvrsn).major !== 2) throw new ValidationError("Derived issuance requires genus 2");
  const completed = yield* withExistingHab(
    walletStoreArgs(args),
    alias,
    { skipConfig: false },
    function*({ hby, hab }) {
      const auths = role === "issuer" ? authoringWitnessAuths(hab, args) : undefined;
      const group = isLocalGroupHab(hby, hab);
      if (listen !== undefined && (!group || args.out || args.proof)) {
        throw new ValidationError("--listen requires a live group issuance phase, without --out or --proof");
      }
      const coordinator = parseStringOption(args.coordinator, "coordinator"),
        custodian = parseStringOption(args.custodian, "custodian");
      if (group && (!coordinator || !custodian)) {
        throw new ValidationError("Group issuance requires --coordinator and --custodian");
      }
      if (
        !group
        && [args.coordinator, args.custodian, args.proposal, args.proposalOutput, args.proof, args.proofOutput].some(
          Boolean,
        )
      ) {
        throw new ValidationError("Group selection/proof options require a group habitat");
      }
      const selection = group ? { coordinator: coordinator!, custodian: custodian! } : undefined;
      const runtime = yield* createAgentRuntime(hby, new NodeHttpClient(), systemClock, {
        kram: hby.cf?.get<{ kram?: KramConfig }>().kram,
        ipexAuxiliary: { kind: "dhke", hab },
      });
      try {
        return yield* scoped(function*() {
          const wallet = yield* openWallet(hby, runtime.acdc!.store, runtime.exc);
          const input = parseStringOption(args.input, "input");
          if (input) {
            yield* runtime.reactor.processBytes(yield* call(() => Deno.readFile(input)));
            yield* runtime.protocol.processEscrowsOnce();
          }
          const proofFile = parseStringOption(args.proof, "proof");
          const setupGrant = role === "recipient" ? parseStringOption(args.said, "said") : undefined;
          // An issuer member's setup of its own group's Grant is the post-BUP proof phase.
          const issuerProof = !!selection && !!setupGrant
            && runtime.exc.retainedInput(setupGrant, { pending: true })?.serder.pre === hab.pre;
          if (proofFile || issuerProof) {
            const grant = parseStringOption(args.said, "said");
            if (!selection || !grant) {
              throw new ValidationError("Final group proof requires --said and exact group selection");
            }
            // Mailbox delivery on `multisig` is the default; --proof FILE is the fallback.
            const verified = proofFile
              ? yield* acceptGroupIssuanceProof(
                runtime,
                wallet,
                grant,
                selection,
                yield* call(() => Deno.readFile(proofFile)),
              )
              : yield* scoped(function*() {
                const host = yield* spawn(() =>
                  runAgentRuntime(runtime, { hab: localGroupMember(hby, hab.pre), pollMailbox: true })
                );
                try {
                  return yield* awaitGroupIssuanceProof(runtime, wallet, grant, selection, timeout * 1000);
                } finally {
                  yield* host.halt();
                }
              });
            if (!verified) throw new ValidationError("Final group proof requires its accepted current issued BUP");
            return { grant, registryIssued: true, admitted: false };
          }
          const proofOutput = parseStringOption(args.proofOutput, "proof-output");
          const proposalFile = parseStringOption(args.proposal, "proposal");
          let proposal: Uint8Array | undefined = proposalFile
            ? yield* call(() => Deno.readFile(proposalFile))
            : undefined;
          let selected = parseStringOption(
            role === "issuer" ? args.resume : args.said,
            role === "issuer" ? "resume" : "said",
          );
          if (role === "issuer" && !selected) {
            const filename = parseStringOption(args.credential, "credential");
            const recipient = parseStringOption(args.recipient, "recipient");
            if (!filename || !recipient || args.said) {
              throw new ValidationError("--issue requires --credential and --recipient, without --said");
            }
            const bytes = yield* call(() => Deno.readFile(filename)), credential = new SerderACDC({ raw: bytes });
            if (!bytesEqual(credential.raw, bytes)) {
              throw new ValidationError("Credential file must contain exactly one ACDC body");
            }
            const planText = parseStringOption(args.plan, "plan");
            const artifacts = Array.isArray(args.artifact) ? args.artifact : [];
            if (artifacts.some(path => typeof path !== "string")) {
              throw new ValidationError("Artifact paths must be strings");
            }
            const options: IssuanceGrantOptions = {
              recipient: new Organizer(hby.db, hby.signator).resolveRecipient(recipient),
              message: parseStringOption(args.message, "message") ?? "",
              priorSaid: parseStringOption(args.prior ?? args.agree, "prior"),
              plan: planText
                ? JSON.parse(planText.startsWith("@") ? Deno.readTextFileSync(planText.slice(1)) : planText)
                : undefined,
              artifacts: yield* call(() => Promise.all(artifacts.map(path => Deno.readFile(path)))),
            };
            const prepared = selection
              ? yield* prepareGroupDerivedIssuance(runtime, wallet, credential, options, selection)
              : yield* prepareDerivedIssuance(runtime, wallet, credential, options);
            if ("proposal" in prepared) proposal = prepared.proposal;
            selected = prepared.grant;
            const out = parseStringOption(args.out, "out");
            if (out) {
              yield* call(() =>
                Deno.writeFile(out, "wire" in prepared ? prepared.wire : prepared.proposal, {
                  createNew: true,
                  mode: 0o600,
                })
              );
              return { grant: selected, prepared: true, registryIssued: false, admitted: false, output: out };
            }
          } else if (
            role === "issuer"
            && (args.credential || args.out || args.plan || args.artifact || args.prior || args.agree || args.message
              || args.said)
          ) {
            throw new ValidationError(
              "--resume selects retained Grant bytes without new credential, plan, artifacts, prior or output",
            );
          }
          if (!selected) throw new ValidationError("Recipient setup requires the exact pending Grant --said");
          if (selection && role === "issuer") {
            if (!proposal) {
              throw new ValidationError("Group issuer members must select --proposal FILE with --resume GRANT");
            }
            const output = parseStringOption(args.proposalOutput, "proposal-output");
            if (output) yield* call(() => Deno.writeFile(output, proposal!, { createNew: true, mode: 0o600 }));
            if (localGroupMember(hby, hab.pre).pre === selection.custodian && !proposalFile && !output) {
              throw new ValidationError(
                "New group issuance requires --proposal-output for the other members' exact selection",
              );
            }
          }
          if (role === "issuer" && args.recipient) {
            const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(
              parseStringOption(args.recipient, "recipient")!,
            );
            const selectedRecipient = selection && proposal
              ? (parseBytes(proposal)[0].nests?.[0].body as SerderKERI | undefined)?.sad?.ri
              : runtime.exc.retainedInput(selected, { pending: true })?.serder.sad?.ri;
            if (selectedRecipient !== recipient) {
              throw new ValidationError("Recipient differs from the selected pending Grant");
            }
          }
          writeJsonLine({ grant: selected, role, phase: "selected", registryIssued: false, admitted: false });
          if (selection) {
            const completed = yield* runGroupDerivedIssuance(runtime, wallet, {
              role,
              grant: selected,
              proposal,
              ...selection,
            }, { timeoutMs: timeout * 1000, auths, witnessGvrsn: parseGvrsn(args.witnessGvrsn ?? "1"), listen });
            const { proof, ...facts } = completed;
            if (proof && proofOutput) {
              yield* call(() => Deno.writeFile(proofOutput, proof, { createNew: true, mode: 0o600 }));
            }
            return { ...facts, ...(proof && proofOutput ? { proofOutput } : {}) };
          }
          return yield* runDerivedIssuance(runtime, wallet, { role, grant: selected }, {
            timeoutMs: timeout * 1000,
            auths,
            witnessGvrsn: parseGvrsn(args.witnessGvrsn ?? "1"),
          });
        });
      } finally {
        yield* runtime.close();
      }
    },
  );
  writeJsonLine(completed);
}

/** Explicit issuer action: fresh Grant and DH followed by a genuinely anchored issued BUP. */
export function* ipexIssueCommand(args: Record<string, unknown>): Operation<void> {
  if (!(parseBooleanOption(args.issue, "issue") ?? false)) throw new ValidationError("Fresh issuance requires --issue");
  yield* issuanceCommand(args, "issuer");
}

/** Explicit recipient DH approval; accepted issuance does not create a wallet admission. */
export function* ipexSetupCommand(args: Record<string, unknown>): Operation<void> {
  yield* issuanceCommand(args, "recipient");
}
