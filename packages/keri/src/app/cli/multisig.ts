/**
 * `tufa multisig ...` command implementation.
 *
 * The command surface follows KLI's group lifecycle model:
 * - `incept`, `rotate`, and `interact` propose a group KEL event and publish a
 *   `/multisig/*` EXN to the other members
 * - `join` polls mailbox notifications, signs the embedded event with local
 *   member keys, and republishes the approval EXN
 */
import { action, type Operation, spawn } from "npm:effection@^3.6.0";
import {
  concatBytes,
  Diger,
  Ilks,
  NumberPrimitive,
  NumDex,
  Prefixer,
  Saider,
  Seqner,
  SerderACDC,
  SerderKERI,
  Siger,
  type ThresholdSith,
  TraitDex,
} from "../../../../cesr/mod.ts";
import { ValidationError } from "../../core/errors.ts";
import { reply as replyEvent } from "../../core/protocol-eventing.ts";
import { messagize } from "../../core/protocol-serialization.ts";
import { RegistryRecord } from "../../core/records.ts";
import { Roles } from "../../core/roles.ts";
import { Reger } from "../../db/reger.ts";
import { makeNowIso8601 } from "../../time/mod.ts";
import { Credentialer, Regery, Registry, serializeCredential } from "../../vdr/credentialing.ts";
import { Tevery } from "../../vdr/eventing.ts";
import { type AgentRuntime, createAgentRuntime, processMailboxTurn, processRuntimeUntil } from "../agent-runtime.ts";
import { resolveDelegationCommunicationHab } from "../delegating.ts";
import {
  MULTISIG_ICP_ROUTE,
  MULTISIG_ISS_ROUTE,
  MULTISIG_IXN_ROUTE,
  MULTISIG_ROT_ROUTE,
  MULTISIG_RPY_ROUTE,
  MULTISIG_VCP_ROUTE,
  multisigPathedAttachment,
  multisigRpyExn,
} from "../grouping.ts";
import type { Hab, Habery } from "../habbing.ts";
import { queryTransportSink } from "../query-transport.ts";
import { Verifier } from "../verifying.ts";
import { Receiptor, type WitnessAuthMap, WitnessReceiptor } from "../witnessing.ts";
import { setupHby } from "./common/existing.ts";
import {
  loadRotateFileOptions,
  parseDataItems,
  parseThresholdOption,
  type RotateFileOptions,
} from "./common/parsing.ts";

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

interface NoticeLike {
  rid: string;
  attrs: Record<string, unknown>;
}

interface ApprovalResult {
  route: string;
  said: string;
  embedded: string;
  group: string;
  accepted: boolean;
  deliveries: string[];
}

type MultisigKelRoute =
  | typeof MULTISIG_ICP_ROUTE
  | typeof MULTISIG_ROT_ROUTE
  | typeof MULTISIG_IXN_ROUTE;

type MultisigVdrRoute =
  | typeof MULTISIG_VCP_ROUTE
  | typeof MULTISIG_ISS_ROUTE;

type MultisigRpyRoute = typeof MULTISIG_RPY_ROUTE;

type MultisigProposalRoute = MultisigKelRoute | MultisigVdrRoute | MultisigRpyRoute;

function isKelRoute(route: string): route is MultisigKelRoute {
  return route === MULTISIG_ICP_ROUTE || route === MULTISIG_ROT_ROUTE || route === MULTISIG_IXN_ROUTE;
}

