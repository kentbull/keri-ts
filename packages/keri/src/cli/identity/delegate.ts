/**
 * Delegator-side CLI approval for pending delegated events.
 *
 * KERIpy correspondence:
 * - this is the bounded command analogue of KLI's delegation approval flow
 * - pending work is discovered from durable `delegables.` escrow, not from
 *   controller notifications
 *
 * Maintainer rule:
 * - `/delegate/request` notifications are UI hints only
 * - approval ordering and event selection come from the delegated-event escrows
 *   and the delegator's own KEL state
 */
import type { Operation } from "npm:effection@^3.6.0";
import type { AgentRuntime } from "../../app/runtime/agent-runtime.ts";
import { ValidationError } from "../../core/errors.ts";
import { parseBooleanOption, parseStringListOption, parseStringOption } from "../common/parsing.ts";

import {
  approveDelegation,
  type DelegationApprovalDeps,
  delegationApprovalStatus,
  listPendingDelegations,
  type PendingDelegation,
  proposeGroupDelegationApproval,
  requestDelegatedEvent,
  settleDelegationApproval,
  waitForDelegationApproval,
} from "../../app/identity/delegation-approval.ts";
import { isLocalGroupHab, localGroupMember } from "../../app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../app/identity/habbing.ts";
import { MULTISIG_IXN_ROUTE } from "../../app/multisig/grouping.ts";
import { observeUntil } from "../../app/runtime/workflow-contract.ts";
import type { WitnessAuthMap } from "../../app/witness/receipting.ts";
import { withHabAndAgentRuntime } from "../common/context.ts";
import { withRuntimeWorkers } from "../common/runtime-workers.ts";
import { resolveWitnessAuths } from "../common/witness-auth.ts";

interface DelegateConfirmArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
  interact?: boolean;
  auto?: boolean;
  authenticate?: boolean;
  code?: string[];
  codeTime?: string;
}

/** Observe until `done`, or fail with the text the CLI has always printed. */
function* waitForDelegation(done: () => boolean, timeoutMs: number): Operation<void> {
  if (!(yield* observeUntil(done, { timeoutMs }))) throw new Error(`Runtime did not converge within ${timeoutMs}ms.`);
}

/**
 * Approve pending events without starting or serially driving background workers.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param hab Approving local habitat.
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param confirmArgs Command approval choices/callback inputs.
 */
function* performDelegationApproval(
  hby: Habery,
  hab: Hab,
  runtime: AgentRuntime,
  confirmArgs: DelegateConfirmArgs,
): Operation<void> {
  const interactionApproval = confirmArgs.interact ?? false;

  yield* waitForDelegation(
    () => listPendingDelegations(hby, { delegator: hab.pre }).length > 0,
    15_000,
  );

  const pending = listPendingDelegations(hby, { delegator: hab.pre });
  if (pending.length === 0) {
    throw new ValidationError(
      `No delegated events are awaiting approval for ${hab.pre}.`,
    );
  }
  if (pending.length > 1 && !confirmArgs.auto) {
    throw new ValidationError(
      `Multiple delegated events are awaiting approval for ${hab.pre}. Re-run with --auto to approve them in order.`,
    );
  }

  const auths = resolveWitnessAuths(
    hab.kever!.wits,
    confirmArgs.code ?? [],
    {
      codeTime: confirmArgs.codeTime,
      promptMissing: confirmArgs.authenticate ?? false,
    },
  );
  const selected = confirmArgs.auto ? pending : [pending[0]!];
  const deps: DelegationApprovalDeps = {
    hby,
    protocol: runtime.protocol,
    http: runtime.http,
    clock: runtime.clock,
    querying: runtime.querying,
  };

  for (const request of selected) {
    if (isLocalGroupHab(hby, hab)) {
      yield* approveGroupDelegation(hby, hab, runtime, confirmArgs, request, auths);
      continue;
    }

    yield* approveDelegation(deps, request, {
      event: interactionApproval ? "ixn" : "rot",
      auths,
    });
    const result = yield* waitForDelegationApproval(
      { db: hby.db, settle: () => settleDelegationApproval(deps, request) },
      request,
      { timeoutMs: 30_000 },
    );
    if (result.outcome === "timed-out") {
      throw new Error(`Runtime did not converge within ${result.timeoutMs}ms.`);
    }
    if (hby.db.delegables.get([request.delegate]).includes(request.said)) {
      throw new ValidationError(
        `Delegated event ${request.said} remained in delegables escrow after approval.`,
      );
    }

    console.log(
      `Approved delegated ${request.ilk} ${request.said} for ${request.delegate} using ${
        interactionApproval ? "ixn" : "rot"
      }.`,
    );
  }
}

