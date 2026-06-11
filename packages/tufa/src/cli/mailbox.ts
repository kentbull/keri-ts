/**
 * Mailbox operator commands.
 *
 * These commands expose the maintainer and operator workflows around mailbox
 * authorization, cursor inspection, and provider debugging. They are thin CLI
 * seams over the runtime and databaser contracts documented elsewhere; the goal
 * here is to keep the operational flow obvious.
 */
import { concatBytes } from "cesr-ts";
import { action, type Operation } from "effection";
import {
  type AgentRuntime,
  buildCesrStreamRequest,
  type CesrBodyMode,
  endpointRoleAccepted,
  fetchEndpointUrls,
  fetchResponseHandle,
  type Hab,
  type Habery,
  ingestKeriBytes,
  isLocalGroupHab,
  loadAcceptedEndpointRole,
  makeNowIso8601,
  normalizeCesrBodyMode,
  Organizer,
  preferredUrl,
  processRuntimeTurn,
  proposeGroupEndpointRole,
  Roles,
  TopicsRecord,
  ValidationError,
} from "keri-ts/runtime";
import { canonicalOrigin, configFileCandidates, mailboxAdminUrl } from "../operator/host-planning.ts";
import {
  collectConfiguredMailboxes,
  collectMailboxDebugReport,
  type MailboxDebugReport,
  normalizeMailboxTopic,
} from "../operator/mailbox-debug.ts";
import { reconcileMailboxHostStartup, resolveMailboxHostStartup } from "../operator/mailbox-startup.ts";
import { runMailboxHost } from "../roles/mailbox.ts";
import { type CommandHaberyOptions, withExistingHab, withHabAndAgentRuntime } from "./support/context.ts";
import { ensureHby } from "./support/existing.ts";
import { writeJsonLine, writeTextLines } from "./support/rendering.ts";

type MultisigMailboxMode = "propose" | "complete";

interface MailboxBaseArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
  outboxer?: boolean;
  cesrBodyMode?: CesrBodyMode;
}

interface MailboxStartArgs extends MailboxBaseArgs {
  configFile?: string;
  url?: string;
  datetime?: string;
  port?: number;
  listenHost?: string;
}

/** Shared mailbox add/remove CLI inputs. */
interface MailboxAddRemoveArgs extends MailboxBaseArgs {
  mailbox?: string;
  multisigMode?: MultisigMailboxMode;
}

/** Mailbox topic cursor override inputs for `mailbox update`. */
interface MailboxUpdateArgs extends MailboxBaseArgs {
  witness?: string;
  topic?: string;
  index?: number;
}

/** Mailbox inspection inputs for `mailbox debug`. */
interface MailboxDebugArgs extends MailboxBaseArgs {
  witness?: string;
  verbose?: boolean;
}

/** Authorize one remote mailbox for the selected local controller. */
export function* mailboxAddCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs = parseMailboxAddRemoveArgs(args);
  yield* withMailboxWorkflow(commandArgs, true);
}

/** Revoke one remote mailbox for the selected local controller. */
export function* mailboxRemoveCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs = parseMailboxAddRemoveArgs(args);
  yield* withMailboxWorkflow(commandArgs, false);
}

/**
 * Start one mailbox host, creating and reconciling the selected mailbox AID as
 * needed before handing off to the shared indirect-mode runtime host.
 */
export function* mailboxStartCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs = parseMailboxStartArgs(args);
  const startConfig = loadMailboxStartConfig(commandArgs);
  const ensured = yield* ensureHby(
    commandArgs.name!,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: false,
      cesrBodyMode: commandArgs.cesrBodyMode,
    },
  );
  const hby = ensured.hby;

  try {
    const startup = resolveMailboxHostStartup(hby, commandArgs, startConfig);
    yield* reconcileMailboxHostStartup(hby, startup);

    writeTextLines([
      `Mailbox Prefix  ${startup.hab.pre}`,
      `Advertised URL  ${startup.startup.url}`,
      `Mailbox Admin  ${startup.mailboxAdminUrl}`,
      `Mailbox OOBI   ${startup.mailboxOobi}`,
      `Listening On   ${startup.listenHost}:${startup.port}`,
      `Keystore       ${ensured.created ? "created" : "reused"}`,
      `Mailbox AID    ${startup.aidCreated ? "created" : "reused"}`,
    ]);

    yield* runMailboxHost(hby, {
      port: startup.port,
      listenHost: startup.listenHost,
      serviceHab: startup.hab,
      hostedPrefixes: [startup.hab.pre],
      seedHabs: [startup.hab],
    });
  } finally {
    yield* hby.close();
  }
}

