/**
 * Exact public Grant files for a group presentation: the runtime's half of the file hand-off.
 *
 * A group presenter freezes one selected public view as an exact Grant file, a member appends its signature to
 * the same file ({@link preparePresentationFile}), and the completed file is imported once the sender threshold
 * is met ({@link resumePresentationFile}); the elected lead then delivers it ({@link deliverPreparedGrant} in
 * `presenting.ts`). The file is only the transport between members: every check of what a file may change (the
 * exact body and nested evidence, the original deadline, the issuer authorization of every selected registry
 * node) is here, not in the command that reads and writes the file.
 */
import {
  bytesEqual,
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  framePayload,
  parseAttachmentGroup,
  parseBytes,
  type SerderACDC,
  SerderKERI,
  Vrsn_2_0,
} from "cesr-ts";
import { call, type Operation } from "npm:effection@^3.6.0";
import type { Regery } from "../../acdc/registraring.ts";
import { ValidationError } from "../../core/errors.ts";
import { messageAttachmentGroups } from "../../core/protocol-serialization.ts";
import { timestampMicros } from "../../time/mod.ts";
import type { ExchangeInput, Exchanger } from "../exchanges/exchanging.ts";
import type { Hab, Habery } from "../identity/habbing.ts";
import { isLocalGroupHab } from "../multisig/group-members.ts";
import { envelopeFromFrame } from "../protocol/parsering.ts";
import type { ProtocolProcessor } from "../protocol/protocol-processing.ts";
import type { Reactor } from "../protocol/reactor.ts";
import type { RuntimeClock } from "../runtime/runtime-clock.ts";
import type { Receiptor } from "../witness/receipting.ts";
import type { IpexV2BodyOptions } from "./ipex-building.ts";
import { type CredentialViews, type DisclosureSelection, exchangeWire, IpexDiscloser } from "./ipex-discloser.ts";

/** A partial group file is explicit; prepared means the sender threshold, not issuer consent, is complete. */
export interface PreparedPresentationFile {
  grant: string;
  wire: Uint8Array;
  prepared: boolean;
  deadline: string | null;
}

/** Grant body options of a prepared file. */
export interface PresentationFileOptions extends IpexV2BodyOptions {
  priorSaid?: string;
}

/** A completed prepared Grant imported from its file. */
export interface ResumedPresentationFile {
  grant: string;
  wire: Uint8Array;
  deadline: string;
  /** Proof support and the completed Grant, in delivery order. */
  delivery: Uint8Array;
}

/** Collaborators of the exact-file group presentation; no runtime bundle. */
export interface PresentationFileDeps {
  readonly hby: Habery;
  readonly rgy: Pick<Regery, "store">;
  readonly exc: Exchanger;
  readonly receiptor: Receiptor;
  readonly reactor: Pick<Reactor, "processBytes">;
  /** Only the sender-threshold KRAM owner is read, to refuse preparation when KRAM is off. */
  readonly protocol: Pick<ProtocolProcessor, "kvy">;
  readonly clock: RuntimeClock;
  /** Embedder inventory the selection reads. */
  readonly views: CredentialViews;
}

/** Borrow the actual local signer and enabled KRAM; KRAM policy owns the preparation lifetime. */
function discloserOf(deps: PresentationFileDeps, hab: Hab): IpexDiscloser {
  if (deps.hby.habs.get(hab.pre) !== hab || !deps.protocol.kvy.kramer) {
    throw new ValidationError("Prepared presentation requires its local habitat, registry and enabled KRAM");
  }
  return new IpexDiscloser(deps.hby, deps.rgy.store, deps.exc, deps.receiptor, undefined, deps.views);
}

