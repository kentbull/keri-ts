/**
 * `tufa multisig ...` command implementation.
 *
 * The command surface follows KLI's group lifecycle model:
 * - `incept`, `rotate`, and `interact` propose a group KEL event and publish a
 *   `/multisig/*` EXN to the other members
 * - `join` polls mailbox notifications, signs the embedded event with local
 *   member keys, and republishes the approval EXN
 */
import { type SerderKERI, type ThresholdSith } from "cesr-ts";
import { action, type Operation, spawn } from "npm:effection@^3.6.0";
import { resolveDelegationCommunicationHab } from "../../app/identity/delegating.ts";
import type { GroupRoleResult } from "../../app/identity/endpoint-roleing.ts";
import {
  endpointRoleAccepted,
  proposeGroupEndpointRole,
} from "../../app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../app/identity/habbing.ts";
import {
  groupSigningMembers,
  isLocalGroupHab,
  localGroupMember,
  uniqueMembers,
} from "../../app/multisig/group-members.ts";
import {
  MULTISIG_ICP_ROUTE,
  MULTISIG_IXN_ROUTE,
  MULTISIG_REV_ROUTE,
  MULTISIG_ROT_ROUTE,
  MULTISIG_RPY_ROUTE,
  MULTISIG_VCP_ROUTE,
} from "../../app/multisig/grouping.ts";
import type { GroupSendResult } from "../../app/multisig/multisig-messaging.ts";
import type { MultisigKelRoute } from "../../app/multisig/multisig-workflows.ts";
import {
  type ApprovalPromptContext,
  type ApprovalResult,
  approvePendingMultisigProposal,
  eventAccepted,
  type MultisigApprovalCallbacks,
  type MultisigApprovalOptions,
  publishProposal,
  routeForKelEvent,
} from "../../app/multisig/multisig-workflows.ts";
import { type AgentRuntime, runAgentRuntime } from "../../app/runtime/agent-runtime.ts";
import { Receiptor, WitnessReceiptor } from "../../app/witness/receipting.ts";
import { ValidationError } from "../../core/errors.ts";
import type { KeyStateRecord } from "../../core/records.ts";
import { Roles } from "../../core/roles.ts";
import { withAgentRuntime } from "../common/context.ts";
import {
  loadOptionObject,
  loadRotateFileOptions,
  parseBooleanOption,
  parseCountOption,
  parseDataItems,
  parseFileData,
  parseNumberOption,
  parseStringListOption,
  parseStringOption,
  parseThresholdOption,
  type RotateFileOptions,
} from "../common/parsing.ts";
import { waitForIssuedCredential, waitForTelPublication } from "../common/tel-completion.ts";
import { resolveWitnessAuths } from "../common/witness-auth.ts";

const MULTISIG_TOPIC = "multisig";

/**
 * Captured group event state and coordination outcomes, usable after command
 * resources close. Tufa owns display/JSON projection. accepted reflects this
 * command's local event predicate; completed deliveries alone never imply it.
 */
export interface GroupEventResult extends GroupSendResult {
  route: MultisigKelRoute;
  group: string;
  accepted: boolean;
  state: KeyStateRecord | null;
  delegationPhase: string | null;
}

/** Transient membership comparison for application post-rotation work. */
export interface GroupRotationResult extends GroupEventResult {
  previousSigningMembers: string[];
  signingMembers: string[];
  rotation: string;
}

/** Join output optionally carries transient accepted-rotation membership. */
export interface GroupJoinResult extends ApprovalResult {
  rotation?: {
    accepted: boolean;
    previousSigningMembers: string[];
    signingMembers: string[];
    rotation: string;
    alias: string;
  };
}

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
  isith?: ThresholdSith;
  nsith?: ThresholdSith;
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
  approvalTimeoutSeconds: number;
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

/** Validate every supplied group member and policy field before opening the group store. */
function loadMultisigInceptFile(path: string): MultisigInceptFileOptions {
  const loaded = loadOptionObject(path);
  return {
    aids: parseStringListOption(loaded.aids, "aids"),
    rmids: parseStringListOption(loaded.rmids, "rmids"),
    isith: parseThresholdOption(loaded.isith),
    nsith: parseThresholdOption(loaded.nsith),
    toad: parseCountOption(loaded.toad, "toad"),
    wits: parseStringListOption(loaded.wits, "wits"),
    data: parseFileData(loaded.data),
    delpre: parseStringOption(loaded.delpre, "delpre"),
  };
}