/**
 * Print locally authorized mailboxes for the selected controller.
 *
 * The output includes alias, mailbox AID, preferred URL, and the derived
 * mailbox role OOBI when location data is present.
 */
export function* mailboxListCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs = parseMailboxBaseArgs(args);

  yield* withExistingHab(
    commandArgs,
    commandArgs.alias,
    mailboxOpenOptions(commandArgs),
    function*({ hby, hab }) {
      for (const row of collectConfiguredMailboxes(hby, hab)) {
        const oobi = row.url.length > 0 ? `${canonicalOrigin(row.url)}/oobi/${hab.pre}/mailbox/${row.eid}` : "";
        const fields: string[] = [
          row.alias,
          row.eid,
          row.url,
          oobi,
        ].filter((item) => item.length > 0);
        console.log(fields.join(" "));
      }
    },
  );
}

/**
 * Override one local mailbox cursor row in `tops.`.
 *
 * This is a maintainer/debugging tool, not a normal protocol workflow.
 */
export function* mailboxUpdateCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: MailboxUpdateArgs = {
    ...parseMailboxBaseArgs(args),
    witness: args.witness as string | undefined,
    topic: args.topic as string | undefined,
    index: args.index !== undefined ? Number(args.index) : undefined,
  };
  if (!commandArgs.witness) {
    throw new ValidationError("Mailbox or witness AID is required.");
  }
  if (!commandArgs.topic) {
    throw new ValidationError("Mailbox topic is required.");
  }
  if (!Number.isFinite(commandArgs.index)) {
    throw new ValidationError("Mailbox topic index is required.");
  }

  const witness = commandArgs.witness;
  const index = Number(commandArgs.index);
  const topic = normalizeMailboxTopic(commandArgs.topic);

  yield* withExistingHab(
    commandArgs,
    commandArgs.alias,
    mailboxOpenOptions(commandArgs),
    function*({ hby, hab }) {
      const record = hby.db.tops.get([hab.pre, witness])
        ?? new TopicsRecord({ topics: {} });
      record.topics[topic] = index;
      hby.db.tops.pin([hab.pre, witness], record);
      console.log(`${witness} ${topic} ${record.topics[topic]}`);
    },
  );
}

/**
 * Inspect local mailbox state and query a remote mailbox endpoint with `mbx`.
 *
 * This command is intended for operator debugging:
 * - local authorized mailbox view
 * - local `tops.` cursor rows
 * - optional Tufa-only outbox backlog
 * - remote mailbox SSE output
 */
export function* mailboxDebugCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: MailboxDebugArgs = {
    ...parseMailboxBaseArgs(args),
    witness: args.witness as string | undefined,
    verbose: args.verbose as boolean | undefined,
  };
  if (!commandArgs.witness) {
    throw new ValidationError("Mailbox or witness AID is required.");
  }
  const witness = commandArgs.witness;

  yield* withExistingHab(
    commandArgs,
    commandArgs.alias,
    mailboxOpenOptions(commandArgs),
    function*({ hby, hab }) {
      const report = yield* collectMailboxDebugReport(hby, hab, witness);
      renderMailboxDebugReport(report, commandArgs.verbose ?? false);
    },
  );
}

