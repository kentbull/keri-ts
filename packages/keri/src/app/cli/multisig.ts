/**
 * `tufa multisig ...` command implementation.
 *
 * The command surface follows KLI's group lifecycle model:
 * - `incept`, `rotate`, and `interact` propose a group KEL event and publish a
 *   `/multisig/*` EXN to the other members
 * - `join` polls mailbox notifications, signs the embedded event with local
 *   member keys, and republishes the approval EXN
 */
import { type Operation } from "npm:effection@^3.6.0";
import { type ThresholdSith } from "../../../../cesr/mod.ts";
import { ValidationError } from "../../core/errors.ts";
import { Roles } from "../../core/roles.ts";
import { type AgentRuntime } from "../agent-runtime.ts";
import {
  groupSigningMembers,
  localGroupMember,
  proposeGroupEndpointRole,
} from "../endpoint-roleing.ts";
import { uniqueMembers } from "../group-members.ts";
import {
  MULTISIG_ICP_ROUTE,
  MULTISIG_IXN_ROUTE,
  MULTISIG_ROT_ROUTE,
  MULTISIG_RPY_ROUTE,
} from "../grouping.ts";
import type { Hab, Habery } from "../habbing.ts";
import {
  type ApprovalPromptContext,
  type ApprovalResult,
  completeDelegationIfNeeded,
  type MultisigApprovalCallbacks,
  publishProposal,
  waitForGroupAcceptance,
  waitForLocalGroupCompletion,
  waitForOneApproval,
  waitForReplyAcceptance,
} from "../multisig-workflows.ts";
import { Receiptor, WitnessReceiptor } from "../witnessing.ts";
import { withAgentRuntime } from "./common/context.ts";
import {
  loadRotateFileOptions,
  parseDataItems,
  parseThresholdOption,
  type RotateFileOptions,
} from "./common/parsing.ts";
import { resolveWitnessAuths } from "./common/witness-auth.ts";

const MULTISIG_TOPIC = "multisig";

interface MultisigBaseArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  group?: string;
  compat?: boolean;
  endpoint?: boolean;
  authenticate?: boolean;
  code?: string[];
  codeTime?: string;
}

interface MultisigInceptArgs extends MultisigBaseArgs {
  file?: string;
  approvalTimeoutSeconds: number;
  proxy?: string;
}

interface MultisigInteractArgs extends MultisigBaseArgs {
  data?: string[];
  approvalTimeoutSeconds: number;
}

interface MultisigRotateArgs extends MultisigBaseArgs {
  file?: string;
  isith?: string;
  nsith?: string;
  toad?: number;
  witnesses?: string[];
  cuts?: string[];
  witnessAdd?: string[];
  data?: string[];
  smids?: string[];
  rmids?: string[];
  proxy?: string;
  approvalTimeoutSeconds: number;
}

interface MultisigRpyArgs extends MultisigBaseArgs {
  eid?: string;
  role?: string;
  allow?: boolean;
  approvalTimeoutSeconds: number;
}

interface MultisigJoinArgs extends MultisigBaseArgs {
  auto?: boolean;
  said?: string;
  registryName?: string;
  pollTurns?: number;
  pollBudgetMs?: number;
  proxy?: string;
}

interface MultisigInceptFileOptions {
  aids?: string[];
  rmids?: string[];
  isith?: ThresholdSith;
  nsith?: ThresholdSith;
  toad?: number;
  wits?: string[];
  data?: unknown[];
  delpre?: string;
}

function requireText(value: string | undefined, label: string): string {
  if (!value) {
    throw new ValidationError(`${label} is required and cannot be empty`);
  }
  return value;
}