/** Create or begin a distributed group identifier from a KLI-style file. */
export function* multisigInceptCommand(
  args: Record<string, unknown>,
): Operation<GroupEventResult> {
  const commandArgs: MultisigInceptArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    group: parseStringOption(args.group, "group"),
    compat: parseBooleanOption(args.compat, "compat"),
    endpoint: parseBooleanOption(args.endpoint, "endpoint"),
    authenticate: parseBooleanOption(args.authenticate, "authenticate"),
    code: parseStringListOption(args.code, "code"),
    codeTime: parseStringOption(args.codeTime, "codeTime"),
    file: parseStringOption(args.file, "file"),
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      10,
      "approval timeout seconds",
    ),
    proxy: parseStringOption(args.proxy, "proxy"),
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

  return yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const member = requireHabByAlias(hby, alias);
    const created = hby.makeGroupHab(group, member, smids, rmids, undefined, {
      isith: options.isith,
      nsith: options.nsith,
      toad: options.toad,
      wits: options.wits ?? [],
      delpre: options.delpre,
      data: options.data ?? [],
    });
    const { deliveries, messages } = yield* publishProposal(
      hby,
      runtime.protocol,
      runtime.postman,
      member,
      uniqueMembers([...smids, ...rmids]),
      {
        route: MULTISIG_ICP_ROUTE,
        attrs: { smids, rmids, ...(options.delpre ? { delegator: options.delpre } : {}) },
      },
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
      }),
    );
    let delegationPhase: string | null = null;
    if (accepted) {
      yield* receiptAcceptedEvent(hby, created.hab.pre, commandArgs, runtime);
      delegationPhase = yield* completeDelegationIfNeeded(
        hby,
        runtime,
        created.hab.pre,
        commandArgs.proxy,
      );
    }

    return {
      route: MULTISIG_ICP_ROUTE,
      group: created.hab.pre,
      accepted,
      messages,
      deliveries,
      state: hby.db.getState(created.hab.pre),
      delegationPhase: delegationPhase,
    };
  });
}

/** Poll for and approve one pending group multisig event. */
export function* multisigJoinCommand(
  args: Record<string, unknown>,
): Operation<GroupJoinResult> {
  const commandArgs: MultisigJoinArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    group: parseStringOption(args.group, "group"),
    compat: parseBooleanOption(args.compat, "compat"),
    endpoint: parseBooleanOption(args.endpoint, "endpoint"),
    authenticate: parseBooleanOption(args.authenticate, "authenticate"),
    code: parseStringListOption(args.code, "code"),
    codeTime: parseStringOption(args.codeTime, "codeTime"),
    auto: parseBooleanOption(args.auto, "auto"),
    registryName: parseStringOption(args.registryName, "registryName"),
    said: parseStringOption(args.said, "said"),
    approvalTimeoutSeconds: nonNegativeNumber(args.approvalTimeoutSeconds, 60, "approval timeout seconds"),
    proxy: parseStringOption(args.proxy, "proxy"),
  };
  const name = requireText(commandArgs.name, "Name");

  return yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const before = new Map(
      [...hby.habs.values()]
        .filter((hab) => isLocalGroupHab(hby, hab))
        .map((hab) => [hab.pre, [...groupSigningMembers(hby, hab.pre)]]),
    );
    const completed = (result: ApprovalResult): GroupJoinResult => {
      const prior = before.get(result.group), hab = hby.habs.get(result.group);
      if (!result.accepted || result.route !== MULTISIG_ROT_ROUTE || !prior || !hab) return result;
      return {
        ...result,
        rotation: {
          accepted: true,
          previousSigningMembers: prior,
          signingMembers: [...groupSigningMembers(hby, hab.pre)],
          rotation: result.embedded,
          alias: hab.name,
        },
      };
    };
    const approval = multisigApprovalOptions(hby, commandArgs);
    const result = yield* waitForOneApproval(hby, runtime, approval);
    if (!result) {
      const local = yield* waitForLocalGroupCompletion(hby, runtime, approval);
      if (!local) {
        throw new ValidationError("No matching stored multisig proposal was available to join.");
      }
      if (local.accepted) {
        yield* receiptAcceptedEvent(hby, local.group, commandArgs, runtime);
        if (local.route === MULTISIG_ICP_ROUTE || local.route === MULTISIG_ROT_ROUTE) {
          yield* completeDelegationIfNeeded(hby, runtime, local.group, commandArgs.proxy);
        }
      }
      return completed(local);
    }
    if (result.tel) {
      const { publication, reger } = runtime.vdr!;
      const tel = result.tel;
      if (result.route === MULTISIG_VCP_ROUTE || result.route === MULTISIG_REV_ROUTE) {
        yield* waitForTelPublication(publication, tel.pre, tel.sn, approval.deadline);
        result.accepted = reger.tels.getOn(tel.pre, tel.sn)?.qb64 === result.embedded;
      } else {
        yield* waitForIssuedCredential(publication, tel.pre, approval.deadline);
        result.accepted = reger.saved.get(tel.pre) !== null;
      }
      tel.publicationComplete = publication.complete(tel.pre, tel.sn);
      return result;
    }
    if (result.accepted) {
      yield* receiptAcceptedEvent(hby, result.group, commandArgs, runtime);
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
    return completed(result);
  });
}