function renderMailboxDebugReport(
  report: MailboxDebugReport,
  verbose: boolean,
): void {
  const lines: string[] = ["Configured Mailboxes"];
  for (const row of report.configuredMailboxes) {
    lines.push(`${row.alias} ${row.eid} ${row.url}`.trim());
  }

  lines.push("", "Local Index per Topic");
  if (report.localTopics) {
    for (const [topic, idx] of Object.entries(report.localTopics)) {
      lines.push(`Topic ${topic}: ${idx}`);
    }
  } else {
    lines.push("No local index");
  }

  lines.push("", "Outbox Pending");
  if (!report.outboxEnabled) {
    lines.push("Outboxer disabled");
  } else {
    for (const pending of report.outboxPending) {
      lines.push(`${pending.topic} ${pending.eid} attempts=${pending.attempts}`);
    }
  }

  if (report.messages) {
    lines.push("", "Messages");
    for (const event of report.messages) {
      if (!verbose) {
        lines.push(`${event.topic} ${event.idx}: ${event.msg.slice(0, 20)}`);
      } else {
        lines.push(`Topic: ${event.topic}`);
        lines.push(`Index: ${event.idx}`);
        lines.push(event.msg);
        lines.push("");
      }
    }
  }

  writeTextLines(lines);
}

function* withMailboxWorkflow(
  args: MailboxAddRemoveArgs,
  allow: boolean,
): Operation<void> {
  yield* withHabAndAgentRuntime(
    args,
    args.alias,
    mailboxOpenOptions(args),
    function*({ hby, hab, runtime }) {
      const mailboxAid = resolveMailboxAid(hby, args.mailbox!);
      const endpointUrl = preferredUrl(fetchEndpointUrls(hby, mailboxAid));
      if (!endpointUrl) {
        throw new ValidationError(
          `No endpoint URL is stored for mailbox ${mailboxAid}.`,
        );
      }

      if (isLocalGroupHab(hby, hab)) {
        if (!allow) {
          throw new ValidationError(
            "Group mailbox removal is not supported by mailbox remove; use multisig endpoint-role cut workflow.",
          );
        }
        if (!args.multisigMode) {
          throw new ValidationError(
            "Group mailbox add requires --multisig-mode propose or --multisig-mode complete.",
          );
        }
        if (args.multisigMode === "propose") {
          const result = yield* proposeGroupEndpointRole(runtime, hab, {
            eid: mailboxAid,
            role: Roles.mailbox,
            allow: true,
          });
          writeJsonLine({
            route: result.route,
            said: result.said,
            group: result.group,
            accepted: result.accepted,
            deliveries: result.deliveries,
            attachmentBytes: result.attachmentBytes,
          });
          return;
        }
        if (!endpointRoleAccepted(hby, hab.pre, Roles.mailbox, mailboxAid)) {
          throw new ValidationError(
            `Mailbox role for ${mailboxAid} is not yet approved for group ${hab.pre}.`,
          );
        }
        const rpy = loadAcceptedEndpointRole(hab, mailboxAid, Roles.mailbox);
        yield* completeMailboxAdmin(runtime, hby, hab, mailboxAid, endpointUrl, rpy, allow);
        console.log(`added ${mailboxAid}`);
        return;
      }

      if (args.multisigMode) {
        throw new ValidationError("--multisig-mode is only valid for local group aliases.");
      }

      const existing = hby.db.ends.get([hab.pre, Roles.mailbox, mailboxAid]);
      const rpy = allow && existing?.allowed
        ? hab.loadEndRole(hab.pre, mailboxAid, Roles.mailbox)
        : hab.makeEndRole(mailboxAid, Roles.mailbox, allow);
      if (rpy.length === 0) {
        throw new ValidationError(
          `No accepted mailbox role reply is available for ${hab.pre}.`,
        );
      }
      yield* completeMailboxAdmin(runtime, hby, hab, mailboxAid, endpointUrl, rpy, allow);

      console.log(`${allow ? "added" : "removed"} ${mailboxAid}`);
    },
  );
}

