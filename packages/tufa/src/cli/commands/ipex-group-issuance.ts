/** Finite group issuance phases; ordinary signatures and existing DH/registry owners retain authority. */
import { startServer } from "@keri-ts/hosting";
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
  type CesrFrame,
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
import {
  acceptedRegistryEvidence,
  type AgentRuntime,
  consoleLogger,
  Dhke,
  envelopeFromFrame,
  type ExchangeRouteHandler,
  groupSigningMembers,
  groupWitnesserSelection,
  Kever,
  latestGroupContribution,
  localGroupMember,
  messagize,
  multisigExnBody,
  Receiptor,
  runAgentRuntime,
  timestampMicros,
  ValidationError,
  vet,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import { approveAcdcV2RegistryEvent } from "./acdc-v2-authoring.ts";

const QueryRoute = "/multisig/qry", ProofRoute = "/multisig/ipex-proof";
/** Exact accepted coordinator and already elected custody member selected by this invocation. */
export interface GroupIssuanceSelection {
  coordinator: string;
  custodian: string;
}
/** Explicit party/Grant selection; issuer members also select the frozen authenticated proposal. */
export interface GroupIssuanceRequest extends GroupIssuanceSelection {
  role: "issuer" | "recipient";
  grant: string;
  proposal?: Uint8Array;
}
/** Contribution completion is distinct from verified issuance; neither result implies Admit. */
export interface GroupIssuanceResult {
  grant: string;
  xid: string;
  registry: string;
  contributed: true;
  registryIssued: boolean;
  admitted: false;
  /**
   * Exact public proof for the issuer members who left before the separate BUP join.
   * The custodian also sends it to them by mailbox on `multisig`; this copy is the file fallback.
   */
  proof?: Uint8Array;
}

/** Resolve exact local owners and the already accepted coordinator; election is never recomputed from a new event. */
function owners(runtime: AgentRuntime, wallet: Wallet, selection: GroupIssuanceSelection) {
  const selected = runtime.ipexAuxiliary;
  if (
    selected?.kind !== "dhke" || !selected.owner.group || !runtime.acdc || wallet.hby !== runtime.hby
    || wallet.registry !== runtime.acdc.store || wallet.exc !== runtime.exc
  ) throw new ValidationError("Group issuance requires its selected DH runtime and wallet");
  const dh = selected.owner, hab = dh.hab, member = localGroupMember(runtime.hby, hab.pre);
  const event = hab.db.getEvtSerder(hab.pre, selection.coordinator);
  const coordinator = event ? { sn: event.sn!, said: event.said! } : null;
  const elected = coordinator && groupWitnesserSelection(hab.db, hab.pre, coordinator);
  const contribution = elected && latestGroupContribution(hab.db, selection.custodian, elected.establishment.verfers);
  if (
    !elected || !coordinator || contribution?.index !== elected.index
    || !groupSigningMembers(runtime.hby, hab.pre).includes(selection.custodian)
    || !latestGroupContribution(hab.db, member.pre, hab.kever!.verfers)
  ) {
    throw new ValidationError(
      "Select the accepted coordinator's current elected custodian and a current signing member",
    );
  }
  return { dh, hab, member, coordinator, lead: member.pre === selection.custodian, rgy: runtime.acdc };
}
function* wire(frame: CesrFrame): Operation<Uint8Array> {
  return yield* call(() => collectPayload(framePayload(frame)));
}
function* nodeStream(nodes: readonly CesrFrame[]): Operation<Uint8Array> {
  return concatBytes(
    Counter.makeGVC(Vrsn_2_0),
    ...yield* call(() => Promise.all(nodes.map(node => collectPayload(framePayload(node))))),
  );
}
function* wait(runtime: AgentRuntime, milliseconds: number): Operation<void> {
  yield* action<void>(resolve => {
    const timer = runtime.clock.setTimeout(resolve, milliseconds);
    return () => runtime.clock.clearTimeout(timer);
  });
}
/** Parent authentication commits one exact child; it never supplies the child's group threshold. */
function* wrapper(
  runtime: AgentRuntime,
  child: CesrFrame,
  route: typeof QueryRoute | typeof ProofRoute | "/multisig/exn" | "/multisig/rpy",
): Operation<Uint8Array> {
  const hab = runtime.ipexAuxiliary!.owner.hab, member = localGroupMember(runtime.hby, hab.pre);
  // Core builder checks: qry authored by the group; ipex-proof a Grant for the group.
  const body = multisigExnBody(member.pre, { route, attrs: { gid: hab.pre } }, child.body as SerderKERI, {
    version: Vrsn_2_0,
  });
  const frame = parseBytes(member.endorse(body, { gvrsn: Vrsn_2_0 }))[0];
  frame.nests = [child];
  return yield* wire(frame);
}
/** Local consent starts the original Exchanger deadline even while the group signature remains partial. */
function* retainLocalGrant(runtime: AgentRuntime, child: CesrFrame): Operation<void> {
  const proof = envelopeFromFrame(child);
  yield* runtime.exc.processEvent({
    serder: child.body as SerderKERI,
    tsgs: proof.tsgs,
    lsgs: proof.ssgs,
    cigars: proof.cigars,
    nests: child.nests,
    gvrsn: Vrsn_2_0,
  });
}
/** Prepare only the elected issuer's first partial Grant, preserving the wallet's fresh-origin and far-node checks. */
export function* prepareGroupDerivedIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  credential: SerderACDC,
  options: IssuanceGrantOptions,
  selection: GroupIssuanceSelection,
): Operation<{ grant: string; proposal: Uint8Array }> {
  const { hab, lead, rgy } = owners(runtime, wallet, selection);
  if (!lead || !credential.regid || rgy.regs.get(credential.regid)?.hab !== hab) {
    throw new ValidationError("Only the elected issuer custodian prepares its managed fresh issuance");
  }
  const discloser = new WalletDiscloser(
    wallet,
    new Receiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock),
  );
  const prepared = yield* discloser.prepareIssuanceGrantBody(hab.pre, credential, options);
  const child = parseBytes(exchangeWire(hab, prepared.exn, prepared.nests))[0];
  const proposal = yield* wrapper(runtime, child, "/multisig/exn");
  yield* retainLocalGrant(runtime, child);
  yield* runtime.reactor.processBytes(concatBytes(discloser.proofSupport(prepared.raw, hab), proposal), {
    local: true,
  });
  return { grant: prepared.exn.said!, proposal };
}