function loadMultisigInceptFile(path: string): MultisigInceptFileOptions {
  const loaded = JSON.parse(Deno.readTextFileSync(path)) as MultisigInceptFileOptions;
  return {
    ...loaded,
    aids: Array.isArray(loaded.aids) ? loaded.aids.filter(isString) : loaded.aids,
    rmids: Array.isArray(loaded.rmids) ? loaded.rmids.filter(isString) : loaded.rmids,
    wits: Array.isArray(loaded.wits) ? loaded.wits.filter(isString) : loaded.wits,
  };
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** Create or begin a distributed group identifier from a KLI-style file. */
export function* multisigInceptCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: MultisigInceptArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    group: args.group as string | undefined,
    compat: args.compat as boolean | undefined,
    endpoint: args.endpoint as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
    file: args.file as string | undefined,
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      10,
      "approval timeout seconds",
    ),
    proxy: args.proxy as string | undefined,
  };
  const name = requireText(commandArgs.name, "Name");
  const alias = requireText(commandArgs.alias, "Alias");
  const group = requireText(commandArgs.group, "Group");
  const file = requireText(commandArgs.file, "Config file");
  const options = loadMultisigInceptFile(file);
  const smids = options.aids ?? [];
  const rmids = options.rmids ?? smids;
  if (smids.length === 0) {
    throw new ValidationError("Multisig inception config must include non-empty aids.");
  }

  yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const member = requireHabByAlias(hby, alias);
    const created = hby.makeGroupHab(group, member, smids, rmids, undefined, {
      isith: options.isith,
      nsith: options.nsith,
      toad: options.toad,
      wits: options.wits ?? [],
      delpre: options.delpre,
      data: options.data ?? [],
    });
    const payload = {
      gid: created.hab.pre,
      smids,
      rmids,
      ...(options.delpre ? { delegator: options.delpre } : {}),
    };
    const deliveries = yield* publishProposal(
      runtime,
      member,
      uniqueMembers([...smids, ...rmids]),
      MULTISIG_ICP_ROUTE,
      "icp",
      payload,
      created.message,
    );

    const accepted = yield* waitForGroupAcceptance(
      hby,
      runtime,
      created.serder,
      multisigApprovalOptions(hby, {
        ...commandArgs,
        group,
        auto: true,
        pollTurns: approvalTimeoutTurns(commandArgs.approvalTimeoutSeconds),
        pollBudgetMs: 1_000,
      }),
    );
    let delegationPhase: string | null = null;
    if (accepted) {
      yield* receiptAcceptedEvent(hby, created.hab.pre, commandArgs);
      delegationPhase = yield* completeDelegationIfNeeded(
        hby,
        runtime,
        created.hab.pre,
        commandArgs.proxy,
      );
    }

    printIdentifier(hby, created.hab.pre, delegationPhase);
    console.log(JSON.stringify({
      route: MULTISIG_ICP_ROUTE,
      group: created.hab.pre,
      accepted,
      deliveries,
    }));
  });
}

/** Poll for and approve one pending group multisig event. */
export function* multisigJoinCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: MultisigJoinArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    group: args.group as string | undefined,
    compat: args.compat as boolean | undefined,
    endpoint: args.endpoint as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
    auto: args.auto as boolean | undefined,
    registryName: args.registryName as string | undefined,
    said: args.said as string | undefined,
    pollTurns: args.pollTurns as number | undefined,
    pollBudgetMs: args.pollBudgetMs as number | undefined,
    proxy: args.proxy as string | undefined,
  };
  const pollTurns = positiveInteger(commandArgs.pollTurns, 32, "poll turns");
  const pollBudgetMs = positiveInteger(commandArgs.pollBudgetMs, 2_000, "poll budget milliseconds");
  const name = requireText(commandArgs.name, "Name");

  yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const result = yield* waitForOneApproval(hby, runtime, {
      ...multisigApprovalOptions(hby, { ...commandArgs, pollTurns, pollBudgetMs }),
    });
    if (!result) {
      const local = yield* waitForLocalGroupCompletion(hby, runtime, {
        ...multisigApprovalOptions(hby, { ...commandArgs, pollTurns, pollBudgetMs }),
      });
      if (!local) {
        throw new ValidationError("No matching multisig notification was available to join.");
      }
      if (local.accepted) {
        yield* receiptAcceptedEvent(hby, local.group, commandArgs);
        if (local.route === MULTISIG_ICP_ROUTE || local.route === MULTISIG_ROT_ROUTE) {
          yield* completeDelegationIfNeeded(hby, runtime, local.group, commandArgs.proxy);
        }
      }
      console.log(JSON.stringify(local));
      return;
    }
    if (result.accepted) {
      yield* receiptAcceptedEvent(hby, result.group, commandArgs);
      if (
        result.route === MULTISIG_ICP_ROUTE
        || result.route === MULTISIG_ROT_ROUTE
      ) {
        yield* completeDelegationIfNeeded(
          hby,
          runtime,
          result.group,
          commandArgs.proxy,
        );
      }
    }
    console.log(JSON.stringify(result));
  });
}