function* completeMailboxAdmin(
  runtime: AgentRuntime,
  hby: Habery,
  hab: Hab,
  mailboxAid: string,
  endpointUrl: string,
  rpy: Uint8Array,
  allow: boolean,
): Operation<void> {
  const submission = collectMailboxAdminSubmission(hby, hab.pre);
  const response = yield* postMailboxAdmin(
    endpointUrl,
    submission,
    rpy,
  );
  if (!response.ok) {
    throw new ValidationError(
      `Mailbox admin request failed with HTTP ${response.status}: ${response.body}`,
    );
  }

  ingestKeriBytes(runtime, rpy);
  yield* processRuntimeTurn(runtime, { hab, pollMailbox: false });

  const end = hby.db.ends.get([hab.pre, Roles.mailbox, mailboxAid]);
  if (allow && !end?.allowed) {
    throw new ValidationError(
      "Mailbox add was not accepted into local state.",
    );
  }
  if (!allow && (!end || end.allowed)) {
    throw new ValidationError(
      "Mailbox removal was not accepted into local state.",
    );
  }

  if (!allow) {
    hby.obx.cancelMailbox(mailboxAid, makeNowIso8601());
  }
}

/** Normalize mailbox CLI shared storage/runtime open arguments. */
function parseMailboxBaseArgs(args: Record<string, unknown>): MailboxBaseArgs {
  return {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    outboxer: args.outboxer as boolean | undefined,
    cesrBodyMode: normalizeCesrBodyMode(
      args.cesrBodyMode as string | undefined,
    ),
  };
}

/** Parse mailbox add/remove arguments and require a target mailbox identifier. */
function parseMailboxAddRemoveArgs(
  args: Record<string, unknown>,
): MailboxAddRemoveArgs {
  const parsed = {
    ...parseMailboxBaseArgs(args),
    mailbox: args.mailbox as string | undefined,
    multisigMode: parseMultisigMode(args.multisigMode as string | undefined),
  };
  if (!parsed.mailbox) {
    throw new ValidationError("Mailbox AID or alias is required.");
  }
  return parsed;
}

function parseMultisigMode(value: string | undefined): MultisigMailboxMode | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "propose" || value === "complete") {
    return value;
  }
  throw new ValidationError("--multisig-mode must be propose or complete.");
}

/** Parse `mailbox start` arguments and enforce CLI pairwise invariants. */
function parseMailboxStartArgs(
  args: Record<string, unknown>,
): MailboxStartArgs {
  const parsed: MailboxStartArgs = {
    ...parseMailboxBaseArgs(args),
    configFile: args.configFile as string | undefined,
    url: args.url as string | undefined,
    datetime: args.datetime as string | undefined,
    port: args.port !== undefined ? Number(args.port) : undefined,
    listenHost: args.listenHost as string | undefined,
  };
  if (!parsed.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!parsed.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  if ((parsed.url && !parsed.datetime) || (!parsed.url && parsed.datetime)) {
    throw new ValidationError(
      "--url and --datetime must be provided together.",
    );
  }
  if (
    parsed.port !== undefined
    && (!Number.isFinite(parsed.port) || parsed.port < 1 || parsed.port > 65535)
  ) {
    throw new ValidationError("Port must be between 1 and 65535.");
  }
  return parsed;
}

/**
 * Load mailbox-start config JSON without creating missing config files.
 *
 * `mailbox start` treats config as read-only preload input, so it resolves a
 * small set of likely config paths and only reads when one already exists.
 */
function loadMailboxStartConfig(
  args: MailboxStartArgs,
): Record<string, unknown> | null {
  if (!args.configFile) {
    return null;
  }

  for (
    const path of configFileCandidates(args.configFile, {
      headDirPath: args.headDirPath,
      compat: args.compat ?? false,
      home: Deno.env.get("HOME") ?? undefined,
    })
  ) {
    try {
      return JSON.parse(Deno.readTextFileSync(path)) as Record<string, unknown>;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        continue;
      }
      if (error instanceof SyntaxError) {
        throw new ValidationError(
          `Invalid JSON configuration at ${path}: ${error.message}`,
        );
      }
      throw error;
    }
  }

  throw new ValidationError(`Config file '${args.configFile}' was not found.`);
}