/** Verify a custodian's exact final proof against original issuer factors; rootless members neither derive nor call DH finish. */
export function* acceptGroupIssuanceProof(
  runtime: AgentRuntime,
  wallet: Wallet,
  grant: string,
  selection: GroupIssuanceSelection,
  proposal: Uint8Array,
): Operation<boolean> {
  const { hab } = owners(runtime, wallet, selection), { custodian } = selection;
  const packet = parseBytes(proposal);
  const parent = packet.at(-1)!, child = parent?.nests?.[0];
  if (
    !parent || !(parent.body instanceof SerderKERI) || parent.body.route !== ProofRoute
    || parent.body.pre !== custodian
    || !groupSigningMembers(runtime.hby, hab.pre).includes(custodian)
    || JSON.stringify(parent.body.sad!.a) !== JSON.stringify({ gid: hab.pre, grant })
    || parent.nests?.length !== 1 || !child
  ) throw new ValidationError("Proof wrapper is outside the selected group issuance");
  {
    // The core /multisig/ipex-proof route authenticates the wrapper and indexes it without replay.
    yield* runtime.reactor.processBytes(proposal);
    if (!runtime.exc.verifyAccepted(parent.body.said!, ProofRoute)) {
      throw new ValidationError("Group proof wrapper is not authenticated");
    }
    const input = runtime.exc.retainedInput(grant, { pending: true });
    if (!input || !bytesEqual(child.body.raw, input.serder.raw) || child.nests?.length !== input.nests?.length) {
      throw new ValidationError("Group proof changed the original live Grant");
    }
    const original =
      parseBytes(messagize(input.serder, { tsgs: input.tsgs, cigars: input.cigars, gvrsn: Vrsn_2_0 }))[0];
    if (!bytesEqual(yield* wire({ ...child, nests: [] }), yield* wire(original))) {
      throw new ValidationError("Group proof changed original issuer authentication");
    }
    for (const [index, old] of (input.nests ?? []).entries()) {
      const next = child.nests![index], fresh = index === 0;
      if (
        !bytesEqual(next.body.raw, old.body.raw) || next.nests?.length
        || next.attachments.length !== old.attachments.length + (fresh ? 1 : 0)
        || old.attachments.some((atc, i) => !bytesEqual(atc.raw, next.attachments[i].raw))
      ) throw new ValidationError("Group proof changed retained disclosure or attachments");
      if (!fresh) continue;
      const node = next.body as SerderACDC,
        added = envelopeFromFrame({ ...next, attachments: [next.attachments.at(-1)!] });
      const opening = added.bsqs[0], chain = node.regid && acceptedRegistryEvidence(wallet.registry, node.regid);
      if (
        added.attachmentGroups.length !== 1
        || added.attachmentGroups[0].name.replace(/^Big/, "") !== "BlindedStateQuadruples"
        || added.bsqs.length !== 1 || added.bsss.length || !opening || opening.ts.label !== "issued"
        || opening.td.nonce !== node.said
        || !chain || !chain.updates.length || chain.updates.at(-1)!.sad!.b !== opening.d.nonce
      ) return false;
      const result = vet({ ...chain, db: runtime.hby.db, acdc: node, blinder: opening });
      if (result.kind !== "verified" || result.state.state !== "issued") {
        throw new ValidationError("Final proof does not verify the current issued BUP");
      }
    }
    yield* runtime.exc.acceptPendingGrantProof({ ...input, nests: child.nests });
    return runtime.exc.complete(grant);
  }
}