/** Keep the original v2 IPEX clock; no file can recreate a missing or terminated preparation. */
function deadline(deps: PresentationFileDeps, said: string, expected?: string): string {
  const selected = deps.exc.retainedInput(said)?.serder;
  const date = selected && deps.exc.exchangeDeadline(selected);
  if (!date || deps.hby.db.erpy.get([said]) || expected !== undefined && date !== expected) {
    throw new ValidationError("Prepared Grant is unavailable, terminated or its original deadline changed");
  }
  const expiry = timestampMicros(date);
  if (expiry === null) throw new Error("Corrupt prepared presentation deadline");
  if (BigInt(deps.clock.now()) * 1000n >= expiry) {
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
/** Reconstruct the authenticated original before importing any completed file. */
function retained(deps: PresentationFileDeps, said: string): CesrFrame {
  const saved = deps.exc.retainedInput(said);
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
function requireScope(deps: PresentationFileDeps, frame: CesrFrame): void {
  const body = frame.body as SerderKERI, xid = body.ilk === "xip" ? body.said! : body.sad!.x as string;
  const context = deps.exc.presentationContext(body.said!, {
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
    throw new ValidationError("Exact Grant lacks complete issuer authorization for every selected registry node");
  }
}
/** Freeze one selected public view; a group member may append its signature to the same exact proposal file. */
export function* preparePresentationFile(
  deps: PresentationFileDeps,
  hab: Hab,
  selection: DisclosureSelection,
  options: PresentationFileOptions,
  proposal?: Uint8Array,
): Operation<PreparedPresentationFile> {
  const owner = discloserOf(deps, hab);
  if ((options.gvrsn ?? Vrsn_2_0).major !== 2) throw new ValidationError("Prepared presentation requires genus 2");
  if (selection.refresh || selection.derive || selection.openings?.length || options.anchor) {
    throw new ValidationError(
      "Exact preparation preserves the selected view; refresh and anchored presentation use their existing commands",
    );
  }
  if (proposal && !isLocalGroupHab(deps.hby, hab)) {
    throw new ValidationError("A sender contribution requires a local group member");
  }
  const original = proposal ? owner.inspectGrantFile(proposal).frame : undefined;
  const body = original?.body as SerderKERI | undefined;
  const previous = body && deps.exc.exchangeDeadline(body) ? deadline(deps, body.said!) : undefined;
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
  if (previous) deadline(deps, exn.said!, previous);
  const candidate = parseBytes(exchangeWire(hab, exn, prepared.nests))[0];
  if (original) candidate.attachments = [...original.attachments, ...candidate.attachments];
  const raw = yield* wire(candidate), checked = owner.inspectGrantFile(raw);
  if (previous) deadline(deps, exn.said!, previous);
  if (previous) {
    const decision = yield* deps.exc.acceptPreparedGrantContribution(input(candidate));
    if (decision.kind === "reject") throw new ValidationError(decision.reason);
  } else if (checked.completeSigners.includes(hab.pre)) {
    yield* deps.reactor.processBytes(raw, { local: true });
  } else {
    // Keep partial sender proof in ordinary escrow without granting accepted KRAM authority.
    const decision = yield* deps.exc.processEvent(input(candidate));
    if (decision.kind === "reject") throw new ValidationError(decision.reason);
  }
  // A partial group proposal has no accepted lifetime and grants no auxiliary authority.
  const frozen = deps.exc.exchangeDeadline(exn) ? deadline(deps, exn.said!, previous) : null;
  const saved = deps.hby.db.exns.get([exn.said!]) ?? deps.hby.db.epse.get([exn.said!]);
  if (!saved || !bytesEqual(saved.raw, exn.raw)) {
    throw new ValidationError("v2 IPEX preparation did not retain the exact Grant");
  }
  return { grant: exn.said!, wire: raw, prepared: checked.completeSigners.includes(hab.pre), deadline: frozen };
}
/** Import only additions to an existing sender-authenticated preparation; missing issuer consent cannot be recreated. */
export function* resumePresentationFile(
  deps: PresentationFileDeps,
  hab: Hab,
  said: string,
  raw: Uint8Array,
): Operation<ResumedPresentationFile> {
  const owner = discloserOf(deps, hab), frozen = deadline(deps, said), original = retained(deps, said);
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
  deadline(deps, said, frozen);
  const decision = yield* deps.exc.acceptPreparedGrantContribution(input(candidate.frame));
  if (decision.kind === "reject") throw new ValidationError(decision.reason);
  deadline(deps, said, frozen);
  requireScope(deps, candidate.frame);
  const nodes = concatBytes(
    Counter.makeGVC(Vrsn_2_0),
    ...yield* call(() => Promise.all(candidate.frame.nests!.map((node) => collectPayload(framePayload(node))))),
  );
  return {
    grant: said,
    wire: raw.slice(),
    deadline: frozen,
    delivery: concatBytes(owner.proofSupport(nodes, hab), raw),
  };
}