function mailboxOpenOptions(args: MailboxBaseArgs): CommandHaberyOptions {
  return {
    compat: args.compat ?? false,
    readonly: false,
    skipConfig: false,
    skipSignator: false,
    outboxer: args.outboxer ?? false,
    cesrBodyMode: args.cesrBodyMode,
  };
}

/**
 * Resolve a mailbox input to its mailbox AID.
 *
 * Resolution order matches the EXN send path:
 * - exact AID when already known
 * - otherwise exact organizer alias lookup
 */
function resolveMailboxAid(
  hby: Habery,
  mailbox: string,
): string {
  if (hby.db.getKever(mailbox)) {
    return mailbox;
  }

  const matches = new Organizer(hby).findExact("alias", mailbox);
  if (matches.length === 0) {
    throw new ValidationError(`no contact found with alias '${mailbox}'`);
  }
  if (matches.length > 1) {
    throw new ValidationError(
      `multiple contacts match alias '${mailbox}', use prefix instead`,
    );
  }
  return matches[0]!.id;
}

/**
 * Collect mailbox-admin replay material in both normalized and legacy shapes.
 *
 * `replay` is the verifier-ready stream used by raw CESR ingress.
 * `kel`/`delkel` preserve the legacy multipart wrapper contract used by
 * existing KERIpy mailbox admin hosts.
 */
function collectMailboxAdminSubmission(
  hby: Habery,
  pre: string,
): {
  replay: Uint8Array;
  kel: Uint8Array;
  delkel: Uint8Array;
} {
  const kever = hby.db.getKever(pre);
  const delkel = kever ? concatBytes(...hby.db.cloneDelegation(kever)) : new Uint8Array();
  const kel = concatBytes(...hby.db.clonePreIter(pre));
  return {
    replay: concatBytes(delkel, kel),
    kel,
    delkel,
  };
}

/**
 * Submit one mailbox add/remove request to the remote mailbox provider.
 *
 * Wire shape:
 * - raw `application/cesr` body
 * - controller replay plus terminal signed `rpy`
 * - response body surfaced verbatim on failure for debugging
 */
function* postMailboxAdmin(
  url: string,
  submission: {
    replay: Uint8Array;
    kel: Uint8Array;
    delkel: Uint8Array;
  },
  rpy: Uint8Array,
): Operation<{ ok: boolean; status: number; body: string }> {
  const raw = yield* postMailboxAdminCesr(
    url,
    concatBytes(submission.replay, rpy),
  );
  if (raw.ok || (raw.status !== 406 && raw.status !== 415)) {
    return raw;
  }
  return yield* postMailboxAdminMultipart(url, submission, rpy);
}

function* postMailboxAdminCesr(
  url: string,
  bytes: Uint8Array,
): Operation<{ ok: boolean; status: number; body: string }> {
  const request = buildCesrStreamRequest(bytes);
  const { response } = yield* fetchResponseHandle(mailboxAdminUrl(url), {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });

  const body = yield* action<string>((resolve, reject) => {
    response.text().then(resolve).catch(reject);
    return () => {};
  });
  return { ok: response.ok, status: response.status, body };
}

function* postMailboxAdminMultipart(
  url: string,
  submission: {
    kel: Uint8Array;
    delkel: Uint8Array;
  },
  rpy: Uint8Array,
): Operation<{ ok: boolean; status: number; body: string }> {
  const form = new FormData();
  form.append("kel", new TextDecoder().decode(submission.kel));
  if (submission.delkel.length > 0) {
    form.append("delkel", new TextDecoder().decode(submission.delkel));
  }
  form.append("rpy", new TextDecoder().decode(rpy));

  const { response } = yield* fetchResponseHandle(mailboxAdminUrl(url), {
    method: "POST",
    body: form,
  });

  const body = yield* action<string>((resolve, reject) => {
    response.text().then(resolve).catch(reject);
    return () => {};
  });
  return { ok: response.ok, status: response.status, body };
}