/** Create or begin one group interaction event. */
export function* multisigInteractCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: MultisigInteractArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    group: args.group as string | undefined,
    compat: args.compat as boolean | undefined,
    endpoint: args.endpoint as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
    data: args.data as string[] | undefined,
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      10,
      "approval timeout seconds",
    ),
  };
  const name = requireText(commandArgs.name, "Name");
  const group = requireText(commandArgs.group ?? commandArgs.alias, "Group");
  const data = parseDataItems(commandArgs.data);

  yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const created = hby.interactGroupHab(group, undefined, { data });
    const smids = groupSigningMembers(hby, created.hab.pre);
    const payload = { gid: created.hab.pre, smids };
    const deliveries = yield* publishProposal(
      runtime,
      localGroupMember(hby, created.hab.pre),
      smids,
      MULTISIG_IXN_ROUTE,
      "ixn",
      payload,
      created.message,
    );
    const accepted = yield* waitForGroupAcceptance(
      hby,
      runtime,
      created.serder,
      multisigApprovalOptions(hby, {
        ...commandArgs,
        group,
        auto: true,
        pollTurns: approvalTimeoutTurns(commandArgs.approvalTimeoutSeconds),
        pollBudgetMs: 1_000,
      }),
    );
    if (accepted) {
      yield* receiptAcceptedEvent(hby, created.hab.pre, commandArgs);
    }
    printIdentifier(hby, created.hab.pre);
    console.log(JSON.stringify({
      route: MULTISIG_IXN_ROUTE,
      group: created.hab.pre,
      accepted,
      deliveries,
    }));
  });
}

/** Rotate or begin rotation of one group identifier. */
export function* multisigRotateCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: MultisigRotateArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    group: args.group as string | undefined,
    compat: args.compat as boolean | undefined,
    endpoint: args.endpoint as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
    file: args.file as string | undefined,
    isith: args.isith as string | undefined,
    nsith: args.nsith as string | undefined,
    toad: args.toad as number | undefined,
    witnesses: args.witnesses as string[] | undefined,
    cuts: args.cuts as string[] | undefined,
    witnessAdd: args.witnessAdd as string[] | undefined,
    data: args.data as string[] | undefined,
    smids: args.smids as string[] | undefined,
    rmids: args.rmids as string[] | undefined,
    proxy: args.proxy as string | undefined,
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      10,
      "approval timeout seconds",
    ),
  };
  const name = requireText(commandArgs.name, "Name");
  const group = requireText(commandArgs.group ?? commandArgs.alias, "Group");
  const options = mergeRotateOptions(commandArgs);

  yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const rotated = hby.rotateGroupHab(
      group,
      commandArgs.smids,
      commandArgs.rmids,
      {
        isith: options.isith,
        nsith: options.nsith,
        toad: options.toad,
        cuts: options.witsCut,
        adds: options.witsAdd,
        data: options.data ?? [],
      },
    );
    const smids = commandArgs.smids?.length ? commandArgs.smids : groupSigningMembers(hby, rotated.hab.pre);
    const rmids = commandArgs.rmids?.length ? commandArgs.rmids : smids;
    const payload = { gid: rotated.hab.pre, smids, rmids };
    const deliveries = yield* publishProposal(
      runtime,
      localGroupMember(hby, rotated.hab.pre),
      uniqueMembers([...smids, ...rmids]),
      MULTISIG_ROT_ROUTE,
      "rot",
      payload,
      rotated.message,
    );
    const accepted = yield* waitForGroupAcceptance(
      hby,
      runtime,
      rotated.serder,
      multisigApprovalOptions(hby, {
        ...commandArgs,
        group,
        auto: true,
        pollTurns: approvalTimeoutTurns(commandArgs.approvalTimeoutSeconds),
        pollBudgetMs: 1_000,
      }),
    );
    let delegationPhase: string | null = null;
    if (accepted) {
      yield* receiptAcceptedEvent(hby, rotated.hab.pre, commandArgs);
      delegationPhase = yield* completeDelegationIfNeeded(
        hby,
        runtime,
        rotated.hab.pre,
        commandArgs.proxy,
      );
    }
    printIdentifier(hby, rotated.hab.pre, delegationPhase);
    console.log(JSON.stringify({
      route: MULTISIG_ROT_ROUTE,
      group: rotated.hab.pre,
      accepted,
      deliveries,
    }));
  });
}