/** Create or begin one group interaction event. */
export function* multisigInteractCommand(
  args: Record<string, unknown>,
): Operation<GroupEventResult> {
  const commandArgs: MultisigInteractArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    group: parseStringOption(args.group, "group"),
    compat: parseBooleanOption(args.compat, "compat"),
    endpoint: parseBooleanOption(args.endpoint, "endpoint"),
    authenticate: parseBooleanOption(args.authenticate, "authenticate"),
    code: parseStringListOption(args.code, "code"),
    codeTime: parseStringOption(args.codeTime, "codeTime"),
    data: parseStringListOption(args.data, "data"),
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      10,
      "approval timeout seconds",
    ),
  };
  const name = requireText(commandArgs.name, "Name");
  const group = requireText(commandArgs.group ?? commandArgs.alias, "Group");
  const data = parseDataItems(commandArgs.data);

  return yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const created = hby.interactGroupHab(group, undefined, { data });
    const smids = groupSigningMembers(hby, created.hab.pre);
    const { deliveries, messages } = yield* publishProposal(
      hby,
      runtime.protocol,
      runtime.postman,
      localGroupMember(hby, created.hab.pre),
      smids,
      { route: MULTISIG_IXN_ROUTE, attrs: { gid: created.hab.pre, smids } },
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
      }),
    );
    if (accepted) {
      yield* receiptAcceptedEvent(hby, created.hab.pre, commandArgs, runtime);
    }
    return {
      route: MULTISIG_IXN_ROUTE,
      group: created.hab.pre,
      accepted,
      messages,
      deliveries,
      state: hby.db.getState(created.hab.pre),
      delegationPhase: null,
    };
  });
}

/** Rotate or begin rotation of one group identifier. */
export function* multisigRotateCommand(
  args: Record<string, unknown>,
): Operation<GroupRotationResult> {
  const commandArgs: MultisigRotateArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    group: parseStringOption(args.group, "group"),
    compat: parseBooleanOption(args.compat, "compat"),
    endpoint: parseBooleanOption(args.endpoint, "endpoint"),
    authenticate: parseBooleanOption(args.authenticate, "authenticate"),
    code: parseStringListOption(args.code, "code"),
    codeTime: parseStringOption(args.codeTime, "codeTime"),
    file: parseStringOption(args.file, "file"),
    isith: parseThresholdOption(args.isith),
    nsith: parseThresholdOption(args.nsith),
    toad: parseCountOption(args.toad, "toad"),
    witnesses: parseStringListOption(args.witnesses, "witnesses"),
    cuts: parseStringListOption(args.cuts, "cuts"),
    witnessAdd: parseStringListOption(args.witnessAdd, "witnessAdd"),
    data: parseStringListOption(args.data, "data"),
    smids: parseStringListOption(args.smids, "smids"),
    rmids: parseStringListOption(args.rmids, "rmids"),
    proxy: parseStringOption(args.proxy, "proxy"),
    approvalTimeoutSeconds: nonNegativeNumber(
      args.approvalTimeoutSeconds,
      10,
      "approval timeout seconds",
    ),
  };
  const name = requireText(commandArgs.name, "Name");
  const group = requireText(commandArgs.group ?? commandArgs.alias, "Group");
  const options = mergeRotateOptions(commandArgs);

  return yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const prior = groupHabByAliasOrPrefix(hby, group);
    if (!prior) throw new ValidationError("Group identifier is unavailable");
    const previousSigningMembers = [...groupSigningMembers(hby, prior.pre)];
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
    const { deliveries, messages } = yield* publishProposal(
      hby,
      runtime.protocol,
      runtime.postman,
      localGroupMember(hby, rotated.hab.pre),
      uniqueMembers([...smids, ...rmids]),
      { route: MULTISIG_ROT_ROUTE, attrs: { gid: rotated.hab.pre, smids, rmids } },
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
      }),
    );
    let delegationPhase: string | null = null;
    if (accepted) {
      // A threshold rotation commonly completes after rotateGroupHab returns.
      // Persist its accepted membership just as the joining member does, so
      // reopening the initiator does not retain the previous signing roster.
      if (hby.db.getKever(rotated.hab.pre)?.lastEst.d === rotated.serder.said) {
        hby.commitGroupHabMembers(rotated.hab.pre, smids, rmids);
      }
      yield* receiptAcceptedEvent(hby, rotated.hab.pre, commandArgs, runtime);
      delegationPhase = yield* completeDelegationIfNeeded(
        hby,
        runtime,
        rotated.hab.pre,
        commandArgs.proxy,
      );
    }
    return {
      route: MULTISIG_ROT_ROUTE,
      previousSigningMembers,
      signingMembers: [...smids],
      rotation: rotated.serder.said!,
      group: rotated.hab.pre,
      accepted,
      messages,
      deliveries,
      state: hby.db.getState(rotated.hab.pre),
      delegationPhase: delegationPhase,
    };
  });
}

