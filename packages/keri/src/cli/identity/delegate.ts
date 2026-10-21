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
import { Diger, type SerderKERI } from "cesr-ts";
import { call, type Operation, race, sleep, spawn } from "npm:effection@^3.6.0";
import { type AgentRuntime, runAgentRuntime } from "../../app/runtime/agent-runtime.ts";
import type { QueryRequest } from "../../core/cues.ts";
import { ValidationError } from "../../core/errors.ts";
import { dgKey } from "../../db/core/keys.ts";
import { parseBooleanOption, parseStringListOption, parseStringOption } from "../common/parsing.ts";

import { createExchangeMessage } from "../../app/exchanges/exchange-messaging.ts";
import { groupSigningMembers, isLocalGroupHab, localGroupMember } from "../../app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../app/identity/habbing.ts";
import { MULTISIG_IXN_ROUTE } from "../../app/multisig/grouping.ts";
import { SeqNoQuerier } from "../../app/queries/querying.ts";
import { runtimeTurn } from "../../app/runtime/runtime-turn.ts";
import { WitnessReceiptor } from "../../app/witness/receipting.ts";
import { withHabAndAgentRuntime } from "../common/context.ts";
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

/** Return pending delegated events for one local delegator, oldest first. */
function pendingDelegations(
  hby: Habery,
  delegatorPre: string,
): SerderKERI[] {
  const pending: SerderKERI[] = [];
  for (const [keys, said] of hby.db.delegables.getTopItemIter()) {
    const pre = keys[0];
    if (!pre) {
      continue;
    }
    const serder = hby.db.getEvtSerder(pre, said);
    if (!serder) {
      continue;
    }
    const sourcePrefix = delegationSourcePrefix(hby, serder, pre);
    if (sourcePrefix !== delegatorPre) {
      continue;
    }
    pending.push(serder);
  }
  return pending.sort((left, right) => (left.sn ?? 0) - (right.sn ?? 0));
}

/** Determine the delegator prefix for `dip` or `drt` escrow material. */
function delegationSourcePrefix(
  hby: Habery,
  serder: SerderKERI,
  pre: string,
): string | undefined {
  if (serder.delpre) {
    return serder.delpre;
  }
  if (serder.ilk !== "drt") {
    return undefined;
  }
  const delegatedPre = serder.pre ?? pre;
  return hby.db.getKever(delegatedPre)?.delpre
    ?? hby.db.getState(delegatedPre)?.di;
}

