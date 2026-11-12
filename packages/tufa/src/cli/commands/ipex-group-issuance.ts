/**
 * Finite group issuance commands: a caller of the runtime's `operations.issuance`.
 *
 * The runtime owns the group protocol (`keri-ts/runtime`: `prepareGroupIssuance`, `beginGroupIssuance`,
 * `approveGroupIssuanceExchange`, `followGroupIssuanceProof`, the per-operation steps and the proof broadcast).
 * This file only hosts what a one-shot command needs around it: the workers, an optional direct listener, an elapsed
 * limit, the wallet inventory reaction and the `root_copy` read-back.
 */
import { startServer } from "@keri-ts/hosting";
import type { Wallet } from "@keri-ts/wallet";
import type { SerderACDC } from "cesr-ts";
import { call, type Operation, scoped, spawn } from "effection";
import { withRuntimeWorkers } from "keri-ts/cli";
import type { RootCopyLine } from "keri-ts/cli";
import {
  abandonIssuance,
  type AgentRuntime,
  approveGroupIssuanceExchange,
  beginGroupIssuance,
  consoleLogger,
  followGroupIssuanceProof,
  groupIssuanceProof,
  type Hab,
  type IssuanceGrantOptions,
  type IssuanceOperations,
  type IssuanceStatus,
  localGroupMember,
  prepareGroupIssuance,
  RegistryCustody,
  ValidationError,
  waitForIssuance,
  type WitnessAuthMap,
} from "keri-ts/runtime";
import { sendRootCopies } from "./registry-root.ts";

/** Exact accepted coordinator and already elected custody member selected by this invocation. */
export interface GroupIssuanceSelection {
  /** The local group identifier that issues. */
  hab: Hab;
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
  /** The custodian's root copies to the other members, sent by the runtime's replicator after issuance completes. */
  rootCopies?: RootCopyLine[];
}

/** Options of one finite group phase. */
export interface GroupIssuanceOptions {
  timeoutMs: number;
  auths?: WitnessAuthMap;
  listen?: number;
}

const ELAPSED = "Group issuance timed out without Admit";

/** The runtime's issuance owner, which a group command drives; a runtime without registry processing has none. */
function owner(runtime: AgentRuntime): IssuanceOperations {
  const ops = runtime.operations?.issuance;
  if (!ops || !runtime.operations) throw new ValidationError("Group issuance requires its DH runtime");
  return ops;
}

/** Prepare only the elected issuer's first partial Grant. */
export function* prepareGroupDerivedIssuance(
  runtime: AgentRuntime,
  credential: SerderACDC,
  options: IssuanceGrantOptions,
  selection: GroupIssuanceSelection,
): Operation<{ grant: string; proposal: Uint8Array }> {
  return yield* prepareGroupIssuance(owner(runtime), { ...selection, credential, options });
}

/**
 * Follow a contributed group issuance only to accept the custodian's final proof, from `proof` bytes or the
 * mailbox, until the elapsed limit. Signs nothing.
 */
export function* acceptGroupDerivedProof(
  runtime: AgentRuntime,
  selection: GroupIssuanceSelection,
  grant: string,
  proof: Uint8Array | undefined,
  timeoutMs: number,
): Operation<boolean> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new ValidationError("Proof timeout must be positive");
  const ops = owner(runtime);
  yield* followGroupIssuanceProof(ops, { ...selection, grant, proof });
  const member = localGroupMember(runtime.hby, selection.hab.pre!);
  const { status } = yield* withRuntimeWorkers(
    runtime,
    { hab: member, pollMailbox: true },
    () => waitForIssuance(ops, grant, { timeoutMs }),
  );
  if (status.state === "done") return true;
  if (status.state === "active") {
    abandonIssuance(ops, grant, ELAPSED);
    throw new ValidationError("Final group proof did not arrive and verify before the timeout");
  }
  throw new ValidationError(status.reason);
}

