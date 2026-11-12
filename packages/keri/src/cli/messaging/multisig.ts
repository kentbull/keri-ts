/**
 * `tufa multisig ...` command implementation.
 *
 * The command surface follows KLI's group lifecycle model:
 * - `incept`, `rotate`, and `interact` propose a group KEL event and publish a
 *   `/multisig/*` EXN to the other members
 * - `join` polls mailbox notifications, signs the embedded event with local
 *   member keys, and republishes the approval EXN
 */
import { type SerderKERI, type ThresholdSith, type Versionage } from "cesr-ts";
import { action, type Operation } from "npm:effection@^3.6.0";
import { registryEventRef, registryEventStatus, settleRegistryEvent } from "../../app/credentials/registry-settling.ts";
import { MemoryRootLedger, RootReplicator } from "../../app/credentials/root-replicator.ts";
import {
  telEventStatus,
  waitForIssuedCredential,
  waitForTelEvent,
} from "../../app/credentials/tel-completion.ts";
import { resolveDelegationCommunicationHab } from "../../app/identity/delegating.ts";
import type { GroupRoleResult } from "../../app/identity/endpoint-roleing.ts";
import {
  endpointRoleAccepted,
  isLocalGroupHab,
  localGroupMember,
  proposeGroupEndpointRole,
} from "../../app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../app/identity/habbing.ts";
import {
  MULTISIG_ICP_ROUTE,
  MULTISIG_REV_ROUTE,
  MULTISIG_ROT_ROUTE,
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
  routeForKelEvent,
} from "../../app/multisig/multisig-workflows.ts";
import {
  type GroupEventResult as ProposedGroupEvent,
  type GroupProposeDeps,
  proposeGroupInception,
  proposeGroupInteraction,
  proposeGroupRotation,
  settleProposedRotation,
} from "../../app/multisig/proposing.ts";
import { type AgentRuntime } from "../../app/runtime/agent-runtime.ts";
import { observeUntil } from "../../app/runtime/workflow-contract.ts";
import { Receiptor, WitnessReceiptor } from "../../app/witness/receipting.ts";
import { ValidationError } from "../../core/errors.ts";
import { isV2RegistryRoute } from "../../core/exchange/protocol-exchanging.ts";
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
  parseKeriVersionOption,
  parseNumberOption,
  parseStringListOption,
  parseStringOption,
  parseThresholdOption,
  type RotateFileOptions,
} from "../common/parsing.ts";
import { withRuntimeWorkers } from "../common/runtime-workers.ts";
import { resolveWitnessAuths } from "../common/witness-auth.ts";
import { counselInputs, finishAcceptedEvent, waitForAcceptance } from "./group-wait.ts";
import { type RootCopyLine, rootCopyLine, type RootResealLine, rootResealLine } from "./root-copy-lines.ts";

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
  /** Fire-and-forget registry root re-seals after an accepted rotation; display only. */
  rootCopies?: RootCopyOutcome[];
}

/** One automatic registry root copy outcome, displayed as a `root_copy` line. */
export type RootCopyOutcome = RootCopyLine | RootResealLine;

/** A join's approval facts plus any registry root re-seals its accepted rotation caused. */
export interface MultisigJoinResult extends ApprovalResult {
  rootCopies?: RootCopyOutcome[];
}

/**
 * Re-seal held registry roots to members an accepted group rotation added or
 * rekeyed, as KERIpy `kli multisig rotate|join`. Runs while the command's
 * runtime worker delivers; every outcome is returned, none fails the rotation.
 */
function* resealAfterRotation(
  hby: Habery,
  runtime: AgentRuntime,
  group: string,
  rotation: string,
): Operation<RootCopyOutcome[]> {
  const ghab = hby.habs.get(group), root = runtime.registryRoot;
  if (!ghab || !root) return [];
  const replicating = new RootReplicator({
    root,
    postman: runtime.postman,
    clock: runtime.clock,
    ledger: new MemoryRootLedger(),
  });
  const examination = replicating.examine(ghab, rotation);
  if (examination) return [rootResealLine(examination)];
  return (yield* replicating.processOnce({ scan: false })).map(rootCopyLine);
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
  /** KERI version of the new group KEL (KLI `--version`); defaults to 2.0. */
  version?: Versionage;
  file?: string;
  approvalTimeoutSeconds: number;
  proxy?: string;
}

