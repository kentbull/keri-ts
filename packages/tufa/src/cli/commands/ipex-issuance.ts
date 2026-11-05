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
  type Versionage,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, race, scoped, spawn } from "effection";
import { parseBooleanOption, parseGvrsn, parseNumberOption, parseStringOption } from "keri-ts/cli";
import {
  type AgentRuntime,
  CesrHttpRefusal,
  createAgentRuntime,
  CREDENTIAL_MAILBOX_TOPIC,
  FetchHttpClient,
  isLocalGroupHab,
  type KramConfig,
  messagize,
  Organizer,
  Receiptor,
  runAgentRuntime,
  type RuntimeClock,
  systemClock,
  timestampMicros,
  ValidationError,
} from "keri-ts/runtime";
import { withExistingHab } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";

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
  { timeoutMs, witnessGvrsn }: { timeoutMs: number; witnessGvrsn?: Versionage },
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
  const deadline = runtime.hby.db.epsd.get([request.grant]);
  const expires = deadline ? timestampMicros(deadline.dts) : null;
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
                try {
                  yield* send(query, peer);
                } catch (error) {
                  // Explicit recipient consent may follow the first query. Only that HTTP refusal
                  // keeps this bounded wait alive; no refusal establishes protocol acceptance.
                  if (!(error instanceof CesrHttpRefusal) || error.status !== 403) throw error;
                }
                nextQuery = runtime.clock.now() + 1000;
              }
              yield* wait(runtime.clock, 50);
            }
            if (request.role === "issuer") {
              const custody = new RegistryCustody({ hby: runtime.hby, hab, registry: wallet.registry, db: wallet.db });
              yield* new WalletAuthor(wallet, rgy, receiptor, custody).issue(reg!, credential);
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
      if (isLocalGroupHab(hby, hab)) {
        throw new ValidationError(
          "Derived issuance currently requires an individual habitat",
        );
      }
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
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
            const prepared = yield* prepareDerivedIssuance(runtime, wallet, credential, {
              recipient: new Organizer(hby.db, hby.signator).resolveRecipient(recipient),
              message: parseStringOption(args.message, "message") ?? "",
              priorSaid: parseStringOption(args.prior ?? args.agree, "prior"),
              plan: planText
                ? JSON.parse(planText.startsWith("@") ? Deno.readTextFileSync(planText.slice(1)) : planText)
                : undefined,
              artifacts: yield* call(() => Promise.all(artifacts.map(path => Deno.readFile(path)))),
            });
            selected = prepared.grant;
            const out = parseStringOption(args.out, "out");
            if (out) {
              yield* call(() => Deno.writeFile(out, prepared.wire, { createNew: true, mode: 0o600 }));
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
          if (role === "issuer" && args.recipient) {
            const recipient = new Organizer(hby.db, hby.signator).resolveRecipient(
              parseStringOption(args.recipient, "recipient")!,
            );
            if (runtime.exc.retainedInput(selected, { pending: true })?.serder.sad?.ri !== recipient) {
              throw new ValidationError("Recipient differs from the selected pending Grant");
            }
          }
          writeJsonLine({ grant: selected, role, phase: "selected", registryIssued: false, admitted: false });
          return yield* runDerivedIssuance(runtime, wallet, { role, grant: selected }, {
            timeoutMs: timeout * 1000,
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