/** Own an optional direct listener before releasing the selected group's setup consent. */
export function* runGroupDerivedIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  request: GroupIssuanceRequest,
  options: GroupIssuanceOptions,
): Operation<GroupIssuanceResult> {
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new ValidationError("Group issuance timeout must be positive");
  }
  if (options.listen === undefined) return yield* runGroupIssuance(runtime, wallet, request, options);
  if (!Number.isInteger(options.listen) || options.listen < 1 || options.listen > 65535) {
    throw new ValidationError("--listen must be a port between 1 and 65535");
  }
  const { hab } = request, member = localGroupMember(runtime.hby, hab.pre!);
  return yield* scoped(function*() {
    let ready!: () => void;
    const bound = new Promise<void>((resolve) => ready = resolve);
    const listener = yield* spawn(() =>
      startServer(options.listen!, consoleLogger, runtime, {
        hostname: "127.0.0.1",
        serviceHab: member,
        hostedPrefixes: [member.pre!, hab.pre!],
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

/** Consent, wait to the elapsed limit, and report. Issuer members return once they have contributed. */
function* runGroupIssuance(
  runtime: AgentRuntime,
  wallet: Wallet,
  request: GroupIssuanceRequest,
  { timeoutMs, auths }: GroupIssuanceOptions,
): Operation<GroupIssuanceResult> {
  const ops = owner(runtime), { hab, coordinator, custodian, grant: selected } = request;
  const member = localGroupMember(runtime.hby, hab.pre!), lead = member.pre === custodian;
  const selection = { hab, coordinator, custodian };
  const started = runtime.clock.now();
  const { grant, xid } = request.role === "issuer"
    ? yield* beginGroupIssuance(ops, {
      ...selection,
      grant: selected,
      proposal: request.proposal,
      auths,
      counsel: { fallbackAfterMs: 0 },
    })
    : approveGroupIssuanceExchange(ops, { ...selection, grant: selected });
  const contributed = (status: IssuanceStatus) =>
    status.state === "active" && request.role === "issuer" && !lead && status.phase === "awaitingAnchor";
  const { status } = yield* withRuntimeWorkers(
    runtime,
    { hab: member, pollMailbox: true },
    () =>
      waitForIssuance(ops, grant, { timeoutMs, until: (status) => status.state !== "active" || contributed(status) }),
  );
  if (status.state !== "done" && !contributed(status)) {
    if (status.state === "active") abandonIssuance(ops, grant, ELAPSED);
    throw new ValidationError(status.state === "active" || status.state === "expired" ? ELAPSED : status.reason);
  }
  const origin = runtime.exc.retainedInput(grant, { pending: true })?.nests?.[0].body
    ?? runtime.exc.retainedInput(grant)!.nests![0].body;
  const registry = (origin as SerderACDC).regid!;
  const issued = status.state === "done";
  const result: GroupIssuanceResult = {
    grant,
    xid,
    registry,
    contributed: true,
    registryIssued: issued,
    admitted: false,
  };
  if (!issued) return result;
  if (request.role === "issuer" && lead) {
    const head = runtime.acdc!.store.headEvent(registry)!;
    const custody = new RegistryCustody({ hby: runtime.hby, hab, registry: wallet.registry, store: ops.deps.derived });
    wallet.recordIssued(origin as SerderACDC, head.said!, { blinder: custody.derivedOpening(head) });
    result.proof = yield* groupIssuanceProof(ops, { ...selection, grant });
  }
  if (!lead) return result;
  // The DH custodian retained the root and an accepted, issuer-anchored BUP exists. The issuance succeeded; the
  // runtime's replicator sends the copies, and this reads their outcome under the remaining --timeout.
  const rootCopies = yield* sendRootCopies(runtime, hab, [registry], {
    timeoutMs: started + timeoutMs - runtime.clock.now(),
  });
  return { ...result, rootCopies };
}