interface MultisigInteractArgs extends MultisigBaseArgs {
  /** Must match the group's accepted KEL version. */
  version?: Versionage;
  data?: string[];
  approvalTimeoutSeconds: number;
}

interface MultisigRotateArgs extends MultisigBaseArgs {
  /** Must match the group's accepted KEL version. */
  version?: Versionage;
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
    version: parseKeriVersionOption(args.version),
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
    const sent = yield* proposeGroupInception(
      proposeDeps(hby, runtime),
      requireHabByAlias(hby, alias),
      group,
      {
        smids,
        rmids,
        isith: options.isith,
        nsith: options.nsith,
        toad: options.toad,
        wits: options.wits ?? [],
        delpre: options.delpre,
        data: options.data ?? [],
        version: commandArgs.version,
      },
      counselInputs(hby, commandArgs.proxy, options.delpre !== undefined, group),
    );
    const accepted = yield* waitForAcceptance(hby, runtime, sent.event, approvalDeadline(commandArgs));
    const delegationPhase = accepted ? yield* finishAcceptedEvent(hby, runtime, sent.event, commandArgs) : null;
    return { ...groupEventResult(hby, sent, accepted), delegationPhase };
  });
}

/** Poll for and approve one pending group multisig event. */
export function* multisigJoinCommand(
  args: Record<string, unknown>,
): Operation<MultisigJoinResult> {
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
        if (local.route === MULTISIG_ROT_ROUTE) {
          return { ...local, rootCopies: yield* resealAfterRotation(hby, runtime, local.group, local.embedded) };
        }
      }
      return local;
    }
    if (result.tel) {
      const { publication, reger } = runtime.vdr!;
      const tel = result.tel;
      if (result.route === MULTISIG_VCP_ROUTE || result.route === MULTISIG_REV_ROUTE) {
        yield* waitForTelEvent({ publication }, tel.pre, tel.sn, { deadline: approval.deadline });
        result.accepted = reger.tels.getOn(tel.pre, tel.sn)?.qb64 === result.embedded;
      } else {
        yield* waitForIssuedCredential({ publication }, tel.pre, { deadline: approval.deadline });
        result.accepted = reger.saved.get(tel.pre) !== null;
      }
      tel.publicationComplete = telEventStatus({ publication }, tel.pre, tel.sn).state === "complete";
      return result;
    }
    if (isV2RegistryRoute(result.route)) {
      result.accepted = yield* settleRegistryApproval(hby, runtime, result, commandArgs, approval.deadline);
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
      if (result.route === MULTISIG_ROT_ROUTE) {
        return { ...result, rootCopies: yield* resealAfterRotation(hby, runtime, result.group, result.embedded) };
      }
    }
    return result;
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
    version: parseKeriVersionOption(args.version),
  };
  const name = requireText(commandArgs.name, "Name");
  const group = requireText(commandArgs.group ?? commandArgs.alias, "Group");
  const data = parseDataItems(commandArgs.data);

  return yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const sent = yield* proposeGroupInteraction(
      proposeDeps(hby, runtime),
      requireGroupHab(hby, group),
      data,
      { fallbackAfterMs: 0 },
      commandArgs.version,
    );
    const accepted = yield* waitForAcceptance(hby, runtime, sent.event, approvalDeadline(commandArgs));
    if (accepted) yield* finishAcceptedEvent(hby, runtime, sent.event, commandArgs);
    return groupEventResult(hby, sent, accepted);
  });
}