/** Propose one group multisig reply such as `/end/role/add`. */
export function* multisigRpyCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: MultisigRpyArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    group: args.group as string | undefined,
    compat: args.compat as boolean | undefined,
    eid: args.eid as string | undefined,
    role: args.role as string | undefined,
    allow: args.allow as boolean | undefined,
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      0,
      "approval timeout seconds",
    ),
  };
  const name = requireText(commandArgs.name, "Name");
  const group = requireText(commandArgs.group ?? commandArgs.alias, "Group");
  const eid = requireText(commandArgs.eid, "Endpoint identifier");
  const role = commandArgs.role ?? Roles.mailbox;

  yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const groupHab = requireHabByAlias(hby, group);
    const result = yield* proposeGroupEndpointRole(
      runtime,
      groupHab,
      { eid, role, allow: commandArgs.allow },
    );
    const accepted = commandArgs.approvalTimeoutSeconds > 0
      ? yield* waitForReplyAcceptance(
        hby,
        runtime,
        groupHab.pre,
        role,
        eid,
        multisigApprovalOptions(hby, {
          ...commandArgs,
          group: groupHab.pre,
          auto: true,
          pollTurns: approvalTimeoutTurns(commandArgs.approvalTimeoutSeconds),
          pollBudgetMs: 1_000,
        }),
      )
      : result.accepted;

    console.log(JSON.stringify({
      route: result.route,
      said: result.said,
      group: result.group,
      accepted,
      deliveries: result.deliveries,
      attachmentBytes: result.attachmentBytes,
    }));
  });
}

interface MultisigRuntimeContext {
  hby: Habery;
  runtime: AgentRuntime;
}

function* withMultisigRuntime<TResult>(
  args: MultisigBaseArgs,
  name: string,
  use: (context: MultisigRuntimeContext) => Operation<TResult>,
): Operation<TResult> {
  return yield* withAgentRuntime(
    { ...args, name },
    {
      compat: args.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: false,
    },
    use,
  );
}

function requireHabByAlias(hby: Habery, alias: string): Hab {
  const hab = hby.habByName(alias);
  if (!hab?.pre) {
    throw new ValidationError(`Alias ${alias} is invalid`);
  }
  return hab;
}

function mergeRotateOptions(args: MultisigRotateArgs): RotateFileOptions {
  const options = args.file && args.file !== "" ? loadRotateFileOptions(args.file) : {};
  if (args.isith !== undefined) {
    options.isith = parseThresholdOption(args.isith);
  }
  if (args.nsith !== undefined) {
    options.nsith = parseThresholdOption(args.nsith);
  }
  if (args.toad !== undefined) {
    options.toad = Number(args.toad);
  }
  if ((args.witnesses?.length ?? 0) > 0) {
    options.wits = [...args.witnesses!];
  }
  if ((args.cuts?.length ?? 0) > 0) {
    options.witsCut = [...args.cuts!];
  }
  if ((args.witnessAdd?.length ?? 0) > 0) {
    options.witsAdd = [...args.witnessAdd!];
  }
  if (args.data !== undefined) {
    options.data = parseDataItems(args.data);
  }
  if ((options.wits?.length ?? 0) > 0) {
    throw new ValidationError(
      "multisig rotate does not accept replacement --witnesses yet; use --witness-cut/--witness-add.",
    );
  }
  return options;
}

