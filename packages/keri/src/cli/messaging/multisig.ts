/**
 * `tufa multisig ...` command implementation.
 *
 * The command surface follows KLI's group lifecycle model and calls the library's
 * proposal API; a command only parses, resolves the user's choices, waits on the
 * Counselor under runtime workers and returns what to print:
 * - `incept`, `rotate`, and `interact` propose a group KEL event (`proposeGroup*`)
 *   and publish a `/multisig/*` EXN to the other members
 * - `join` approves one stored proposal the user consents to
 *   (`approveGroupProposal`) and signs nothing else; see `group-join.ts`
 */
import { Ilks, type ThresholdSith, type Versionage } from "cesr-ts";
import { action, type Operation } from "npm:effection@^3.6.0";
import { registryEventRef, registryEventStatus, settleRegistryEvent } from "../../app/credentials/registry-settling.ts";
import { MemoryRootLedger, RootReplicator } from "../../app/credentials/root-replicator.ts";
import {
  telEventStatus,
  waitForIssuedCredential,
  waitForTelEvent,
} from "../../app/credentials/tel-completion.ts";
import type { GroupRoleResult } from "../../app/identity/endpoint-roleing.ts";
import {
  endpointRoleAccepted,
  isLocalGroupHab,
  localGroupMember,
  proposeGroupEndpointRole,
} from "../../app/identity/endpoint-roleing.ts";
import type { Hab, Habery } from "../../app/identity/habbing.ts";
import type { GroupEventRef } from "../../app/multisig/counseling.ts";
import { MULTISIG_REV_ROUTE, MULTISIG_ROT_ROUTE, MULTISIG_VCP_ROUTE } from "../../app/multisig/grouping.ts";
import type { GroupSendResult } from "../../app/multisig/multisig-messaging.ts";
import type { ApprovalResult, MultisigKelRoute } from "../../app/multisig/multisig-workflows.ts";
import { routeForKelEvent } from "../../app/multisig/multisig-workflows.ts";
import type { GroupProposal } from "../../app/multisig/proposals.ts";
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
import { type JoinDeps, joinProposal } from "./group-join.ts";
import {
  counselInputs,
  finishAcceptedEvent,
  supplyDelegationProxy,
  supplyWitnessAuths,
  waitForAcceptance,
} from "./group-wait.ts";
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

/** Approve one stored group multisig proposal the user consents to. */
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
    const deadline = approvalDeadline(commandArgs);
    const joined = yield* joinProposal(approvalDeps(hby, runtime), {
      group: commandArgs.group,
      said: commandArgs.said,
      deadline,
      confirm: proposal => approvePrompt(commandArgs, proposal),
      groupAlias: proposal => chooseGroupAlias(hby, commandArgs, proposal.group),
      registryName: proposal => chooseRegistryName(commandArgs, proposal.embedded),
      inputs: () => ({ fallbackAfterMs: 0 }),
    });
    if (!joined) {
      const local = yield* completeLocalGroupEvent(hby, runtime, commandArgs, deadline);
      if (!local) {
        throw new ValidationError("No matching stored multisig proposal was available to join.");
      }
      return local;
    }
    const { event, ...result } = joined.result;
    if (result.tel) {
      const { publication, reger } = runtime.vdr!;
      const tel = result.tel;
      if (result.route === MULTISIG_VCP_ROUTE || result.route === MULTISIG_REV_ROUTE) {
        yield* waitForTelEvent({ publication }, tel.pre, tel.sn, { deadline });
        result.accepted = reger.tels.getOn(tel.pre, tel.sn)?.qb64 === result.embedded;
      } else {
        yield* waitForIssuedCredential({ publication }, tel.pre, { deadline });
        result.accepted = reger.saved.get(tel.pre) !== null;
      }
      tel.publicationComplete = telEventStatus({ publication }, tel.pre, tel.sn).state === "complete";
      return result;
    }
    if (isV2RegistryRoute(result.route)) {
      supplyWitnessAuths(hby, runtime, event, commandArgs);
      result.accepted = yield* settleRegistryApproval(hby, runtime, result, deadline);
      return result;
    }
    if (!event) return result;
    // No scheduling point separates the approval from here, so the Counselor has not yet used its defaults.
    supplyDelegationProxy(hby, runtime, event, commandArgs.proxy);
    return yield* finishJoinedEvent(hby, runtime, result, event, commandArgs);
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