function isVdrRoute(route: string): route is MultisigVdrRoute {
  return route === MULTISIG_VCP_ROUTE || route === MULTISIG_ISS_ROUTE;
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

  const doer = yield* spawn(function*() {
    const { hby, runtime } = yield* openRuntime(commandArgs, name);
    try {
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
        {
          ...commandArgs,
          group,
          auto: true,
          pollTurns: approvalTimeoutTurns(commandArgs.approvalTimeoutSeconds),
          pollBudgetMs: 1_000,
        },
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
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });

  yield* doer;
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

  const doer = yield* spawn(function*() {
    const { hby, runtime } = yield* openRuntime(commandArgs, name);
    try {
      const result = yield* waitForOneApproval(hby, runtime, {
        ...commandArgs,
        pollTurns,
        pollBudgetMs,
      });
      if (!result) {
        const local = yield* waitForLocalGroupCompletion(hby, runtime, {
          ...commandArgs,
          pollTurns,
          pollBudgetMs,
        });
        if (!local) {
          throw new ValidationError("No matching multisig notification was available to join.");
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
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });

  yield* doer;
}

function* waitForLocalGroupCompletion(
  hby: Habery,
  runtime: AgentRuntime,
  args: MultisigJoinArgs,
): Operation<ApprovalResult | null> {
  if (!args.group || args.said) {
    return null;
  }
  const groupHab = groupHabByAliasOrPrefix(hby, args.group);
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
  const accepted = yield* waitForGroupAcceptance(hby, runtime, serder, args);
  if (accepted) {
    yield* receiptAcceptedEvent(hby, groupHab.pre, args);
    if (route === MULTISIG_ICP_ROUTE || route === MULTISIG_ROT_ROUTE) {
      yield* completeDelegationIfNeeded(hby, runtime, groupHab.pre, args.proxy);
    }
  }
  return {
    route,
    said: "",
    embedded: serder.said ?? "",
    group: groupHab.pre,
    accepted,
    deliveries: [],
  };
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

  const doer = yield* spawn(function*() {
    const { hby, runtime } = yield* openRuntime(commandArgs, name);
    try {
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
        {
          ...commandArgs,
          group,
          auto: true,
          pollTurns: approvalTimeoutTurns(commandArgs.approvalTimeoutSeconds),
          pollBudgetMs: 1_000,
        },
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
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });

  yield* doer;
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

  const doer = yield* spawn(function*() {
    const { hby, runtime } = yield* openRuntime(commandArgs, name);
    try {
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
        {
          ...commandArgs,
          group,
          auto: true,
          pollTurns: approvalTimeoutTurns(commandArgs.approvalTimeoutSeconds),
          pollBudgetMs: 1_000,
        },
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
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });

  yield* doer;
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

  const doer = yield* spawn(function*() {
    const { hby, runtime } = yield* openRuntime(commandArgs, name);
    try {
      const groupHab = requireHabByAlias(hby, group);
      const member = localGroupMember(hby, groupHab.pre);
      const rpySerder = replyEvent(
        commandArgs.allow === false ? "/end/role/cut" : "/end/role/add",
        { cid: groupHab.pre, role, eid },
        { pre: groupHab.pre },
      );
      const localRpy = groupEndorseReply(hby, groupHab.pre, rpySerder);
      runtime.reactor.processChunk(localRpy, { local: true });
      runtime.reactor.processEscrowsOnce();

      const [exn, attachments] = multisigRpyExn(groupHab, member, localRpy);
      const deliveries = yield* publishProposalEmbeds(
        runtime,
        member,
        groupSigningMembers(hby, groupHab.pre),
        MULTISIG_RPY_ROUTE,
        { gid: groupHab.pre },
        { rpy: localRpy },
      );
      const accepted = commandArgs.approvalTimeoutSeconds > 0
        ? yield* waitForReplyAcceptance(
          hby,
          runtime,
          groupHab.pre,
          role,
          eid,
          commandArgs,
        )
        : replyRoleAccepted(hby, groupHab.pre, role, eid);

      console.log(JSON.stringify({
        route: MULTISIG_RPY_ROUTE,
        said: exn.said,
        group: groupHab.pre,
        accepted,
        deliveries,
        attachmentBytes: attachments.length,
      }));
    } finally {
      yield* runtime.close();
      yield* hby.close();
    }
  });

  yield* doer;
}

function* openRuntime(
  args: MultisigBaseArgs,
  name: string,
): Operation<{ hby: Habery; runtime: AgentRuntime }> {
  const hby = yield* setupHby(
    name,
    args.base ?? "",
    args.passcode,
    false,
    args.headDirPath,
    {
      compat: args.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: false,
    },
  );
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  return { hby, runtime };
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

function* publishProposal(
  runtime: AgentRuntime,
  member: Hab,
  recipients: readonly string[],
  route: MultisigKelRoute,
  label: "icp" | "rot" | "ixn",
  payload: Record<string, unknown>,
  embeddedMessage: Uint8Array,
): Operation<string[]> {
  return yield* publishProposalEmbeds(
    runtime,
    member,
    recipients,
    route,
    payload,
    { [label]: embeddedMessage },
  );
}

function* publishProposalEmbeds(
  runtime: AgentRuntime,
  member: Hab,
  recipients: readonly string[],
  route: MultisigProposalRoute,
  payload: Record<string, unknown>,
  embeds: Record<string, Uint8Array>,
): Operation<string[]> {
  const deliveries: string[] = [];
  for (const recipient of uniqueMembers(recipients)) {
    if (recipient === member.pre || runtime.hby.habs.has(recipient)) {
      continue;
    }
    const result = yield* runtime.poster.sendExchange(member, {
      recipient,
      route,
      payload,
      embeds,
      topic: MULTISIG_TOPIC,
    });
    deliveries.push(...result.deliveries, ...result.queued);
  }
  return deliveries;
}

function* waitForGroupAcceptance(
  hby: Habery,
  runtime: AgentRuntime,
  serder: SerderKERI,
  args: MultisigJoinArgs,
): Operation<boolean> {
  if (eventAccepted(hby, serder)) {
    return true;
  }
  const pollTurns = positiveInteger(args.pollTurns, 10, "poll turns");
  for (let turn = 0; turn < pollTurns; turn++) {
    yield* processOnePendingApproval(hby, runtime, args);
    if (eventAccepted(hby, serder)) {
      return true;
    }
    yield* processMailboxTurn(runtime, {
      budgetMs: positiveInteger(args.pollBudgetMs, 1_000, "poll budget milliseconds"),
    });
    runtime.reactor.processEscrowsOnce();
    yield* sleep(250);
  }
  return eventAccepted(hby, serder);
}

function* waitForOneApproval(
  hby: Habery,
  runtime: AgentRuntime,
  args: MultisigJoinArgs,
): Operation<ApprovalResult | null> {
  const pollTurns = positiveInteger(args.pollTurns, 32, "poll turns");
  const pollBudgetMs = positiveInteger(args.pollBudgetMs, 2_000, "poll budget milliseconds");
  for (let turn = 0; turn < pollTurns; turn++) {
    const result = yield* processOnePendingApproval(hby, runtime, args);
    if (result) {
      return result;
    }
    yield* processMailboxTurn(runtime, { budgetMs: pollBudgetMs });
    runtime.reactor.processEscrowsOnce();
    yield* sleep(250);
  }
  return null;
}

function* processOnePendingApproval(
  hby: Habery,
  runtime: AgentRuntime,
  args: MultisigJoinArgs,
): Operation<ApprovalResult | null> {
  const notifier = runtime.notifier;
  if (!notifier) {
    throw new ValidationError("Multisig join requires notification storage.");
  }
  const notices = notifier.list(0, 100) as NoticeLike[];
  for (const note of notices) {
    const route = note.attrs.r;
    const said = note.attrs.d;
    if (typeof route !== "string" || typeof said !== "string") {
      continue;
    }
    if (args.said && args.said !== said) {
      continue;
    }
    if (
      route !== MULTISIG_ICP_ROUTE
      && route !== MULTISIG_ROT_ROUTE
      && route !== MULTISIG_IXN_ROUTE
      && route !== MULTISIG_VCP_ROUTE
      && route !== MULTISIG_ISS_ROUTE
      && route !== MULTISIG_RPY_ROUTE
    ) {
      continue;
    }

    const exn = hby.db.exns.get([said]);
    if (!exn?.ked) {
      continue;
    }
    const result = isKelRoute(route)
      ? yield* approveKelProposal(
        hby,
        runtime,
        exn,
        route,
        args,
      )
      : isVdrRoute(route)
      ? yield* approveVdrProposal(
        hby,
        runtime,
        exn,
        route,
        args,
      )
      : yield* approveRpyProposal(
        hby,
        runtime,
        exn,
        route,
        args,
      );
    if (result) {
      notifier.remove(note.rid);
      return result;
    }
  }
  return null;
}

function* approveRpyProposal(
  hby: Habery,
  runtime: AgentRuntime,
  exn: SerderKERI,
  route: MultisigRpyRoute,
  args: MultisigJoinArgs,
): Operation<ApprovalResult | null> {
  const wrapperSaid = exn.said;
  if (!wrapperSaid) {
    return null;
  }
  const payload = payloadSection(exn.ked ?? {});
  const groupPre = requireText(stringField(payload, "gid") || undefined, "Group prefix");
  const groupHab = hby.habs.get(groupPre);
  if (!groupHab) {
    throw new ValidationError(`Group ${groupPre} must be joined before approving ${route}.`);
  }
  const member = localGroupMember(hby, groupPre);
  const embeddedSad = embeddedSection(exn.ked ?? {})?.rpy;
  if (!isRecord(embeddedSad)) {
    return null;
  }

  const rpySerder = new SerderKERI({ sad: embeddedSad });
  const embeddedSaid = rpySerder.said ?? "";
  if (!approvePrompt(args, route, groupPre, embeddedSaid || "<unknown>")) {
    return null;
  }

  const peerAttachment = multisigPathedAttachment(hby, wrapperSaid, "rpy");
  runtime.reactor.processChunk(
    concatBytes(rpySerder.raw, peerAttachment),
    { local: true },
  );

  const localRpy = groupEndorseReply(hby, groupPre, rpySerder);
  runtime.reactor.processChunk(localRpy, { local: true });
  runtime.reactor.processEscrowsOnce();

  const attrs = rpyAttrs(rpySerder);
  const deliveries = yield* publishProposalEmbeds(
    runtime,
    member,
    groupSigningMembers(hby, groupPre),
    route,
    payload,
    { rpy: localRpy },
  );
  const accepted = replyRoleAccepted(hby, attrs.cid, attrs.role, attrs.eid);

  return {
    route,
    said: wrapperSaid,
    embedded: embeddedSaid,
    group: groupPre,
    accepted,
    deliveries,
  };
}

function* approveKelProposal(
  hby: Habery,
  runtime: AgentRuntime,
  exn: SerderKERI,
  route: MultisigKelRoute,
  args: MultisigJoinArgs,
): Operation<ApprovalResult | null> {
  const wrapperSaid = exn.said;
  if (!wrapperSaid) {
    return null;
  }
  const payload = payloadSection(exn.ked ?? {});
  const label = route === MULTISIG_ICP_ROUTE ? "icp" : route === MULTISIG_ROT_ROUTE ? "rot" : "ixn";
  const embeddedSad = embeddedSection(exn.ked ?? {})?.[label];
  if (!isRecord(embeddedSad)) {
    return null;
  }
  const serder = new SerderKERI({ sad: embeddedSad });
  const embeddedSaid = serder.said;
  const groupPre = groupPrefixFromProposal(route, payload, serder);
  const members = proposalMembers(route, payload);
  const member = route === MULTISIG_IXN_ROUTE ? localGroupMember(hby, groupPre) : findLocalMember(hby, members);
  if (!member) {
    throw new ValidationError(
      `No local member found for multisig proposal ${wrapperSaid}.`,
    );
  }

  if (!approvePrompt(args, route, groupPre, embeddedSaid ?? "<unknown>")) {
    return null;
  }

  if (route === MULTISIG_ICP_ROUTE) {
    const smids = stringArrayField(payload, "smids");
    const rmids = stringArrayField(payload, "rmids");
    const alias = chooseGroupAlias(hby, args, groupPre);
    hby.joinGroupHab(
      groupPre,
      alias,
      member,
      smids,
      rmids.length > 0 ? rmids : smids,
    );
  } else if (route === MULTISIG_ROT_ROUTE && !hby.habs.has(groupPre)) {
    const smids = stringArrayField(payload, "smids");
    const rmids = stringArrayField(payload, "rmids");
    const alias = chooseGroupAlias(hby, args, groupPre);
    hby.joinGroupHab(
      groupPre,
      alias,
      member,
      smids,
      rmids.length > 0 ? rmids : smids,
    );
  }

  const keys = groupEventKeys(hby, groupPre, serder);
  const smids = route === MULTISIG_IXN_ROUTE ? stringArrayField(payload, "smids") : proposalSigningMembers(payload);
  const sigers = signLocalGroupEvent(hby, serder, smids, keys);
  const localMessage = messagize(serder, { sigers, pipelined: true });
  const peerAttachment = multisigPathedAttachment(hby, wrapperSaid, label);
  runtime.reactor.processChunk(
    concatBytes(localMessage, peerAttachment),
    { local: true },
  );
  runtime.reactor.processEscrowsOnce();

  const deliveries = yield* publishProposal(
    runtime,
    member,
    members,
    route,
    label,
    payload,
    localMessage,
  );
  const accepted = eventAccepted(hby, serder);

  return {
    route,
    said: wrapperSaid,
    embedded: embeddedSaid ?? "",
    group: groupPre,
    accepted,
    deliveries,
  };
}

function* approveVdrProposal(
  hby: Habery,
  runtime: AgentRuntime,
  exn: SerderKERI,
  route: MultisigVdrRoute,
  args: MultisigJoinArgs,
): Operation<ApprovalResult | null> {
  const wrapperSaid = exn.said;
  if (!wrapperSaid) {
    return null;
  }
  const payload = payloadSection(exn.ked ?? {});
  const groupPre = requireText(stringField(payload, "gid") || undefined, "Group prefix");
  const groupHab = hby.habs.get(groupPre);
  if (!groupHab) {
    throw new ValidationError(`Group ${groupPre} must be joined before approving ${route}.`);
  }
  const member = localGroupMember(hby, groupPre);
  const embed = embeddedSection(exn.ked ?? {});
  const label = route === MULTISIG_VCP_ROUTE ? "vcp" : "iss";
  const embeddedSad = embed?.[label];
  const anchorSad = embed?.anc;
  if (!isRecord(embeddedSad) || !isRecord(anchorSad)) {
    return null;
  }

  const embeddedSerder = new SerderKERI({ sad: embeddedSad });
  const anchorSerder = new SerderKERI({ sad: anchorSad });
  const embeddedSaid = embeddedSerder.said ?? "";
  if (!approvePrompt(args, route, groupPre, embeddedSaid || "<unknown>")) {
    return null;
  }

  const smids = groupSigningMembers(hby, groupPre);
  const keys = groupEventKeys(hby, groupPre, anchorSerder);
  const sigers = signLocalGroupEvent(hby, anchorSerder, smids, keys);
  const localAnchor = messagize(anchorSerder, { sigers, pipelined: true });
  const peerAnchorAttachment = multisigPathedAttachment(hby, wrapperSaid, "anc");
  runtime.reactor.processChunk(
    concatBytes(localAnchor, peerAnchorAttachment),
    { local: true },
  );
  runtime.reactor.processEscrowsOnce();

  let accepted = false;
  let embeds: Record<string, Uint8Array>;
  if (route === MULTISIG_VCP_ROUTE) {
    accepted = approveRegistryIncept(runtime, groupHab, embeddedSerder, anchorSerder, args);
    embeds = {
      vcp: embeddedSerder.raw,
      anc: localAnchor,
    };
  } else {
    const acdcSad = embed?.acdc;
    if (!isRecord(acdcSad)) {
      return null;
    }
    const creder = new SerderACDC({ sad: acdcSad });
    accepted = approveCredentialIssue(runtime, hby, creder, embeddedSerder, anchorSerder);
    const seal = telCredentialSeal(embeddedSerder);
    embeds = {
      acdc: serializeCredential(
        creder,
        seal.prefixer,
        seal.seqner,
        seal.saider,
      ),
      iss: embeddedSerder.raw,
      anc: localAnchor,
    };
  }

  const deliveries = yield* publishProposalEmbeds(
    runtime,
    member,
    smids,
    route,
    payload,
    embeds,
  );

  return {
    route,
    said: wrapperSaid,
    embedded: embeddedSaid,
    group: groupPre,
    accepted,
    deliveries,
  };
}

function groupPrefixFromProposal(
  route: MultisigKelRoute,
  payload: Record<string, unknown>,
  serder: SerderKERI,
): string {
  if (route === MULTISIG_ICP_ROUTE) {
    return requireText(serder.pre ?? undefined, "Group prefix");
  }
  return requireText(stringField(payload, "gid") || serder.pre || undefined, "Group prefix");
}

function proposalMembers(
  route: MultisigKelRoute,
  payload: Record<string, unknown>,
): string[] {
  if (route === MULTISIG_IXN_ROUTE) {
    return stringArrayField(payload, "smids");
  }
  return uniqueMembers([
    ...stringArrayField(payload, "smids"),
    ...stringArrayField(payload, "rmids"),
  ]);
}

function proposalSigningMembers(payload: Record<string, unknown>): string[] {
  return stringArrayField(payload, "smids");
}

function approveRegistryIncept(
  runtime: AgentRuntime,
  groupHab: Hab,
  vserder: SerderKERI,
  anchorSerder: SerderKERI,
  args: MultisigJoinArgs,
): boolean {
  const seal = sourceSeal(anchorSerder);
  requireTevery(runtime).processEvent({
    serder: vserder,
    seqner: seal.seqner,
    saider: seal.saider,
  });
  requireRegery(runtime).processEscrows();

  const regk = requireSerderPrefix(vserder, "registry inception");
  const registryName = chooseRegistryName(args, regk);
  const cnfg = stringArrayField(vserder.ked ?? {}, "c");
  registerRegistry(requireRegery(runtime), registryName, groupHab, regk, {
    noBackers: cnfg.includes(TraitDex.NoBackers),
    estOnly: cnfg.includes(TraitDex.EstOnly),
  });

  const eventSaid = requireSerderSaid(vserder, "registry inception");
  if (telAccepted(runtime, regk, 0, eventSaid)) {
    markTelComplete(runtime, regk, 0, eventSaid);
  }
  return telAccepted(runtime, regk, 0, eventSaid);
}

function approveCredentialIssue(
  runtime: AgentRuntime,
  hby: Habery,
  creder: SerderACDC,
  iserder: SerderKERI,
  anchorSerder: SerderKERI,
): boolean {
  const seal = sourceSeal(anchorSerder);
  requireTevery(runtime).processEvent({
    serder: iserder,
    seqner: seal.seqner,
    saider: seal.saider,
  });
  requireRegery(runtime).processEscrows();

  const reger = requireReger(runtime);
  const vry = requireVerifier(runtime);
  const credentialer = new Credentialer(hby, { reger, vry });
  credentialer.validate(creder);
  const credentialSeal = telCredentialSeal(iserder);
  const verifierDecision = vry.processCredential({
    creder,
    prefixer: credentialSeal.prefixer,
    seqner: credentialSeal.seqner,
    saider: credentialSeal.saider,
  });
  if (verifierDecision.kind === "accept") {
    reger.ccrd.pin(requireCredentialSaid(creder), creder);
  }
  vry.processEscrows();

  const telPre = requireSerderPrefix(iserder, "credential issue");
  const eventSaid = requireSerderSaid(iserder, "credential issue");
  const sn = iserder.sn ?? 0;
  if (telAccepted(runtime, telPre, sn, eventSaid)) {
    markTelComplete(runtime, requireCredentialSaid(creder), sn, eventSaid);
  }
  return credentialer.complete(requireCredentialSaid(creder))
    || reger.saved.get([requireCredentialSaid(creder)]) !== null;
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

function registerRegistry(
  rgy: Regery,
  name: string,
  hab: Hab,
  regk: string,
  options: { noBackers: boolean; estOnly: boolean },
): void {
  rgy.reger.registries.add(regk);
  rgy.reger.regs.pin(
    name,
    new RegistryRecord({
      registryKey: regk,
      prefix: hab.pre,
    }),
  );
  if (!rgy.registries.has(name)) {
    rgy.registries.set(
      name,
      new Registry({
        name,
        hab,
        reger: rgy.reger,
        tvy: rgy.tvy,
        cues: rgy.cues,
        regk,
        noBackers: options.noBackers,
        estOnly: options.estOnly,
      }),
    );
  }
}

function sourceSeal(serder: SerderKERI): { seqner: NumberPrimitive; saider: Diger } {
  return {
    seqner: ordinal(serder.sn ?? 0),
    saider: new Diger({ qb64: requireSerderSaid(serder, "anchor event") }),
  };
}

function telCredentialSeal(serder: SerderKERI): { prefixer: Prefixer; seqner: NumberPrimitive; saider: Diger } {
  return {
    prefixer: new Prefixer({ qb64: requireSerderPrefix(serder, "credential TEL event") }),
    seqner: ordinal(serder.sn ?? 0),
    saider: new Diger({ qb64: requireSerderSaid(serder, "credential TEL event") }),
  };
}

function ordinal(num: number | bigint): NumberPrimitive {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new NumberPrimitive({ code: NumDex.Huge, raw });
}

function seqner(num: number | bigint): Seqner {
  const raw = new Uint8Array(16);
  let value = BigInt(num);
  for (let i = raw.length - 1; i >= 0; i--) {
    raw[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return new Seqner({ code: NumDex.Huge, raw });
}

function requireSerderPrefix(serder: SerderKERI, label: string): string {
  if (!serder.pre) {
    throw new ValidationError(`${label} is missing prefix.`);
  }
  return serder.pre;
}

function requireSerderSaid(serder: SerderKERI, label: string): string {
  if (!serder.said) {
    throw new ValidationError(`${label} is missing SAID.`);
  }
  return serder.said;
}

function requireCredentialSaid(creder: SerderACDC): string {
  if (!creder.said) {
    throw new ValidationError("Credential is missing SAID.");
  }
  return creder.said;
}

function telAccepted(runtime: AgentRuntime, pre: string, sn: number, eventSaid: string): boolean {
  return requireReger(runtime).tels.getOn(pre, sn)?.qb64 === eventSaid;
}

function markTelComplete(runtime: AgentRuntime, pre: string, sn: number, eventSaid: string): void {
  requireReger(runtime).ctel.pin([pre, seqner(sn).qb64], new Saider({ qb64: eventSaid }));
}

function requireReger(runtime: AgentRuntime): Reger {
  if (!(runtime.vdr.reger instanceof Reger)) {
    throw new ValidationError("VDR runtime did not open Reger.");
  }
  return runtime.vdr.reger;
}

function requireRegery(runtime: AgentRuntime): Regery {
  if (!(runtime.vdr.rgy instanceof Regery)) {
    throw new ValidationError("VDR runtime did not open Regery.");
  }
  return runtime.vdr.rgy;
}

function requireTevery(runtime: AgentRuntime): Tevery {
  if (!(runtime.vdr.tvy instanceof Tevery)) {
    throw new ValidationError("VDR runtime did not open Tevery.");
  }
  return runtime.vdr.tvy;
}

function requireVerifier(runtime: AgentRuntime): Verifier {
  if (!(runtime.vdr.vry instanceof Verifier)) {
    throw new ValidationError("VDR runtime did not open Verifier.");
  }
  return runtime.vdr.vry;
}

function groupEndorseReply(
  hby: Habery,
  groupPre: string,
  serder: SerderKERI,
): Uint8Array {
  const keys = groupEventKeys(hby, groupPre, serder);
  const sigers = signLocalGroupEvent(hby, serder, groupSigningMembers(hby, groupPre), keys);
  const kever = hby.db.getKever(groupPre);
  const estSaid = kever?.lastEst.d || kever?.said;
  const estEvent = estSaid ? hby.db.getEvtSerder(groupPre, estSaid) : null;
  const seqner = estEvent?.sner;
  if (!kever || !estSaid || !seqner) {
    throw new ValidationError(`Missing group establishment state for ${groupPre}.`);
  }
  return messagize(serder, {
    sigers,
    seal: { i: kever.prefixer, s: seqner, d: new Diger({ qb64: estSaid }) },
    pipelined: true,
  });
}

function rpyAttrs(serder: SerderKERI): { cid: string; role: string; eid: string } {
  const attrs = serder.ked?.a as Record<string, unknown> | undefined;
  const cid = typeof attrs?.cid === "string" ? attrs.cid : "";
  const role = typeof attrs?.role === "string" ? attrs.role : "";
  const eid = typeof attrs?.eid === "string" ? attrs.eid : "";
  if (!cid || !role || !eid) {
    throw new ValidationError("Multisig reply is missing cid, role, or eid.");
  }
  return { cid, role, eid };
}

function replyRoleAccepted(
  hby: Habery,
  cid: string,
  role: string,
  eid: string,
): boolean {
  return hby.db.ends.get([cid, role, eid])?.allowed === true;
}

function* waitForReplyAcceptance(
  hby: Habery,
  runtime: AgentRuntime,
  groupPre: string,
  role: string,
  eid: string,
  args: MultisigRpyArgs,
): Operation<boolean> {
  if (replyRoleAccepted(hby, groupPre, role, eid)) {
    return true;
  }
  const pollTurns = approvalTimeoutTurns(args.approvalTimeoutSeconds);
  for (let turn = 0; turn < pollTurns; turn++) {
    yield* processOnePendingApproval(hby, runtime, {
      ...args,
      group: groupPre,
      auto: true,
      pollTurns: 1,
      pollBudgetMs: 1_000,
    });
    if (replyRoleAccepted(hby, groupPre, role, eid)) {
      return true;
    }
    yield* processMailboxTurn(runtime, { budgetMs: 1_000 });
    runtime.reactor.processEscrowsOnce();
    yield* sleep(250);
  }
  return replyRoleAccepted(hby, groupPre, role, eid);
}

function groupEventKeys(
  hby: Habery,
  groupPre: string,
  serder: SerderKERI,
): string[] {
  if (
    serder.ilk === Ilks.icp
    || serder.ilk === Ilks.dip
    || serder.ilk === Ilks.rot
    || serder.ilk === Ilks.drt
  ) {
    return serder.verfers.map((verfer) => verfer.qb64);
  }
  const kever = hby.db.getKever(groupPre);
  if (!kever) {
    throw new ValidationError(
      `Group ${groupPre} must be accepted before joining interaction proposals.`,
    );
  }
  return kever.verfers.map((verfer) => verfer.qb64);
}

function eventAccepted(hby: Habery, serder: SerderKERI): boolean {
  const pre = serder.pre;
  const said = serder.said;
  const sn = serder.sn;
  if (!pre || !said || sn === null) {
    return false;
  }
  return hby.db.kels.getLast(pre, sn) === said;
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

function routeForKelEvent(serder: SerderKERI): MultisigKelRoute | null {
  switch (serder.ilk) {
    case Ilks.icp:
    case Ilks.dip:
      return MULTISIG_ICP_ROUTE;
    case Ilks.rot:
    case Ilks.drt:
      return MULTISIG_ROT_ROUTE;
    case Ilks.ixn:
      return MULTISIG_IXN_ROUTE;
    default:
      return null;
  }
}

function signLocalGroupEvent(
  hby: Habery,
  serder: SerderKERI,
  smids: readonly string[],
  keys: readonly string[],
): Siger[] {
  const sigers: Siger[] = [];
  for (const [index, mid] of smids.entries()) {
    const member = hby.habs.get(mid);
    const key = keys[index];
    if (!member || !key) {
      continue;
    }
    sigers.push(
      ...(member.mgr.sign(serder.raw, {
        pubs: [key],
        indexed: true,
        indices: [index],
      }) as Siger[]),
    );
  }
  if (sigers.length === 0) {
    throw new ValidationError("No local member key can sign this group event.");
  }
  return sigers;
}

function findLocalMember(hby: Habery, members: readonly string[]): Hab | null {
  for (const member of members) {
    const hab = hby.habs.get(member);
    if (hab) {
      return hab;
    }
  }
  return null;
}

function localGroupMember(hby: Habery, groupPre: string): Hab {
  const record = hby.db.getHab(groupPre);
  const member = record?.mid ? hby.habs.get(record.mid) : null;
  if (!member) {
    throw new ValidationError(`Group ${groupPre} is missing local member metadata.`);
  }
  return member;
}

function groupSigningMembers(hby: Habery, groupPre: string): string[] {
  const stored = hby.ks.getSmids(groupPre).map((tuple) => tuple[0].qb64);
  if (stored.length > 0) {
    return stored;
  }
  const record = hby.db.getHab(groupPre);
  return record?.smids ?? [];
}

function uniqueMembers(members: readonly string[]): string[] {
  return [...new Set(members.filter((member) => member.length > 0))];
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
  route: string,
  groupPre: string,
  embedded: string,
): boolean {
  if (args.auto) {
    return true;
  }
  console.log(JSON.stringify({ route, group: groupPre, embedded }, null, 2));
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
    args.codeTime,
    args.authenticate ?? false,
  );
  if (args.endpoint) {
    const receiptor = new Receiptor(hby);
    yield* receiptor.receipt(pre, { sn: kever.sn, auths });
  } else {
    const witDoer = new WitnessReceiptor(hby);
    yield* witDoer.submit(pre, { sn: kever.sn, auths });
  }
}

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
  const sink = queryTransportSink(runtime, hby, communicationHab);
  yield* processRuntimeUntil(
    runtime,
    () => runtime.delegating.complete(pre, kever.sn),
    { hab: communicationHab, sink, maxTurns: 512, pollMailbox: true },
  );
  return runtime.delegating.workflowStatus(pre, kever.sner.numh).phase;
}

function payloadSection(ked: Record<string, unknown>): Record<string, unknown> {
  return isRecord(ked.a) ? ked.a : {};
}

function embeddedSection(ked: Record<string, unknown>): Record<string, unknown> | null {
  if (isRecord(ked.e)) {
    return ked.e;
  }
  const attrs = payloadSection(ked);
  return isRecord(attrs.e) ? attrs.e : null;
}

function stringArrayField(record: Record<string, unknown>, field: string): string[] {
  const value = record[field];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringField(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function* sleep(ms: number): Operation<void> {
  yield* action<void>((resolve) => {
    const id = setTimeout(resolve, ms);
    return () => clearTimeout(id);
  });
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
