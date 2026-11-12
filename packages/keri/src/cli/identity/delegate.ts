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
import type { SerderKERI } from "cesr-ts";
import type { Operation } from "npm:effection@^3.6.0";
import type { AgentRuntime } from "../../app/runtime/agent-runtime.ts";
import { ValidationError } from "../../core/errors.ts";
import { parseBooleanOption, parseStringListOption, parseStringOption } from "../common/parsing.ts";

import { createExchangeMessage } from "../../app/exchanges/exchange-messaging.ts";
import {
  approveDelegation,
  delegateCommitted,
  delegateWitnesses,
  delegateWitnessLogsQuery,
  type DelegationApprovalDeps,
  delegationSeal,
  listPendingDelegations,
  pinApprovalSeal,
  settleDelegationApproval,
  waitForDelegationApproval,
} from "../../app/identity/delegation-approval.ts";
import { groupSigningMembers, isLocalGroupHab, localGroupMember } from "../../app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../app/identity/habbing.ts";
import { MULTISIG_IXN_ROUTE } from "../../app/multisig/grouping.ts";
import { observeUntil } from "../../app/runtime/workflow-contract.ts";
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

function approvingEvent(
  hby: Habery,
  serder: SerderKERI,
  delegator: Hab,
): SerderKERI | null {
  return hby.db.fetchLastSealingEventByEventSeal(
    delegator.pre,
    delegationSeal(serder),
  );
}

/**
 * Publish group delegation approval to remote signing members before advancing the workflow.
 *
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 * @param hby Borrowed local identities and accepted-state stores.
 * @param groupHab Group approving habitat.
 * @param message Signed approving interaction to embed for remote members.
 * @returns Successful delivery URLs after each concrete Poster outcome.
 */
function* publishGroupDelegationApproval(
  runtime: AgentRuntime,
  hby: Habery,
  groupHab: Hab,
  message: Uint8Array,
): Operation<string[]> {
  const member = localGroupMember(hby, groupHab.pre);
  const smids = groupSigningMembers(hby, groupHab.pre);
  const deliveries: string[] = [];
  for (const recipient of smids) {
    if (recipient === member.pre || hby.habs.has(recipient)) {
      continue;
    }
    const { msg } = createExchangeMessage(member, {
      dest: recipient,
      route: MULTISIG_IXN_ROUTE,
      payload: { gid: groupHab.pre, smids },
      embeds: { ixn: message },
    });
    const postman = runtime.postman;
    const evt = postman.send({ src: member.pre, dest: recipient, topic: "multisig", msg }, { notify: true });
    const result = yield* postman.wait(evt);
    if (result.kin === "failed") throw result.error;
    deliveries.push(...result.deliveries);
  }
  return deliveries;
}

function eventAccepted(hby: Habery, serder: SerderKERI): boolean {
  return !!serder.pre && serder.said !== undefined
    && hby.db.kels.getLast(serder.pre, serder.sn ?? 0) === serder.said;
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
    const serder = hby.db.getEvtSerder(request.delegate, request.said)!;
    if (isLocalGroupHab(hby, hab)) {
      // TODO: replace this group branch with the group delegation proposal API
      // being built in app/multisig/counseling.ts; until then the CLI keeps the
      // existing interactGroupHab flow unchanged.
      yield* approveGroupDelegation(hby, hab, runtime, confirmArgs, serder);
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

/** Group delegator approval through `interactGroupHab`; kept as the CLI had it. */
function* approveGroupDelegation(
  hby: Habery,
  hab: Hab,
  runtime: AgentRuntime,
  confirmArgs: DelegateConfirmArgs,
  serder: SerderKERI,
): Operation<void> {
  if (!confirmArgs.interact) {
    throw new ValidationError(
      "Multisig delegated approval currently requires --interact.",
    );
  }
  const anchor = delegationSeal(serder);

  const approving = approvingEvent(hby, serder, hab);
  if (!approving) {
    const created = hby.interactGroupHab(confirmArgs.alias!, undefined, { data: [anchor] });
    const deliveries = yield* publishGroupDelegationApproval(
      runtime,
      hby,
      created.hab,
      created.message,
    );
    console.log(JSON.stringify({
      status: eventAccepted(hby, created.serder) ? "accepted" : "multisig-pending",
      route: MULTISIG_IXN_ROUTE,
      group: created.hab.pre,
      delegated: serder.pre,
      said: serder.said,
      anchor: created.serder.said,
      deliveries,
    }));
    return;
  }

  const witnesses = delegateWitnesses(hby.db, serder).sort();
  const selectedWitness = witnesses[0];
  const member = localGroupMember(hby, hab.pre);

  pinApprovalSeal(hby, hab, serder, approving);

  if (!delegateCommitted(hby.db, serder.pre!, serder.sn ?? 0) && selectedWitness) {
    runtime.querying.enqueue(
      delegateWitnessLogsQuery(member.pre, serder, selectedWitness),
    );
    yield* waitForDelegation(
      () => delegateCommitted(hby.db, serder.pre!, serder.sn ?? 0),
      30_000,
    );
  }
  pinApprovalSeal(hby, hab, serder, approving);

  if (serder.pre && serder.said) {
    const stillPending = hby.db.delegables.get([serder.pre]).includes(
      serder.said,
    );
    if (stillPending) {
      throw new ValidationError(
        `Delegated event ${serder.said} remained in delegables escrow after approval.`,
      );
    }
  }

  console.log(
    `Approved delegated ${serder.ilk} ${serder.said ?? ""} for ${serder.pre ?? ""} using multisig ixn.`,
  );
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