/** Propose one group multisig reply such as `/end/role/add`. */
export function* multisigRpyCommand(
  args: Record<string, unknown>,
): Operation<GroupRoleResult> {
  const commandArgs: MultisigRpyArgs = {
    name: parseStringOption(args.name, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "headDirPath"),
    passcode: parseStringOption(args.passcode, "passcode"),
    alias: parseStringOption(args.alias, "alias"),
    group: parseStringOption(args.group, "group"),
    compat: parseBooleanOption(args.compat, "compat"),
    eid: parseStringOption(args.eid, "eid"),
    role: parseStringOption(args.role, "role"),
    allow: parseBooleanOption(args.allow, "allow"),
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

  return yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const groupHab = requireHabByAlias(hby, group);
    const result = yield* proposeGroupEndpointRole(
      hby,
      runtime.protocol,
      runtime.postman,
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
        }),
      )
      : result.accepted;

    return { ...result, accepted };
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
    function*(context) {
      const selector = args.alias ?? args.group;
      const selected = selector ? context.hby.habByName(selector) ?? context.hby.habs.get(selector) : undefined;
      const signer = selected && isLocalGroupHab(context.hby, selected)
        ? localGroupMember(context.hby, selected.pre)
        : selected;
      const worker = yield* spawn(() => runAgentRuntime(context.runtime, { hab: signer }));
      try {
        return yield* use(context);
      } finally {
        yield* worker.halt();
      }
    },
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
    options.isith = args.isith;
  }
  if (args.nsith !== undefined) {
    options.nsith = args.nsith;
  }
  if (args.toad !== undefined) {
    options.toad = args.toad;
  }
  if (args.witnesses !== undefined) {
    options.wits = [...args.witnesses];
  }
  if (args.cuts !== undefined) {
    options.witsCut = [...args.cuts];
  }
  if (args.witnessAdd !== undefined) {
    options.witsAdd = [...args.witnessAdd];
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
  // An existing group constrains approval; a new alias only names the group
  // after its inception proposal is selected and approved.
  return {
    group: args.group ? groupHabByAliasOrPrefix(hby, args.group)?.pre : undefined,
    said: args.said,
    deadline: Date.now() + args.approvalTimeoutSeconds * 1000,
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

/**
 * Collect witness receipts for the current accepted multisig event using explicit runtime collaborators.
 *
 * @param hby Borrowed local identities and accepted-state stores.
 * @param pre Accepted group event subject.
 * @param args Witness authentication and HTTP endpoint mode choices.
 * @param runtime Borrowed composed runtime; caller owns its worker and store lifetime.
 */
function* receiptAcceptedEvent(
  hby: Habery,
  pre: string,
  args: MultisigBaseArgs,
  runtime: AgentRuntime,
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
    const receiptor = new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock);
    yield* receiptor.receipt(pre, { sn: kever.sn, auths });
  } else {
    const witDoer = new WitnessReceiptor(hby, runtime.protocol, runtime.http, runtime.clock);
    yield* witDoer.submit(pre, { sn: kever.sn, auths });
  }
}

/** Approval waits allow fractional seconds and zero, but never coerce absence or overflow a deadline. */
function nonNegativeNumber(value: unknown, fallback: number, label: string): number {
  const parsed = parseNumberOption(value, label) ?? fallback;
  if (parsed < 0 || !Number.isFinite(parsed * 1000)) {
    throw new ValidationError(`${label} must be a finite nonnegative duration.`);
  }
  return parsed;
}