function multisigApprovalOptions(
  hby: Habery,
  args: MultisigJoinArgs,
) {
  return {
    group: args.group,
    said: args.said,
    pollTurns: positiveInteger(args.pollTurns, 32, "poll turns"),
    pollBudgetMs: positiveInteger(args.pollBudgetMs, 2_000, "poll budget milliseconds"),
    callbacks: multisigApprovalCallbacks(hby, args),
  };
}

function multisigApprovalCallbacks(
  hby: Habery,
  args: MultisigJoinArgs,
): MultisigApprovalCallbacks {
  return {
    approveProposal: (context: ApprovalPromptContext) => approvePrompt(args, context),
    chooseGroupAlias: (groupPre: string) => chooseGroupAlias(hby, args, groupPre),
    chooseRegistryName: (regk: string) => chooseRegistryName(args, regk),
  };
}

function chooseRegistryName(args: MultisigJoinArgs, regk: string): string {
  if (args.registryName) {
    return args.registryName;
  }
  if (args.auto) {
    return `registry-${regk.slice(0, 12)}`;
  }
  while (true) {
    const name = prompt("\nName for Registry: ")?.trim();
    if (name) {
      return name;
    }
  }
}

function chooseGroupAlias(
  hby: Habery,
  args: MultisigJoinArgs,
  groupPre: string,
): string {
  if (args.group) {
    return args.group;
  }
  const record = hby.db.getHab(groupPre);
  if (record?.name) {
    return record.name;
  }
  if (args.auto) {
    return "default-group";
  }
  while (true) {
    const group = prompt("\nEnter group name for new AID: ")?.trim();
    if (!group) {
      continue;
    }
    const existing = hby.db.getName("", group);
    if (existing && existing !== groupPre) {
      console.log(`AID group name ${group} is already in use, please try again`);
      continue;
    }
    return group;
  }
}

function approvePrompt(
  args: MultisigJoinArgs,
  context: ApprovalPromptContext,
): boolean {
  if (args.auto) {
    return true;
  }
  console.log(JSON.stringify(
    {
      route: context.route,
      group: context.group,
      embedded: context.embedded,
    },
    null,
    2,
  ));
  const yn = prompt("\nJoin [Y|n]? ");
  return yn === null || yn === "" || yn === "y" || yn === "Y";
}

function* receiptAcceptedEvent(
  hby: Habery,
  pre: string,
  args: MultisigBaseArgs,
): Operation<void> {
  const kever = hby.db.getKever(pre);
  if (!kever || kever.wits.length === 0) {
    return;
  }
  const auths = resolveWitnessAuths(
    kever.wits,
    args.code ?? [],
    {
      codeTime: args.codeTime,
      promptMissing: args.authenticate ?? false,
    },
  );
  if (args.endpoint) {
    const receiptor = new Receiptor(hby);
    yield* receiptor.receipt(pre, { sn: kever.sn, auths });
  } else {
    const witDoer = new WitnessReceiptor(hby);
    yield* witDoer.submit(pre, { sn: kever.sn, auths });
  }
}

function positiveInteger(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new ValidationError(`${label} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeNumber(value: unknown, fallback: number, label: string): number {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ValidationError(`${label} must be a finite nonnegative number.`);
  }
  return parsed;
}

function approvalTimeoutTurns(approvalTimeoutSeconds: number | undefined): number {
  if (approvalTimeoutSeconds === undefined || approvalTimeoutSeconds === null) {
    return 40;
  }
  return Math.max(1, Math.floor(Number(approvalTimeoutSeconds) * 4));
}

function printIdentifier(
  hby: Habery,
  pre: string,
  delegationPhase?: string | null,
): void {
  const state = hby.db.getState(pre);
  console.log(`Prefix  ${pre}`);
  console.log(`New Sequence No.  ${state?.s ?? ""}`);
  for (const [idx, key] of (state?.k ?? []).entries()) {
    console.log(`\tPublic key ${idx + 1}:  ${key}`);
  }
  if (delegationPhase) {
    console.log(`Delegation status  ${delegationPhase}`);
  }
}
