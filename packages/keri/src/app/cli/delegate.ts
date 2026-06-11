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
import { type Operation } from "npm:effection@^3.6.0";
import { Diger, type SerderKERI } from "../../../../cesr/mod.ts";
import type { CueEmission } from "../../core/cues.ts";
import { ValidationError } from "../../core/errors.ts";
import { dgKey } from "../../db/core/keys.ts";
import { makeNowIso8601 } from "../../time/mod.ts";
import {
  type AgentRuntime,
  type CueSink,
  processRuntimeTurn,
  processRuntimeUntil,
} from "../agent-runtime.ts";
import {
  groupSigningMembers,
  localGroupMember,
} from "../endpoint-roleing.ts";
import { MULTISIG_IXN_ROUTE } from "../grouping.ts";
import type { Hab, Habery } from "../habbing.ts";
import { queryTransportSink } from "../query-transport.ts";
import { type WitnessAuthMap, WitnessReceiptor } from "../witnessing.ts";
import { withHabAndAgentRuntime } from "./common/context.ts";

function isGroupHab(hby: Habery, hab: Hab): boolean {
  return !!hab.pre && !!hby.db.getHab(hab.pre)?.mid;
}

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

/** Build witness auth payloads from CLI `<witness>:<code>` inputs. */
function resolveWitnessAuths(
  witnesses: readonly string[],
  codes: readonly string[],
  codeTime?: string,
  promptMissing = false,
): WitnessAuthMap {
  const timestamp = codeTime ?? makeNowIso8601();
  const auths: WitnessAuthMap = {};
  for (const entry of codes) {
    const separator = entry.indexOf(":");
    if (separator <= 0 || separator >= entry.length - 1) {
      throw new ValidationError(
        `Invalid witness code '${entry}'. Expected <Witness AID>:<code>.`,
      );
    }
    const witness = entry.slice(0, separator);
    const code = entry.slice(separator + 1);
    auths[witness] = `${code}#${timestamp}`;
  }
  if (promptMissing) {
    for (const witness of witnesses) {
      if (auths[witness]) {
        continue;
      }
      const code = prompt(`Entire code for ${witness}: `);
      if (!code) {
        throw new ValidationError(`Missing witness code for ${witness}.`);
      }
      auths[witness] = `${code}#${makeNowIso8601()}`;
    }
  }
  return auths;
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
): CueEmission {
  if (!serder.pre || !serder.snh) {
    throw new ValidationError(
      "Delegated event is missing pre or sn for query.",
    );
  }
  const query = { fn: "0", s: serder.snh };
  return {
    kind: "wire",
    cue: {
      kin: "query",
      pre: serder.pre,
      src: witness,
      route: "logs",
      query,
      wits: [witness],
    },
    msgs: [hab.query(serder.pre, witness, query, "logs")],
  };
}

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
    const result = yield* runtime.poster.sendExchange(member, {
      recipient,
      route: MULTISIG_IXN_ROUTE,
      payload: { gid: groupHab.pre, smids },
      embeds: { ixn: message },
      topic: "multisig",
    });
    deliveries.push(...result.deliveries, ...result.queued);
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

/** Route query cues through query transport and other cues through Respondant. */
function delegateConfirmSink(
  runtime: AgentRuntime,
  hby: Habery,
  hab: Hab,
): CueSink {
  const querySink = queryTransportSink(runtime, hby, hab);
  return {
    *send(emission: CueEmission): Operation<void> {
      if (emission.kind === "wire" && emission.cue.kin === "query") {
        yield* querySink.send(emission);
        return;
      }
      yield* runtime.respondant.sendWithHab(emission, hab);
    },
  };
}

/** Approve pending delegated events for the selected local delegator habitat.
 *
 * This is the explicit use-case service for the delegation approval workflow.
 * The public CLI command is now a thin adapter: parse → open context → call → render → close.
 */
export function* performDelegationApproval(
  hby: Habery,
  hab: Hab,
  runtime: AgentRuntime,
  confirmArgs: DelegateConfirmArgs,
): Operation<void> {
  const interactionApproval = confirmArgs.interact ?? false;

  const sink = delegateConfirmSink(runtime, hby, hab);
  yield* processRuntimeUntil(
    runtime,
    () => pendingDelegations(hby, hab.pre).length > 0,
    { hab, maxTurns: 64, pollMailbox: true, sink },
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
    confirmArgs.codeTime,
    confirmArgs.authenticate ?? false,
  );
  const selected = confirmArgs.auto ? pending : [pending[0]!];

  for (const serder of selected) {
    const anchor = anchorData(serder);
    if (isGroupHab(hby, hab)) {
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
      const memberSink = delegateConfirmSink(runtime, hby, member);

      pinApprovalSeal(hby, hab, serder, approving);
      yield* processRuntimeTurn(runtime, {
        hab: member,
        pollMailbox: true,
        sink: memberSink,
      });

      if (!delegateCommitted(hby, serder) && selectedWitness) {
        yield* memberSink.send(
          delegateWitnessLogsQuery(member, serder, selectedWitness),
        );
        yield* processRuntimeUntil(
          runtime,
          () => delegateCommitted(hby, serder),
          { hab: member, maxTurns: 128, pollMailbox: true, sink: memberSink },
        );
      }
      pinApprovalSeal(hby, hab, serder, approving);
      yield* processRuntimeTurn(runtime, {
        hab: member,
        pollMailbox: true,
        sink: memberSink,
      });

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
      const witDoer = new WitnessReceiptor(hby);
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
      yield* sink.send(
        delegateWitnessLogsQuery(hab, serder, selectedWitness),
      );
      yield* processRuntimeUntil(
        runtime,
        () => delegateCommitted(hby, serder),
        { hab, maxTurns: 128, pollMailbox: true, sink },
      );
    } else {
      const querier = runtime.querying.watchSeqNo(
        serder.pre!,
        serder.sn ?? 0,
        { hab },
      );
      // No delegate witness exists to query. Process the local delegable
      // after the delegator has anchored approval; the delegate still
      // discovers approval through its own delegator-KEL query path.
      pinApprovalSeal(hby, hab, serder, approving);
      yield* processRuntimeUntil(
        runtime,
        () => querier.done,
        { hab, maxTurns: 128, pollMailbox: true, sink },
      );
    }
    yield* processRuntimeTurn(runtime, { hab, pollMailbox: true, sink });

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
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    interact: args.interact as boolean | undefined,
    auto: args.auto as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
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
    yield* performDelegationApproval(hby, hab, runtime, confirmArgs);
  });
}
