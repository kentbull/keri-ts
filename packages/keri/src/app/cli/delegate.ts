import { type Operation, spawn } from "npm:effection@^3.6.0";
import { Diger, type SerderKERI } from "../../../../cesr/mod.ts";
import type { CueEmission } from "../../core/cues.ts";
import { ValidationError } from "../../core/errors.ts";
import { dgKey } from "../../db/core/keys.ts";
import { makeNowIso8601 } from "../../time/mod.ts";
import { createAgentRuntime, processRuntimeTurn, processRuntimeUntil } from "../agent-runtime.ts";
import type { Hab, Habery } from "../habbing.ts";
import { queryTransportSink } from "../query-transport.ts";
import { type WitnessAuthMap, WitnessReceiptor } from "../witnessing.ts";
import { setupHby } from "./common/existing.ts";

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
    if (!serder || serder.delpre !== delegatorPre) {
      continue;
    }
    pending.push(serder);
  }
  return pending.sort((left, right) => (left.sn ?? 0) - (right.sn ?? 0));
}

function anchorData(serder: SerderKERI): { i: string; s: string; d: string } {
  if (!serder.pre || !serder.snh || !serder.said) {
    throw new ValidationError("Delegated event is missing pre, sn, or said.");
  }
  return { i: serder.pre, s: serder.snh, d: serder.said };
}

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

function delegateWitnessLogsQuery(
  hab: Hab,
  serder: SerderKERI,
  witness: string,
): CueEmission {
  if (!serder.pre || !serder.snh) {
    throw new ValidationError("Delegated event is missing pre or sn for query.");
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

  const doer = yield* spawn(function*() {
    const hby = yield* setupHby(
      confirmArgs.name!,
      confirmArgs.base ?? "",
      confirmArgs.passcode,
      false,
      confirmArgs.headDirPath,
      {
        compat: confirmArgs.compat ?? false,
        readonly: false,
        skipConfig: true,
        skipSignator: true,
      },
    );
    try {
      const hab = hby.habByName(confirmArgs.alias!);
      if (!hab) {
        throw new ValidationError(`Alias ${confirmArgs.alias!} is invalid`);
      }
      if (!hab.kever) {
        throw new ValidationError(`Missing accepted key state for ${hab.pre}.`);
      }

      const runtime = yield* createAgentRuntime(hby, { mode: "local" });
      try {
        const sink = queryTransportSink(runtime, hby, hab);
        yield* processRuntimeUntil(
          runtime,
          () => pendingDelegations(hby, hab.pre).length > 0,
          { hab, maxTurns: 64, pollMailbox: true, sink },
        );

        const pending = pendingDelegations(hby, hab.pre);
        if (pending.length === 0) {
          throw new ValidationError(`No delegated events are awaiting approval for ${hab.pre}.`);
        }
        if (pending.length > 1 && !confirmArgs.auto) {
          throw new ValidationError(
            `Multiple delegated events are awaiting approval for ${hab.pre}. Re-run with --auto to approve them in order.`,
          );
        }

        const auths = resolveWitnessAuths(
          hab.kever.wits,
          confirmArgs.code ?? [],
          confirmArgs.codeTime,
          confirmArgs.authenticate ?? false,
        );
        const selected = confirmArgs.auto ? pending : [pending[0]!];

        for (const serder of selected) {
          const anchor = anchorData(serder);
          if (confirmArgs.interact) {
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
          if (!approving?.sner || !approving.said || !serder.pre || !serder.said) {
            throw new ValidationError("Approving event material is incomplete.");
          }

          hby.db.aess.pin(dgKey(serder.pre, serder.said), [
            approving.sner,
            new Diger({ qb64: approving.said }),
          ]);
          hab.kvy.processEscrowDelegables();
          const witnesses = delegateWitnesses(hby, serder).sort();
          const selectedWitness = witnesses[0];
          if (selectedWitness) {
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
              serder.pre,
              serder.sn ?? 0,
              { hab },
            );
            yield* processRuntimeUntil(
              runtime,
              () => querier.done,
              { hab, maxTurns: 128, pollMailbox: true, sink },
            );
          }
          yield* processRuntimeTurn(runtime, { hab, pollMailbox: true, sink });

          if (serder.pre && serder.said) {
            const stillPending = hby.db.delegables.get([serder.pre]).includes(serder.said);
            if (stillPending) {
              throw new ValidationError(
                `Delegated event ${serder.said} remained in delegables escrow after approval.`,
              );
            }
          }

          console.log(
            `Approved delegated ${serder.ilk} ${serder.said ?? ""} for ${serder.pre ?? ""} using ${
              confirmArgs.interact ? "ixn" : "rot"
            }.`,
          );
        }
      } finally {
        yield* runtime.close();
      }
    } finally {
      yield* hby.close();
    }
  });

  yield* doer;
}