/** Approve stored proposals until the target event is accepted or the deadline expires. */
function* waitForGroupAcceptance(
  hby: Habery,
  runtime: AgentRuntime,
  serder: SerderKERI,
  options: MultisigApprovalOptions & { deadline: number },
): Operation<boolean> {
  if (eventAccepted(hby, serder)) {
    return true;
  }
  while (true) {
    yield* approvePendingMultisigProposal(hby, runtime, options);
    if (eventAccepted(hby, serder)) {
      return true;
    }
    if (Date.now() >= options.deadline) break;
    yield* sleep(Math.min(250, options.deadline - Date.now()));
  }
  return eventAccepted(hby, serder);
}

/** Wait for one stored proposal while the command host owns background progress. */
function* waitForOneApproval(
  hby: Habery,
  runtime: AgentRuntime,
  options: MultisigApprovalOptions & { deadline: number },
): Operation<ApprovalResult | null> {
  while (true) {
    const result = yield* approvePendingMultisigProposal(hby, runtime, options);
    if (result) {
      return result;
    }
    if (Date.now() >= options.deadline) break;
    yield* sleep(Math.min(250, options.deadline - Date.now()));
  }
  return null;
}

/** Wait for a locally authored group event to complete through stored approvals. */
function* waitForLocalGroupCompletion(
  hby: Habery,
  runtime: AgentRuntime,
  options: MultisigApprovalOptions & { deadline: number },
): Operation<ApprovalResult | null> {
  if (!options.group || options.said) {
    return null;
  }
  const groupHab = groupHabByAliasOrPrefix(hby, options.group);
  if (!groupHab?.pre) {
    return null;
  }
  const serder = localGroupJoinSerder(hby, groupHab.pre);
  if (!serder) {
    return null;
  }
  const route = routeForKelEvent(serder);
  if (!route) {
    return null;
  }
  const accepted = yield* waitForGroupAcceptance(hby, runtime, serder, options);
  return {
    route,
    said: "",
    embedded: serder.said ?? "",
    group: groupHab.pre,
    accepted,
    deliveries: [],
    messages: [],
  };
}

/** Approve stored proposals until the endpoint reply is accepted or the deadline expires. */
function* waitForReplyAcceptance(
  hby: Habery,
  runtime: AgentRuntime,
  groupPre: string,
  role: string,
  eid: string,
  options: MultisigApprovalOptions & { deadline: number },
): Operation<boolean> {
  if (endpointRoleAccepted(hby, groupPre, role, eid)) {
    return true;
  }
  while (true) {
    yield* approvePendingMultisigProposal(hby, runtime, options);
    if (endpointRoleAccepted(hby, groupPre, role, eid)) {
      return true;
    }
    if (Date.now() >= options.deadline) break;
    yield* sleep(Math.min(250, options.deadline - Date.now()));
  }
  return endpointRoleAccepted(hby, groupPre, role, eid);
}

/** Complete the delegation workflow for an accepted delegated group event. */
function* completeDelegationIfNeeded(
  hby: Habery,
  runtime: AgentRuntime,
  pre: string,
  proxy?: string,
): Operation<string | null> {
  const kever = hby.db.getKever(pre);
  if (!kever?.delpre) {
    return null;
  }
  const communicationHab = resolveDelegationCommunicationHab(hby, proxy);
  if (!communicationHab) {
    throw new ValidationError(
      `Delegated group event for ${pre} requires --proxy <alias>.`,
    );
  }
  runtime.delegating.beginLatest(pre, kever.sn, { communicationHab });

  const deadline = Date.now() + 120_000;
  while (!runtime.delegating.complete(pre, kever.sn)) {
    if (Date.now() >= deadline) throw new Error("Runtime did not converge within 120000ms.");
    yield* sleep(Math.min(250, deadline - Date.now()));
  }
  return runtime.delegating.workflowStatus(pre, kever.sner.numh).phase;
}

function groupHabByAliasOrPrefix(hby: Habery, group: string): Hab | null {
  return hby.habByName(group) ?? hby.habs.get(group) ?? null;
}

function localGroupJoinSerder(hby: Habery, groupPre: string): SerderKERI | null {
  const kever = hby.db.getKever(groupPre);
  if (kever?.serder) {
    return kever.serder;
  }
  return hby.db.getEvtSerder(groupPre, groupPre);
}

function* sleep(ms: number): Operation<void> {
  yield* action<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    return () => clearTimeout(id);
  });
}
