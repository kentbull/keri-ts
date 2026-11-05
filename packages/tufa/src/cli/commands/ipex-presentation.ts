/** Exact public Grant files separate local view selection, sender signatures and independent issuer consent. */
import { type DisclosureSelection, exchangeWire, type Wallet, WalletDiscloser } from "@keri-ts/wallet";
import {
  bytesEqual,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  parseAttachmentGroup,
  parseBytes,
  SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { action, call, type Operation, race, scoped, spawn } from "effection";
import { parseBooleanOption, parseStringOption } from "keri-ts/cli";
import {
  type AgentRuntime,
  envelopeFromFrame,
  type ExchangeInput,
  type Hab,
  type IpexV2BodyOptions,
  isLocalGroupHab,
  localGroupMember,
  messageAttachmentGroups,
  Organizer,
  Receiptor,
  runAgentRuntime,
  timestampMicros,
  ValidationError,
} from "keri-ts/runtime";
import { withHabAndAgentRuntime } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";
import { openWallet, walletStoreArgs } from "../support/wallet.ts";

/** A partial group file is explicit; prepared means the sender threshold, not issuer consent, is complete. */
export interface PreparedPresentationFile {
  grant: string;
  wire: Uint8Array;
  prepared: boolean;
  deadline: string | null;
}
/** Borrow the actual wallet and accepted local signer; KRAM policy owns the preparation lifetime. */
function discloser(runtime: AgentRuntime, wallet: Wallet, hab: Hab): WalletDiscloser {
  if (
    wallet.hby !== runtime.hby || wallet.exc !== runtime.exc || wallet.registry !== runtime.acdc?.store
    || runtime.hby.habs.get(hab.pre) !== hab || !runtime.protocol.kvy.kramer
  ) {
    throw new ValidationError("Prepared presentation requires its local habitat, wallet, registry and enabled KRAM");
  }
  return new WalletDiscloser(wallet, new Receiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock));
}
/** Keep the original v2 IPEX clock; no file can recreate a missing or terminated preparation. */
function deadline(runtime: AgentRuntime, said: string, expected?: string): string {
  const selected = runtime.exc.retainedInput(said)?.serder;
  const date = selected && runtime.exc.exchangeDeadline(selected);
  if (!date || runtime.hby.db.erpy.get([said]) || expected !== undefined && date !== expected) {
    throw new ValidationError("Prepared Grant is unavailable, terminated or its original deadline changed");
  }
  const expiry = timestampMicros(date);
  if (expiry === null) throw new Error("Corrupt prepared presentation deadline");
  if (BigInt(runtime.clock.now()) * 1000n >= expiry) {
    throw new ValidationError("Original prepared presentation deadline expired");
  }
  return date;
}
/** Serialize exact existing frames; signatures never authorize a change to nested public evidence. */
function* wire(frame: CesrFrame): Operation<Uint8Array> {
  return yield* call(() => collectPayload(framePayload(frame)));
}
/** Compare complete nested bytes, including every original proof family and order. */
function* sameNodes(left: CesrFrame, right: CesrFrame): Operation<boolean> {
  if (left.nests?.length !== right.nests?.length) return false;
  for (let i = 0; i < (left.nests?.length ?? 0); i++) {
    if (!bytesEqual(yield* wire(left.nests![i]), yield* wire(right.nests![i]))) return false;
  }
  return true;
}
/** Project individual factors rather than grouping serialization, allowing only authentication additions. */
function factors(frame: CesrFrame): Set<string> {
  const proof = envelopeFromFrame(frame);
  return new Set([
    ...proof.tsgs.flatMap(group =>
      group.sigers.map(sig => JSON.stringify(["tsg", group.pre, group.sn.toString(), group.said, sig.qb64]))
    ),
    ...proof.cigars.map(cigar => JSON.stringify(["cigar", cigar.verfer?.qb64, cigar.qb64])),
    ...proof.ssts.map(seal => JSON.stringify(["seal", seal.i.qb64, seal.s.num.toString(), seal.d.qb64])),
  ]);
}
/** Feed exact signed factors through the ordinary exchange owner; nested authority remains independent. */
function input(frame: CesrFrame): ExchangeInput {
  const proof = envelopeFromFrame(frame);
  return {
    serder: frame.body as SerderKERI,
    tsgs: proof.tsgs,
    cigars: proof.cigars,
    sourceSeals: proof.ssts,
    nests: frame.nests,
    gvrsn: Vrsn_2_0,
  };
}
/** Reconstruct the authenticated original before importing any endorsed file. */
function retained(runtime: AgentRuntime, said: string): CesrFrame {
  const saved = runtime.exc.retainedInput(said);
  if (!saved) throw new ValidationError("Resume requires the original locally prepared sender threshold");
  const frame: CesrFrame = {
    body: saved.serder,
    attachments: messageAttachmentGroups(
      { tsgs: saved.tsgs, cigars: saved.cigars, sourceSeals: saved.sourceSeals },
      Vrsn_2_0,
    ).map(group => parseAttachmentGroup(group.raw, Vrsn_2_0, "txt").group),
    gvrsn: Vrsn_2_0,
    nests: [...saved.nests ?? []],
  };
  return frame;
}
/** Require issuer authority for every selected registry node, including retryably unknown current openings. */
function requireScope(runtime: AgentRuntime, frame: CesrFrame): void {
  const body = frame.body as SerderKERI, xid = body.ilk === "xip" ? body.said! : body.sad!.x as string;
  const context = runtime.exc.presentationContext(body.said!, {
    xid,
    sender: body.pre!,
    recipient: body.sad!.ri as string,
  });
  const expected = new Map<string, Set<string>>();
  for (const node of frame.nests ?? []) {
    const credential = node.body as SerderACDC;
    if (credential.regid) {
      const nodes = expected.get(credential.regid) ?? new Set();
      nodes.add(credential.said!);
      expected.set(credential.regid, nodes);
    }
  }
  if (
    !expected.size || !context || context.registries.size !== expected.size
    || [...expected].some(([regid, nodes]) =>
      context.registries.get(regid)?.length !== nodes.size
      || context.registries.get(regid)!.some(said => !nodes.has(said))
    )
  ) {
    throw new ValidationError("Exact Grant lacks complete issuer endorsement for every selected registry node");
  }
}
/** Freeze one selected public view; a group member may append its signature to the same exact proposal file. */
export function* preparePresentationGrant(
  runtime: AgentRuntime,
  wallet: Wallet,
  hab: Hab,
  selection: DisclosureSelection,
  options: IpexV2BodyOptions & { priorSaid?: string },
  proposal?: Uint8Array,
): Operation<PreparedPresentationFile> {
  const owner = discloser(runtime, wallet, hab);
  if ((options.gvrsn ?? Vrsn_2_0).major !== 2) throw new ValidationError("Prepared presentation requires genus 2");
  if (selection.refresh || selection.derive || selection.openings?.length || options.anchor) {
    throw new ValidationError(
      "Exact preparation preserves the selected view; refresh and anchored presentation use their existing commands",
    );
  }
  if (proposal && !isLocalGroupHab(runtime.hby, hab)) {
    throw new ValidationError("A sender contribution requires a local group member");
  }
  const original = proposal ? owner.inspectGrantFile(proposal).frame : undefined;
  const body = original?.body as SerderKERI | undefined;
  const previous = body && runtime.exc.exchangeDeadline(body) ? deadline(runtime, body.said!) : undefined;
  const prepared = yield* owner.prepareGrantFileBody(hab.pre, selection, {
    ...options,
    ...(body ? { date: body.stamp!, kind: body.kind } : {}),
  });
  const exn = body?.ilk === "xip"
    ? new SerderKERI({ sad: { ...prepared.exn.sad!, u: body.sad!.u }, kind: body.kind, makify: true })
    : prepared.exn;
  const unsigned = parseBytes(
    concatBytes(Counter.makeGVC(Vrsn_2_0), exn.raw, Counter.enclose({ qb64: prepared.nests, version: Vrsn_2_0 })),
  )[0];
  if (original && (!bytesEqual(exn.raw, original.body.raw) || !(yield* sameNodes(unsigned, original)))) {
    throw new ValidationError("Group contribution differs from the selected view, exact Grant or parties");
  }
  if (previous) deadline(runtime, exn.said!, previous);
  const candidate = parseBytes(exchangeWire(hab, exn, prepared.nests))[0];
  if (original) candidate.attachments = [...original.attachments, ...candidate.attachments];
  const raw = yield* wire(candidate), checked = owner.inspectGrantFile(raw);
  if (previous) deadline(runtime, exn.said!, previous);
  if (previous) {
    const decision = yield* runtime.exc.acceptPreparedGrantContribution(input(candidate));
    if (decision.kind === "reject") throw new ValidationError(decision.reason);
  } else if (checked.completeSigners.includes(hab.pre)) {
    yield* runtime.reactor.processBytes(raw, { local: true });
  } else {
    // Keep partial sender proof in ordinary escrow without granting accepted KRAM authority.
    const decision = yield* runtime.exc.processEvent(input(candidate));
    if (decision.kind === "reject") throw new ValidationError(decision.reason);
  }
  // A partial group proposal has no accepted lifetime and grants no auxiliary authority.
  const frozen = runtime.exc.exchangeDeadline(exn) ? deadline(runtime, exn.said!, previous) : null;
  const saved = runtime.hby.db.exns.get([exn.said!]) ?? runtime.hby.db.epse.get([exn.said!]);
  if (!saved || !bytesEqual(saved.raw, exn.raw)) {
    throw new ValidationError("v2 IPEX preparation did not retain the exact Grant");
  }
  return { grant: exn.said!, wire: raw, prepared: checked.completeSigners.includes(hab.pre), deadline: frozen };
}
/** Import only additions to an existing sender-authenticated preparation; missing issuer consent cannot be recreated. */
export function* resumePresentationGrant(
  runtime: AgentRuntime,
  wallet: Wallet,
  hab: Hab,
  said: string,
  raw: Uint8Array,
): Operation<{ grant: string; wire: Uint8Array; deadline: string }> {
  const owner = discloser(runtime, wallet, hab), frozen = deadline(runtime, said), original = retained(runtime, said);
  if ((original.body as SerderKERI).pre !== hab.pre) {
    throw new ValidationError("Resume selects the original local discloser");
  }
  const candidate = owner.inspectGrantFile(raw, {
    said,
    sender: hab.pre,
    recipient: (original.body as SerderKERI).sad!.ri as string,
  });
  if (
    candidate.partialSigners.length || !candidate.completeSigners.includes(hab.pre)
    || !bytesEqual(candidate.frame.body.raw, original.body.raw) || !(yield* sameNodes(candidate.frame, original))
  ) {
    throw new ValidationError(
      "Resume requires complete authentication on the exact original Grant and nested evidence",
    );
  }
  const added = factors(candidate.frame);
  if ([...factors(original)].some(factor => !added.has(factor))) {
    throw new ValidationError("Resume cannot remove original authentication");
  }
  deadline(runtime, said, frozen);
  const decision = yield* runtime.exc.acceptPreparedGrantContribution(input(candidate.frame));
  if (decision.kind === "reject") throw new ValidationError(decision.reason);
  deadline(runtime, said, frozen);
  requireScope(runtime, candidate.frame);
  return { grant: said, wire: raw.slice(), deadline: frozen };
}

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
      const wallet = yield* openWallet(hby, runtime.acdc!.store, runtime.exc), owner = discloser(runtime, wallet, hab);
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
        const prepared = yield* preparePresentationGrant(runtime, wallet, hab, {
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
      if (!filename) throw new ValidationError("Resume requires the exact independently endorsed --input file");
      const original = retained(runtime, resume!);
      if ((original.body as SerderKERI).sad!.ri !== recipient) {
        throw new ValidationError("Recipient differs from the original prepared Grant");
      }
      const resumed = yield* resumePresentationGrant(
        runtime,
        wallet,
        hab,
        resume!,
        yield* call(() => Deno.readFile(filename)),
      );
      const checked = owner.inspectGrantFile(resumed.wire);
      const nodes = concatBytes(
        Counter.makeGVC(Vrsn_2_0),
        ...yield* call(() => Promise.all(checked.frame.nests!.map(node => collectPayload(framePayload(node))))),
      );
      const delivery = concatBytes(owner.proofSupport(nodes, hab), resumed.wire);
      let transmitted = false;
      if (out) yield* call(() => Deno.writeFile(out, delivery, { createNew: true, mode: 0o600 }));
      else if (runtime.exc.lead(hab, resume!, { pendingPresentation: true })) {
        const member = isLocalGroupHab(hby, hab) ? localGroupMember(hby, hab.pre) : hab;
        const host = yield* spawn(() => runAgentRuntime(runtime, { hab: member, pollMailbox: false }));
        try {
          deadline(runtime, resume!, resumed.deadline);
          yield* race([
            call(function*() {
              const event = runtime.postman.send({
                src: member.pre,
                dest: recipient,
                topic: "credential",
                msg: delivery,
              }, {
                notify: true,
              });
              const sent = yield* runtime.postman.wait(event);
              if (sent.kin === "failed") throw sent.error;
              transmitted = true;
              deadline(runtime, resume!, resumed.deadline);
            }),
            call(function*(): Operation<never> {
              const remaining = Number(timestampMicros(resumed.deadline)! - BigInt(runtime.clock.now()) * 1000n) / 1000;
              yield* action<void>(resolve => {
                const timer = runtime.clock.setTimeout(resolve, Math.max(0, remaining));
                return () => runtime.clock.clearTimeout(timer);
              });
              throw new ValidationError("Original prepared presentation deadline expired during delivery");
            }),
          ]);
        } finally {
          yield* host.halt();
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
/** Independently endorse the exact discloser/verifier pair and preserve every supplied proof in a new file. */
export function* ipexEndorseCommand(args: Record<string, unknown>): Operation<void> {
  const file = parseStringOption(args.grant, "grant"),
    said = parseStringOption(args.said, "said"),
    out = parseStringOption(args.out, "out");
  const sender = parseStringOption(args.sender, "sender"), recipient = parseStringOption(args.recipient, "recipient");
  if (!file || !said || !out || !sender || !recipient) {
    throw new ValidationError("Endorse requires --grant, --said, --sender, --recipient and --out");
  }
  const completed = yield* withHabAndAgentRuntime(walletStoreArgs(args), parseStringOption(args.alias, "alias"), {
    skipConfig: false,
  }, function*({ hby, hab, runtime }) {
    return yield* scoped(function*() {
      const wallet = yield* openWallet(hby, runtime.acdc!.store, runtime.exc), owner = discloser(runtime, wallet, hab);
      const support = parseStringOption(args.input, "input");
      if (support) {
        yield* runtime.reactor.processBytes(yield* call(() => Deno.readFile(support)));
        yield* runtime.protocol.processEscrowsOnce();
      }
      const contributions = Array.isArray(args.contribution) ? args.contribution : [];
      if (contributions.some(path => typeof path !== "string")) {
        throw new ValidationError("Contributions must be exact Grant file paths");
      }
      const organizer = new Organizer(hby.db, hby.signator);
      const endorsed = yield* owner.endorseGrant(hab.pre, yield* call(() => Deno.readFile(file)), {
        said,
        sender: organizer.resolveRecipient(sender),
        recipient: organizer.resolveRecipient(recipient),
        contributions: yield* call(() => Promise.all(contributions.map(path => Deno.readFile(path)))),
      });
      yield* call(() => Deno.writeFile(out, endorsed.wire, { createNew: true, mode: 0o600 }));
      return { grant: said, issuer: hab.pre, endorsed: endorsed.endorsed, output: out, transmitted: false };
    });
  });
  writeJsonLine(completed);
}