function approvalDeps(hby: Habery, runtime: AgentRuntime): JoinDeps {
  return {
    hby,
    exc: runtime.exc,
    reactor: runtime.reactor,
    protocol: runtime.protocol,
    postman: runtime.postman,
    notifier: runtime.notifier,
    registryStore: runtime.acdc?.store ?? null,
    vdr: runtime.vdr,
    counselor: runtime.counselor,
  };
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

/**
 * A joined event that this approval completed has nothing left to wait for from other
 * members; finish its receipts and delegation. One that still needs other members
 * returns at once and stays counseled in the store.
 */
function* finishJoinedEvent(
  hby: Habery,
  runtime: AgentRuntime,
  result: ApprovalResult,
  event: GroupEventRef,
  args: MultisigJoinArgs,
): Operation<MultisigJoinResult> {
  if (!result.accepted) return result;
  yield* finishAcceptedEvent(hby, runtime, event, args);
  if (result.route !== MULTISIG_ROT_ROUTE) return result;
  return { ...result, rootCopies: yield* resealAfterRotation(hby, runtime, result.group, result.embedded) };
}

/** Resume a locally authored group event named by `--group` when no proposal was left to join. */
function* completeLocalGroupEvent(
  hby: Habery,
  runtime: AgentRuntime,
  args: MultisigJoinArgs,
  deadline: number,
): Operation<MultisigJoinResult | null> {
  if (!args.group || args.said) return null;
  const groupHab = hby.habByName(args.group) ?? hby.habs.get(args.group);
  if (!groupHab?.pre || !isLocalGroupHab(hby, groupHab)) return null;
  const serder = hby.db.getKever(groupHab.pre)?.serder ?? hby.db.getEvtSerder(groupHab.pre, groupHab.pre);
  const route = serder && routeForKelEvent(serder);
  if (!serder?.said || serder.sn === null || !route) return null;
  const event = { pre: groupHab.pre, sn: serder.sn, said: serder.said };
  const delegated = serder.ilk === Ilks.dip || serder.ilk === Ilks.drt;
  runtime.counselor.start(event, counselInputs(hby, args.proxy, delegated, groupHab.pre));
  const accepted = yield* waitForAcceptance(hby, runtime, event, deadline);
  const result: ApprovalResult = {
    route,
    said: "",
    embedded: serder.said,
    group: groupHab.pre,
    accepted,
    deliveries: [],
    messages: [],
  };
  return yield* finishJoinedEvent(hby, runtime, result, event, args);
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

/** Ask whether to join a proposal; `--auto` answers yes without asking, only for the join command that set it. */
export function approvePrompt(
  args: Pick<MultisigJoinArgs, "auto">,
  proposal: GroupProposal,
): boolean {
  if (args.auto) {
    return true;
  }
  console.log(JSON.stringify(
    {
      route: `/multisig/${proposal.kind}`,
      group: proposal.group,
      embedded: proposal.embedded,
    },
    null,
    2,
  ));
  const yn = prompt("\nJoin [Y|n]? ");
  return yn === null || yn === "" || yn === "y" || yn === "Y";
}

/**
 * Settle one approved v2 RIP/BUP as KERIpy's join Counselor does: wait for the group's KEL acceptance of
 * the exact anchor and let the anchor escrow accept the TEL event. The Counselor, started by the approval,
 * converges the anchor's witness receipts, which the TEL event needs.
 *
 * @returns Whether the approved TEL event is accepted before the approval deadline.
 */
function* settleRegistryApproval(
  hby: Habery,
  runtime: AgentRuntime,
  result: ApprovalResult,
  deadline: number,
): Operation<boolean> {
  const store = runtime.acdc?.store, tel = store?.event(result.embedded);
  const anc = (hby.db.exns.get([result.said])?.sad?.a as { anc?: unknown } | undefined)?.anc;
  if (!store || !tel || typeof tel.sad?.n !== "string" || typeof anc !== "string") return result.accepted;
  const anchor = hby.db.getEvtSerder(result.group, anc);
  const ref = registryEventRef(tel, { pre: result.group, sn: anchor?.sn ?? 0, said: anc });
  const deps = { db: hby.db, store, protocol: runtime.protocol };
  while (true) {
    if (registryEventStatus(deps, ref).state === "accepted") return true;
    if ((yield* settleRegistryEvent(deps, ref)).state === "accepted") return true;
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

function* sleep(ms: number): Operation<void> {
  yield* action<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    return () => clearTimeout(id);
  });
}