/**
 * Group delegator approval: propose the anchoring interaction the first time; once the
 * group's KEL holds the anchor (the other members approved it), ask for the delegate's event.
 */
function* approveGroupDelegation(
  hby: Habery,
  hab: Hab,
  runtime: AgentRuntime,
  confirmArgs: DelegateConfirmArgs,
  request: PendingDelegation,
  auths: WitnessAuthMap,
): Operation<void> {
  if (!confirmArgs.interact) {
    throw new ValidationError(
      "Multisig delegated approval currently requires --interact.",
    );
  }
  const deps: DelegationApprovalDeps = {
    hby,
    protocol: runtime.protocol,
    http: runtime.http,
    clock: runtime.clock,
    querying: runtime.querying,
  };
  const sent = yield* proposeGroupDelegationApproval(
    { hby, protocol: runtime.protocol, postman: runtime.postman, counselor: runtime.counselor },
    request,
    { auths, fallbackAfterMs: 0 },
  );
  if (sent) {
    console.log(JSON.stringify({
      status: hby.db.kels.getLast(sent.group, sent.event.sn) === sent.event.said ? "accepted" : "multisig-pending",
      route: MULTISIG_IXN_ROUTE,
      group: sent.group,
      delegated: request.delegate,
      said: request.said,
      anchor: sent.event.said,
      deliveries: sent.deliveries,
    }));
    return;
  }

  yield* waitForDelegation(() => {
    const status = delegationApprovalStatus(hby, request);
    return status.state === "approved" || (status.state === "anchored" && status.receipted);
  }, 30_000);
  requestDelegatedEvent(deps, request, localGroupMember(hby, hab.pre).pre);
  const result = yield* waitForDelegationApproval(
    { db: hby.db, settle: () => settleDelegationApproval(deps, request) },
    request,
    { timeoutMs: 30_000 },
  );
  if (result.outcome === "timed-out") throw new Error(`Runtime did not converge within ${result.timeoutMs}ms.`);
  if (hby.db.delegables.get([request.delegate]).includes(request.said)) {
    throw new ValidationError(`Delegated event ${request.said} remained in delegables escrow after approval.`);
  }
  console.log(`Approved delegated ${request.ilk} ${request.said} for ${request.delegate} using multisig ixn.`);
}

/** Approve pending delegated events for the selected local delegator habitat. */
export function* delegateConfirmCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const confirmArgs: DelegateConfirmArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    compat: parseBooleanOption(args.compat, "compat"),
    interact: parseBooleanOption(args.interact, "interact"),
    auto: parseBooleanOption(args.auto, "auto"),
    authenticate: parseBooleanOption(args.authenticate, "authenticate"),
    code: parseStringListOption(args.code, "code"),
    codeTime: parseStringOption(args.codeTime, "codeTime"),
  };

  if (!confirmArgs.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!confirmArgs.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }

  yield* withHabAndAgentRuntime(confirmArgs, confirmArgs.alias, {
    compat: confirmArgs.compat ?? false,
    readonly: false,
    skipConfig: true,
    skipSignator: true,
  }, function*({ hby, hab, runtime }) {
    if (!hab.kever) {
      throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);
    }
    const signer = isLocalGroupHab(hby, hab) ? localGroupMember(hby, hab.pre) : hab;
    yield* withRuntimeWorkers(
      runtime,
      { hab: signer },
      () => performDelegationApproval(hby, hab, runtime, confirmArgs),
    );
  });
}