/**
 * Wait for the custodian's mailbox-delivered `/multisig/ipex-proof` and verify it.
 * The caller hosts mailbox intake; the core route authenticates and indexes the
 * wrapper. A proof is retried until this member's separate BUP join is accepted.
 */
export function* awaitGroupIssuanceProof(
  runtime: AgentRuntime,
  wallet: Wallet,
  grant: string,
  selection: GroupIssuanceSelection,
  timeoutMs: number,
): Operation<boolean> {
  const { hab } = owners(runtime, wallet, selection);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ValidationError("Proof timeout must be positive");
  return yield* race([
    call(function*() {
      while (true) {
        for (const [, parent] of runtime.hby.db.exns.getTopItemIter()) {
          const attrs = parent.sad?.a as Record<string, unknown> | undefined;
          if (
            parent.route !== ProofRoute || parent.pre !== selection.custodian || attrs?.gid !== hab.pre
            || attrs?.grant !== grant
          ) continue;
          const proof = yield* wrapperBytes(runtime, parent.said!);
          if (yield* acceptGroupIssuanceProof(runtime, wallet, grant, selection, proof)) return true;
        }
        yield* wait(runtime, 50);
      }
    }),
    call(function*(): Operation<never> {
      yield* wait(runtime, timeoutMs);
      throw new ValidationError("Final group proof did not arrive and verify before the timeout");
    }),
  ]);
}

/** Finite group phase options; the optional listener borrows this runtime and local member. */
export interface GroupIssuanceOptions {
  timeoutMs: number;
  witnessGvrsn?: Versionage;
  auths?: WitnessAuthMap;
  listen?: number;
}

/** Own an optional direct listener before releasing the selected group's setup consent. */
export function* runGroupDerivedIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  request: GroupIssuanceRequest,
  options: GroupIssuanceOptions,
): Operation<GroupIssuanceResult> {
  if (options.listen === undefined) return yield* runGroupIssuance(runtime, wallet, request, options);
  if (!Number.isInteger(options.listen) || options.listen < 1 || options.listen > 65535) {
    throw new ValidationError("--listen must be a port between 1 and 65535");
  }
  const { hab, member } = owners(runtime, wallet, request);
  return yield* scoped(function*() {
    let ready!: () => void;
    const bound = new Promise<void>(resolve => ready = resolve);
    const listener = yield* spawn(() =>
      startServer(options.listen!, consoleLogger, runtime, {
        hostname: "127.0.0.1",
        serviceHab: member,
        hostedPrefixes: [member.pre, hab.pre],
        onListen: () => ready(),
      })
    );
    try {
      yield* call(() => bound);
      return yield* runGroupIssuance(runtime, wallet, request, options);
    } finally {
      yield* listener.halt();
    }
  });
}

