/** Finite individual issuance over the selected runtime's DH owner; wallet owns issuance and Admit stays separate. */
import { type IssuanceGrantOptions, RegistryCustody, type Wallet } from "@keri-ts/wallet";
import { bytesEqual, parseBytes, SerderACDC, SerderKERI, type Versionage } from "cesr-ts";
import { action, call, type Operation, scoped, spawn } from "effection";
import {
  parseBooleanOption,
  parseGvrsn,
  parseIntegerOption,
  parseNumberOption,
  parseStringOption,
  type RootCopyLine,
  withRuntimeWorkers,
} from "keri-ts/cli";
import {
  abandonIssuance,
  type AgentRuntime,
  approveIssuanceExchange,
  beginIssuance,
  createAgentRuntime,
  type Hab,
  isLocalGroupHab,
  IssuanceOperations,
  type IssuanceStatus,
  type KramConfig,
  localGroupMember,
  MemoryIssuanceOperationStore,
  Organizer,
  posterDelivery,
  prepareIssuanceGrant,
  Receiptor,
  runAgentRuntime,
  type RuntimeClock,
  systemClock,
  ValidationError,
  waitForIssuance,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import { NodeHttpClient } from "keri-ts/runtime/node";
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

/** Compose the library issuance owner over this CLI runtime; the CLI is its only embedder. */
function issuanceOperations(
  runtime: AgentRuntime,
  wallet: Wallet,
  hab: Hab,
  receiptor: Receiptor,
): IssuanceOperations {
  const custody = new RegistryCustody({ hby: runtime.hby, hab, registry: wallet.registry, db: wallet.db });
  return new IssuanceOperations({
    hby: runtime.hby,
    rgy: runtime.acdc!,
    exc: runtime.exc,
    receiptor,
    dhkes: runtime.ipex!,
    reactor: runtime.reactor,
    protocol: runtime.protocol,
    delivery: posterDelivery(runtime.postman),
    store: new MemoryIssuanceOperationStore(),
    derived: custody.options.store,
    clock: runtime.clock,
  });
}

/** Prepare and locally authenticate a fresh pending Grant without generating a root or issuing a BUP. */
export function* prepareDerivedIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  credential: SerderACDC,
  options: IssuanceGrantOptions,
): Operation<{ grant: string; wire: Uint8Array }> {
  const { hab } = owners(runtime, wallet);
  const receiptor = new Receiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock);
  return yield* prepareIssuanceGrant(issuanceOperations(runtime, wallet, hab, receiptor), {
    hab,
    credential,
    options,
  });
}

/** The fixed text the CLI always printed when its elapsed limit or the Grant deadline ended the wait. */
const ELAPSED = "Derived issuance reached its elapsed limit or original Grant deadline; no Admit was created";

/**
 * One explicitly selected issuance, either side: begin or consent in the library owner, drive `processOnce`
 * under the host workers, and wait observe-only to the elapsed limit. The holder stops where it needs its
 * Admit consent. The wallet inventory is this embedder's reaction to completion; the library never writes it.
 */
function* runIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  request: DerivedIssuanceRequest,
  { timeoutMs, witnessGvrsn, auths }: { timeoutMs: number; witnessGvrsn?: Versionage; auths?: WitnessAuthMap },
): Operation<DerivedIssuanceResult> {
  const { hab } = owners(runtime, wallet);
  const receiptor = new Receiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock, { gvrsn: witnessGvrsn });
  const ops = issuanceOperations(runtime, wallet, hab, receiptor);
  const issuer = request.role === "issuer";
  const { grant, xid } = issuer
    ? yield* beginIssuance(ops, { hab, grant: request.grant, auths })
    : approveIssuanceExchange(ops, { hab, grant: request.grant });
  const credential = runtime.exc.retainedInput(grant, { pending: true })!.nests![0].body as SerderACDC;
  const outcome = yield* withRuntimeWorkers(runtime, { hab, pollMailbox: true }, function*() {
    const driver = yield* spawn(function*() {
      while (true) {
        yield* ops.processOnce();
        yield* wait(runtime.clock, 50);
      }
    });
    try {
      const until = (status: IssuanceStatus) => status.state !== "active" || status.needs === "admit";
      return yield* waitForIssuance(ops, grant, { timeoutMs, until });
    } finally {
      yield* driver.halt();
    }
  });
  const { status } = outcome;
  const registry = credential.regid!;
  if (status.state === "done" || (status.state === "active" && status.needs === "admit")) {
    if (issuer) {
      const head = wallet.registry.headEvent(registry)!;
      const custody = new RegistryCustody({ hby: runtime.hby, hab, registry: wallet.registry, db: wallet.db });
      wallet.recordIssued(credential, head.said!, { blinder: custody.derivedOpening(head) });
    }
    return { grant, xid, registry, registryIssued: true, admitted: false };
  }
  if (status.state === "active") abandonIssuance(ops, grant, ELAPSED);
  throw new ValidationError(status.state === "active" || status.state === "expired" ? ELAPSED : status.reason);
}

/**
 * Run one explicitly selected individual issuance under an elapsed timeout and the original Grant deadline.
 * Borrowed runtime and wallet lifetimes belong to the caller. This never prepares or records Admit.
 */
export function* runDerivedIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  request: DerivedIssuanceRequest,
  options: { timeoutMs: number; witnessGvrsn?: Versionage; auths?: WitnessAuthMap },
): Operation<DerivedIssuanceResult> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new ValidationError("Issuance timeout must be finite and positive");
  }
  return yield* runIssuance(runtime, wallet, request, options);
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
  // Root copies follow the issuance result they cannot change, one `root_copy` line each.
  const { rootCopies = [], ...result } = completed as typeof completed & { rootCopies?: RootCopyLine[] };
  writeJsonLine(result);
  for (const report of rootCopies) writeJsonLine(report);
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