/** Rotate or begin rotation of one group identifier. */
export function* multisigRotateCommand(
  args: Record<string, unknown>,
): Operation<GroupEventResult> {
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
    version: parseKeriVersionOption(args.version),
  };
  const name = requireText(commandArgs.name, "Name");
  const group = requireText(commandArgs.group ?? commandArgs.alias, "Group");
  const options = mergeRotateOptions(commandArgs);

  return yield* withMultisigRuntime(commandArgs, name, function*({ hby, runtime }) {
    const groupHab = requireGroupHab(hby, group);
    const sent = yield* proposeGroupRotation(
      proposeDeps(hby, runtime),
      groupHab,
      {
        smids: commandArgs.smids,
        rmids: commandArgs.rmids,
        isith: options.isith,
        nsith: options.nsith,
        toad: options.toad,
        cuts: options.witsCut,
        adds: options.witsAdd,
        data: options.data ?? [],
        version: commandArgs.version,
      },
      counselInputs(hby, commandArgs.proxy, !!hby.db.getKever(groupHab.pre!)?.delpre, group),
    );
    const accepted = yield* waitForAcceptance(hby, runtime, sent.event, approvalDeadline(commandArgs));
    let delegationPhase: string | null = null;
    let rootCopies: RootCopyOutcome[] = [];
    if (accepted) {
      // The proposer's own acceptance must commit the rotated membership as a joiner's does.
      settleProposedRotation({ hby }, sent);
      delegationPhase = yield* finishAcceptedEvent(hby, runtime, sent.event, commandArgs);
      rootCopies = yield* resealAfterRotation(hby, runtime, sent.group, sent.event.said);
    }
    return { ...groupEventResult(hby, sent, accepted), delegationPhase, rootCopies };
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
    // The reply is accepted when the other members' contributions reach this runtime.
    const accepted = commandArgs.approvalTimeoutSeconds > 0
      ? yield* observeUntil(() => endpointRoleAccepted(hby, groupHab.pre!, role, eid), {
        timeoutMs: Math.max(0, approvalDeadline(commandArgs) - Date.now()),
        pollMs: 250,
      })
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
      return yield* withRuntimeWorkers(context.runtime, { hab: signer }, () => use(context));
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

function requireGroupHab(hby: Habery, group: string): Hab {
  const hab = hby.habByName(group);
  if (!hab) throw new ValidationError(`Group alias ${group} is invalid.`);
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

/** Deadline of this command's approval wait, measured from when the wait starts. */
function approvalDeadline(args: { approvalTimeoutSeconds: number }): number {
  return Date.now() + args.approvalTimeoutSeconds * 1000;
}

function proposeDeps(hby: Habery, runtime: AgentRuntime): GroupProposeDeps {
  return { hby, protocol: runtime.protocol, postman: runtime.postman, counselor: runtime.counselor };
}

function groupEventResult(hby: Habery, sent: ProposedGroupEvent, accepted: boolean): GroupEventResult {
  return {
    route: sent.route,
    group: sent.group,
    accepted,
    messages: sent.messages,
    deliveries: sent.deliveries,
    state: hby.db.getState(sent.group),
    delegationPhase: null,
  };
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
 * @param sn Accepted event ordinal to receipt; defaults to the current event.
 */
function* receiptAcceptedEvent(
  hby: Habery,
  pre: string,
  args: MultisigBaseArgs,
  runtime: AgentRuntime,
  sn?: number,
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
    yield* receiptor.receipt(pre, { sn: sn ?? kever.sn, auths });
  } else {
    const witDoer = new WitnessReceiptor(hby, runtime.protocol, runtime.http, runtime.clock);
    yield* witDoer.submit(pre, { sn: sn ?? kever.sn, auths });
  }
}

/**
 * Settle one approved v2 RIP/BUP as KERIpy's join Counselor does: wait for the group's KEL acceptance of
 * the exact anchor, converge that anchor's witness receipts, and let the anchor escrow accept the TEL event.
 * The TEL event needs a fully witnessed anchor, so receipting only after TEL acceptance would never accept it.
 *
 * @returns Whether the approved TEL event is accepted before the approval deadline.
 */
function* settleRegistryApproval(
  hby: Habery,
  runtime: AgentRuntime,
  result: ApprovalResult,
  args: MultisigBaseArgs,
  deadline: number,
): Operation<boolean> {
  const store = runtime.acdc?.store, tel = store?.event(result.embedded);
  const anc = (hby.db.exns.get([result.said])?.sad?.a as { anc?: unknown } | undefined)?.anc;
  if (!store || !tel || typeof tel.sad?.n !== "string" || typeof anc !== "string") return result.accepted;
  const anchor = hby.db.getEvtSerder(result.group, anc);
  const ref = registryEventRef(tel, { pre: result.group, sn: anchor?.sn ?? 0, said: anc });
  const deps = { db: hby.db, store, protocol: runtime.protocol };
  let receipted = false;
  while (true) {
    let status = registryEventStatus(deps, ref);
    if (status.state === "accepted") return true;
    if (!receipted && status.state !== "awaiting-anchor") {
      if (status.state === "awaiting-receipts") {
        yield* receiptAcceptedEvent(hby, result.group, args, runtime, anchor!.sn!);
      }
      receipted = true;
    }
    status = yield* settleRegistryEvent(deps, ref);
    if (status.state === "accepted") return true;
    if (Date.now() >= deadline) return false;
    yield* sleep(Math.min(250, deadline - Date.now()));
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