/** Run one exact member phase; issuer contributors return before the separate explicit BUP join. */
function* runGroupIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  request: GroupIssuanceRequest,
  { timeoutMs, witnessGvrsn, auths }: { timeoutMs: number; witnessGvrsn?: Versionage; auths?: WitnessAuthMap },
): Operation<GroupIssuanceResult> {
  const { hab, member, dh, coordinator, lead, rgy } = owners(runtime, wallet, request);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ValidationError("Group issuance timeout must be positive");
  }
  const receiptor = new Receiptor(runtime.hby, runtime.protocol, runtime.http, runtime.clock, { gvrsn: witnessGvrsn });
  const discloser = new WalletDiscloser(wallet, receiptor);
  let grant = runtime.exc.retainedInput(request.grant, { pending: true })?.serder;
  let originalNodes: readonly CesrFrame[] = [];
  let ownProposal: Uint8Array | undefined;
  if (request.role === "issuer") {
    if (!request.proposal) throw new ValidationError("Issuer member must select its exact Grant proposal");
    const packets = parseBytes(request.proposal), parent = packets[0], child = parent?.nests?.[0];
    if (
      packets.length !== 1 || !(parent.body instanceof SerderKERI) || parent.body.route !== "/multisig/exn"
      || parent.nests?.length !== 1
      || !(child?.body instanceof SerderKERI) || child.body.said !== request.grant || child.body.pre !== hab.pre
    ) throw new ValidationError("Select one exact group issuance Grant proposal");
    yield* runtime.reactor.processBytes(request.proposal);
    if (!runtime.exc.verifyAccepted(parent.body.said!, "/multisig/exn")) {
      throw new ValidationError("Grant proposal lacks member authentication");
    }
    const factors = envelopeFromFrame(child);
    if (
      !factors.tsgs.length
      || factors.attachmentGroups.some(group => group.name.replace(/^Big/, "") !== "TransIdxSigGroups")
    ) {
      throw new ValidationError("Fresh group Grant requires only explicit establishment-bound group contributions");
    }
    for (const proof of factors.tsgs) {
      const accepted = proof.sn <= BigInt(Number.MAX_SAFE_INTEGER)
        ? hab.db.kels.getLast(proof.pre, Number(proof.sn))
        : null;
      const establishment = accepted ? hab.db.getEvtSerder(proof.pre, accepted) : null;
      if (
        proof.pre !== hab.pre || accepted !== proof.said || !establishment?.estive || !proof.sigers.length
        || Kever.verifyIndexedSignatures(child.body.raw, proof.sigers, establishment.verfers).sigers.length
          !== proof.sigers.length
      ) {
        throw new ValidationError("Invalid supplied group Grant contribution");
      }
    }
    grant = child.body;
    originalNodes = child.nests ?? [];
    const origin = originalNodes[0]?.body;
    if (!(origin instanceof SerderACDC)) throw new ValidationError("Group Grant lacks its exact origin");
    const rebuilt = yield* discloser.prepareIssuanceGrantBody(hab.pre, origin, {
      recipient: grant.sad!.ri as string,
      message: (grant.sad!.a as { m: string }).m,
      priorSaid: grant.sad!.p as string || undefined,
      date: grant.stamp!,
      kind: grant.kind,
      plan: (grant.sad!.q as { dp: [IssuanceGrantOptions["plan"]] }).dp[0],
      attrs: Object.fromEntries(
        Object.entries(grant.sad!.a as Record<string, unknown>).filter(([key]) => !["m", "o", "ax"].includes(key)),
      ),
      anchor: (grant.sad!.a as { ax?: boolean[] }).ax?.[0],
      artifacts: yield* call(() => Promise.all(originalNodes.slice(1).map(node => collectPayload(framePayload(node))))),
    });
    const exact = grant.ilk === "xip"
      ? new SerderKERI({ sad: { ...rebuilt.exn.sad!, u: grant.sad!.u }, kind: grant.kind, makify: true })
      : rebuilt.exn;
    if (!bytesEqual(exact.raw, grant.raw)) {
      throw new ValidationError("Selected Grant differs from exact fresh issuance inputs");
    }
    const own = parseBytes(exchangeWire(hab, grant, rebuilt.nests))[0];
    own.attachments = [...child.attachments, ...own.attachments];
    yield* retainLocalGrant(runtime, own);
    ownProposal = yield* wrapper(runtime, own, "/multisig/exn");
    yield* runtime.reactor.processBytes(ownProposal, { local: true });
  } else {
    const input = runtime.exc.retainedInput(request.grant, { pending: true });
    if (!input || input.serder.sad!.ri !== hab.pre) {
      throw new ValidationError("Recipient setup selects an authenticated pending Grant");
    }
    originalNodes = input.nests ?? [];
  }
  if (!grant) throw new ValidationError("Selected Grant is unavailable");
  const frozenGrant = grant, xid = grant.ilk === "xip" ? grant.said! : grant.sad!.x as string;
  const origin = originalNodes[0].body as SerderACDC, registry = origin.regid!;
  const raw = yield* nodeStream(originalNodes);
  const pending = new Map<string, { wrapper: SerderKERI; child: CesrFrame }>(), seen = new Set<string>();
  let approved = false,
    frozen: Uint8Array | undefined,
    contributed = false,
    query: Uint8Array | undefined,
    nextQuery = 0;
  let finalProof: Uint8Array | undefined;
  let frozenDeadline = runtime.exc.exchangeDeadline(frozenGrant) ?? undefined;
  const delegated: Array<[route: string, handler: ExchangeRouteHandler]> = [];
  const result = (issued: boolean): GroupIssuanceResult => ({
    grant: request.grant,
    xid,
    registry,
    contributed: true,
    registryIssued: issued,
    admitted: false,
    ...(finalProof ? { proof: finalProof } : {}),
  });
  const selectedWrapper = (parent: SerderKERI, children: readonly CesrFrame[] = []) => {
    const child = children[0],
      field = parent.route === QueryRoute ? "qry" : parent.route === ProofRoute ? "grant" : "rpy";
    if (
      children.length !== 1 || !(child?.body instanceof SerderKERI) || parent.pvrsn.major !== 2
      || parent.pvrsn.minor !== 0
      || !groupSigningMembers(runtime.hby, hab.pre).includes(parent.pre!)
      || JSON.stringify(parent.sad!.a) !== JSON.stringify({ gid: hab.pre, [field]: child.body.said })
    ) return false;
    if (parent.route === ProofRoute) {
      return parent.pre === request.custodian && bytesEqual(child.body.raw, frozenGrant.raw);
    }
    if (parent.route !== (request.role === "issuer" ? QueryRoute : "/multisig/rpy")) return false;
    const body = child.body, data = body.sad![field === "qry" ? "q" : "a"] as { x?: string };
    const envelope = envelopeFromFrame(child);
    return body.pre === hab.pre && body.pvrsn.major === 2 && body.pvrsn.minor === 0 && body.ilk === field
      && body.route === Dhke.Route
      && data?.x === xid && (field !== "qry" || body.sad!.rr === Dhke.Route) && !child.nests?.length
      && envelope.attachmentGroups.every(group =>
        ["TransIdxSigGroups", "TransLastIdxSigGroups", "ControllerIdxSigs"].includes(group.name.replace(/^Big/, ""))
      )
      && (!frozen || bytesEqual(frozen, body.raw));
  };
  // DH children share the core /multisig/qry and /multisig/rpy routes by child route
  // (KERIpy Multiplexor.addChildHandler); the core route authenticates ipex-proof.
  for (const route of [QueryRoute, "/multisig/rpy"]) {
    const handler: ExchangeRouteHandler = {
      resource: route,
      acceptsNests: true,
      verify: args => selectedWrapper(args.serder, args.nests),
      handle(args) {
        pending.set(args.serder.said!, { wrapper: args.serder, child: args.nests![0] });
      },
    };
    runtime.mux.addChildHandler(route, Dhke.Route, handler);
    delegated.push([route, handler]);
  }
  try {
    return yield* race([
      call(function*() {
        return yield* scoped(function*() {
          const host = yield* spawn(() => runAgentRuntime(runtime, { hab: member, pollMailbox: true }));
          function* send(msg: Uint8Array, dest: string, topic = "multisig"): Operation<void> {
            const event = runtime.postman.send({ src: member.pre, dest, topic, msg }, { notify: true });
            const outcome = yield* runtime.postman.wait(event);
            if (outcome.kin === "failed") throw outcome.error;
          }
          // Public evidence aggregates contain several CESR frames, rather than one message.
          function* sendEvidence(msg: Uint8Array, dest: string, topic = "multisig"): Operation<void> {
            const event = runtime.postman.sendStream({ src: member.pre, dest, topic, msgs: [msg] }, { notify: true });
            const outcome = yield* runtime.postman.wait(event);
            if (outcome.kin === "failed") throw outcome.error;
          }
          function* broadcastEvidence(msg: Uint8Array): Operation<void> {
            for (const peer of groupSigningMembers(runtime.hby, hab.pre)) {
              if (peer !== member.pre) yield* sendEvidence(msg, peer);
            }
          }
          function* broadcast(msg: Uint8Array): Operation<void> {
            for (const peer of groupSigningMembers(runtime.hby, hab.pre)) {
              if (peer !== member.pre) yield* send(msg, peer);
            }
          }
          function check() {
            const deadline = runtime.exc.exchangeDeadline(frozenGrant);
            if (frozenDeadline && deadline !== frozenDeadline) {
              throw new ValidationError("Original group Grant deadline changed");
            }
            if (deadline) {
              frozenDeadline ??= deadline;
              const expiry = timestampMicros(deadline);
              if (expiry === null) throw new Error("Corrupt group Grant deadline");
              if (BigInt(runtime.clock.now()) * 1000n >= expiry) {
                throw new ValidationError("Original group Grant deadline expired");
              }
            }
            if (approved && !runtime.exc.complete(request.grant)) dh.complete(xid);
          }
          try {
            check();
            if (ownProposal) yield* broadcast(ownProposal);
            while (
              !runtime.exc.pendingGrant(request.grant, {
                xid,
                sender: frozenGrant.pre!,
                recipient: frozenGrant.sad!.ri as string,
              })
            ) {
              check();
              yield* wait(runtime, 50);
            }
            check();
            if (!frozenDeadline) throw new ValidationError("Selected group Grant has no original deadline");
            const remaining = Number(timestampMicros(frozenDeadline)! - BigInt(runtime.clock.now()) * 1000n) / 1000;
            yield* spawn(function*() {
              yield* wait(runtime, Math.max(0, remaining));
              throw new ValidationError("Original group Grant deadline expired");
            });
            dh.approve(request.grant, { coordinator, custodian: request.custodian });
            approved = true;
            if (lead) {
              const input = runtime.exc.retainedInput(request.grant, { pending: true })!;
              const frame =
                parseBytes(messagize(input.serder, { tsgs: input.tsgs, cigars: input.cigars, gvrsn: Vrsn_2_0 }))[0];
              frame.nests = [...input.nests ?? []];
              const full = concatBytes(discloser.proofSupport(raw, hab), yield* wire(frame));
              yield* broadcastEvidence(full);
              if (request.role === "issuer") {
                yield* sendEvidence(full, frozenGrant.sad!.ri as string, "credential");
                const child = parseBytes(dh.start(request.grant))[0];
                frozen = child.body.raw;
                yield* runtime.protocol.dispatch(child, { local: true });
                yield* broadcast(yield* wrapper(runtime, child, QueryRoute));
              }
            }
            while (!runtime.exc.complete(request.grant)) {
              check();
              // Existing durable wrapper records recover proposals received before this invocation; no second ledger.
              for (const [, parent] of runtime.hby.db.exns.getTopItemIter()) {
                if (
                  seen.has(parent.said!) || ![QueryRoute, "/multisig/rpy", ProofRoute].includes(parent.route ?? "")
                ) continue;
                const input = runtime.exc.retainedInput(parent.said!);
                if (input && selectedWrapper(parent, input.nests)) {
                  pending.set(parent.said!, { wrapper: parent, child: input.nests![0] });
                }
              }
              for (const [said, item] of pending) {
                if (seen.has(said)) {
                  pending.delete(said);
                  continue;
                }
                if (item.wrapper.route === ProofRoute) {
                  if (
                    yield* acceptGroupIssuanceProof(
                      runtime,
                      wallet,
                      request.grant,
                      request,
                      yield* wrapperBytes(runtime, said),
                    )
                  ) {
                    seen.add(said);
                    pending.delete(said);
                  }
                  continue;
                }
                if (item.wrapper.pre === member.pre) {
                  seen.add(said);
                  pending.delete(said);
                  continue;
                }
                const bytes = yield* wire(item.child);
                if (!lead && !contributed) {
                  if (request.role === "recipient" && !dh.hasPeerQuery(xid)) continue;
                  const signature = dh.contribute(xid, bytes);
                  frozen = item.child.body.raw;
                  contributed = true;
                  yield* runtime.protocol.dispatch(item.child, { local: true });
                  const contribution = parseBytes(signature)[0];
                  yield* runtime.protocol.dispatch(contribution, { local: true });
                  yield* broadcast(
                    yield* wrapper(runtime, contribution, request.role === "issuer" ? QueryRoute : "/multisig/rpy"),
                  );
                  if (request.role === "issuer") {
                    return result(false);
                  }
                } else yield* runtime.protocol.dispatch(item.child, { local: true });
                seen.add(said);
                pending.delete(said);
              }
              while (dh.outgoing.length) {
                const message = dh.outgoing.pull()!;
                if (message.kin === "sign") {
                  const child = parseBytes(message.msg)[0];
                  frozen = child.body.raw;
                  yield* runtime.protocol.dispatch(child, { local: true });
                  yield* broadcast(yield* wrapper(runtime, child, "/multisig/rpy"));
                } else if (message.kin === "query") query = message.msg;
                else yield* send(message.msg, message.dest, "credential");
              }
              if (query && runtime.clock.now() >= nextQuery && !dh.complete(xid)) {
                yield* send(query, frozenGrant.sad!.ri as string, "credential");
                nextQuery = runtime.clock.now() + 1000;
              }
              if (lead && dh.complete(xid)) {
                if (request.role === "issuer") {
                  const reg = rgy.regs.get(registry);
                  if (!reg || reg.hab !== hab) {
                    throw new ValidationError("Issuer custodian requires its managed registry");
                  }
                  const author = new WalletAuthor(
                    wallet,
                    rgy,
                    receiptor,
                    new RegistryCustody({ hby: runtime.hby, hab, registry: wallet.registry, db: wallet.db }),
                  );
                  const staged = author.stage(reg, origin, "issued");
                  // Other issuer members approve this exact BUP in a separate multisig join invocation.
                  yield* approveAcdcV2RegistryEvent(
                    runtime.hby,
                    runtime,
                    hab,
                    receiptor,
                    staged.event,
                    staged.opening,
                    auths,
                  );
                  wallet.recordIssued(origin, staged.event.said!, { blinder: staged.opening });
                } else if (wallet.registry.headEvent(registry)?.ilk !== "bup") {
                  yield* wait(runtime, 50);
                  continue;
                }
                yield* dh.finish(xid);
                if (!runtime.exc.complete(request.grant)) {
                  throw new ValidationError("Issued group Grant remains unaccepted");
                }
                const completed = parseBytes(yield* wrapperBytes(runtime, request.grant))[0];
                const publicProof = concatBytes(
                  discloser.proofSupport(raw, hab),
                  yield* wrapper(runtime, completed, ProofRoute),
                );
                // KERIpy form: the elected member shares the proof with the other members by mailbox.
                yield* broadcastEvidence(publicProof);
                if (request.role === "issuer") finalProof = publicProof;
                if (request.role === "issuer") {
                  yield* sendEvidence(discloser.proofSupport(raw, hab), frozenGrant.sad!.ri as string, "credential");
                }
              }
              yield* wait(runtime, 50);
            }
            return result(true);
          } finally {
            yield* host.halt();
          }
        });
      }),
      call(function*(): Operation<never> {
        yield* wait(runtime, timeoutMs);
        throw new ValidationError("Group issuance timed out without Admit");
      }),
    ]);
  } finally {
    if (approved) dh.abandon(xid);
    for (const [route, handler] of delegated) runtime.mux.removeChildHandler(route, Dhke.Route, handler);
  }
}
/** Replay accepted wrapper or completed Grant bytes through the existing exact evidence serializer. */
function* wrapperBytes(runtime: AgentRuntime, said: string): Operation<Uint8Array> {
  const chunks: Uint8Array[] = [];
  yield* call(async () => {
    for await (const chunk of runtime.exc.replay(said)) chunks.push(chunk);
  });
  return concatBytes(...chunks);
}