/** Project a delegated event into the seal embedded by the approving event. */
function anchorData(serder: SerderKERI): { i: string; s: string; d: string } {
  if (!serder.pre || !serder.snh || !serder.said) {
    throw new ValidationError("Delegated event is missing pre, sn, or said.");
  }
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

function approvingEvent(
  hby: Habery,
  serder: SerderKERI,
  delegator: Hab,
): SerderKERI | null {
  return hby.db.fetchLastSealingEventByEventSeal(
    delegator.pre,
    anchorData(serder),
  );
}

/** Resolve delegate witnesses for either delegated inception or rotation. */
function delegateWitnesses(
  hby: Habery,
  serder: SerderKERI,
): string[] {
  if ((serder.sn ?? 0) === 0) {
    return [...serder.backs];
  }
  if (!serder.pre) {
    return [];
  }
  return [...(hby.db.getKever(serder.pre)?.wits ?? [])];
}

/** Return true once the delegated event has left escrow and reached local state. */
function delegateCommitted(
  hby: Habery,
  serder: SerderKERI,
): boolean {
  if (!serder.pre) {
    return false;
  }
  const kever = hby.db.getKever(serder.pre);
  return kever !== undefined && kever !== null && kever.sn >= (serder.sn ?? 0);
}

/** Build a witness log query used to pull delegate-side completion material. */
function delegateWitnessLogsQuery(
  hab: Hab,
  serder: SerderKERI,
  witness: string,
): QueryRequest {
  if (!serder.pre || !serder.snh) {
    throw new ValidationError(
      "Delegated event is missing pre or sn for query.",
    );
  }
  return {
    pre: serder.pre,
    signer: hab.pre,
    src: witness,
    route: "logs",
    q: { fn: "0", s: serder.snh },
    wits: [witness],
  };
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

function pinApprovalSeal(
  hby: Habery,
  hab: Hab,
  delegated: SerderKERI,
  approving: SerderKERI,
): void {
  if (!approving.sner || !approving.said || !delegated.pre || !delegated.said) {
    throw new ValidationError("Approving event material is incomplete.");
  }
  hby.db.aess.pin(dgKey(delegated.pre, delegated.said), [
    approving.sner,
    new Diger({ qb64: approving.said }),
  ]);
  hab.kvy.processEscrowDelegables();
}

/** Observe approval state while the command's host workers own background progress. */
function* waitForDelegation(done: () => boolean, timeoutMs: number): Operation<void> {
  const deadline = Date.now() + timeoutMs;
  while (!done()) {
    if (Date.now() >= deadline) throw new Error(`Runtime did not converge within ${timeoutMs}ms.`);
    yield* runtimeTurn();
  }
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
    () => pendingDelegations(hby, hab.pre).length > 0,
    15_000,
  );

  const pending = pendingDelegations(hby, hab.pre);
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

  for (const serder of selected) {
    const anchor = anchorData(serder);
    if (isLocalGroupHab(hby, hab)) {
      if (!interactionApproval) {
        throw new ValidationError(
          "Multisig delegated approval currently requires --interact.",
        );
      }

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
        continue;
      }

      const witnesses = delegateWitnesses(hby, serder).sort();
      const selectedWitness = witnesses[0];
      const member = localGroupMember(hby, hab.pre);

      pinApprovalSeal(hby, hab, serder, approving);

      if (!delegateCommitted(hby, serder) && selectedWitness) {
        runtime.querying.enqueue(
          delegateWitnessLogsQuery(member, serder, selectedWitness),
        );
        yield* waitForDelegation(
          () => delegateCommitted(hby, serder),
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
      continue;
    }

    // KERIpy permits either interaction or rotation approval. Keep this
    // explicit because the chosen approving event type affects later
    // replay, but the embedded anchor seal is the same.
    if (interactionApproval) {
      hab.interact({ data: [anchor] });
    } else {
      hab.rotate({ data: [anchor] });
    }

    if (hab.kever?.wits.length) {
      const witDoer = new WitnessReceiptor(hby, runtime.protocol, runtime.http, runtime.clock);
      yield* witDoer.submit(hab.pre, {
        sn: hab.kever.sn,
        auths,
      });
    }

    const approving = hby.db.getEvtSerder(hab.pre, hab.kever!.said);
    if (!approving) {
      throw new ValidationError(
        "Approving event material is incomplete.",
      );
    }
    const witnesses = delegateWitnesses(hby, serder).sort();
    const selectedWitness = witnesses[0];
    if (selectedWitness) {
      // Witnessed delegates must prove the delegated event is committed
      // locally before we pin `aess.` and retry delegated unescrow. Doing
      // it earlier can make local state look approved but incomplete.
      runtime.querying.enqueue(
        delegateWitnessLogsQuery(hab, serder, selectedWitness),
      );
      yield* waitForDelegation(
        () => delegateCommitted(hby, serder),
        30_000,
      );
    } else {
      // No delegate witness exists to query. Process the local delegable
      // after the delegator has anchored approval; the delegate still
      // discovers approval through its own delegator-KEL query path.
      pinApprovalSeal(hby, hab, serder, approving);
      const observed = yield* race([
        call(function*() {
          yield* new SeqNoQuerier(hby.db, runtime.querying, serder.pre!, serder.sn ?? 0, {
            signer: hab.pre,
          }).queryDo();
          return true;
        }),
        call(function*() {
          yield* sleep(30_000);
          return false;
        }),
      ]);
      if (!observed) throw new Error("Runtime did not converge within 30000ms.");
    }

    // Match KERIpy sequencing: only record the approving seal and retry
    // delegated unescrow after the delegate event has been observed as
    // locally committed through the witness-backed query/replay path.
    if (selectedWitness) {
      pinApprovalSeal(hby, hab, serder, approving);
    }

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
      `Approved delegated ${serder.ilk} ${serder.said ?? ""} for ${serder.pre ?? ""} using ${
        interactionApproval ? "ixn" : "rot"
      }.`,
    );
  }
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
    const worker = yield* spawn(() => runAgentRuntime(runtime, { hab: signer }));
    try {
      yield* performDelegationApproval(hby, hab, runtime, confirmArgs);
    } finally {
      yield* worker.halt();
    }
  });
}
