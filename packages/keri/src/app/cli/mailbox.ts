/**
 * Mailbox operator commands.
 *
 * These commands expose the maintainer and operator workflows around mailbox
 * authorization, cursor inspection, and provider debugging. They are thin CLI
 * seams over the runtime and databaser contracts documented elsewhere; the goal
 * here is to keep the operational flow obvious.
 */
import { join } from "jsr:@std/path";
import { action, type Operation } from "npm:effection@^3.6.0";
import { concatBytes } from "../../../../cesr/mod.ts";
import { ValidationError } from "../../core/errors.ts";
import { TopicsRecord } from "../../core/records.ts";
import { EndpointRoles, Roles } from "../../core/roles.ts";
import { makeNowIso8601 } from "../../time/mod.ts";
import { createAgentRuntime, ingestKeriBytes, processRuntimeTurn } from "../agent-runtime.ts";
import { buildCesrRequest, type CesrBodyMode, normalizeCesrBodyMode } from "../cesr-http.ts";
import type { Habery } from "../habbing.ts";
import { fetchResponseHandle } from "../httping.ts";
import { endpointBasePath, fetchEndpointUrls, preferredUrl } from "../mailboxing.ts";
import { Organizer } from "../organizing.ts";
import { runIndirectHost } from "./agent.ts";
import { ensureHby, setupHby } from "./common/existing.ts";

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

interface MailboxStartupMaterial {
  url: string;
  datetime?: string;
  source: "cli" | "config" | "state";
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
  const startConfig = yield* loadMailboxStartConfig(commandArgs);
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
  let aidCreated = false;

  try {
    let hab = hby.habByName(commandArgs.alias!);
    const configured = resolveConfiguredStartup(
      commandArgs,
      startConfig,
      commandArgs.alias!,
    );

    if (!hab && !configured) {
      throw new ValidationError(
        "Mailbox startup requires --url and --datetime, or a matching config alias section, when the alias does not already exist.",
      );
    }

    if (!hab) {
      hab = hby.makeHab(commandArgs.alias!, undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      aidCreated = true;
    }

    validateMailboxHabitat(hby, hab);
    const startup = resolveEffectiveStartupMaterial(hby, hab.pre, configured);
    validateHostedBasePathClaim(hby, hab.pre, startup.url);

    if (startup.source !== "state") {
      yield* reconcileMailboxIdentity(hby, hab, startup);
    } else if (!mailboxIdentityComplete(hby, hab.pre, startup.url)) {
      throw new ValidationError(
        "Selected alias does not have complete mailbox startup state and no authoritative --url/--datetime or config material was provided.",
      );
    }

    const listenHost = resolveListenHost(commandArgs.listenHost, startup.url);
    const port = resolveListenPort(commandArgs.port, startup.url);
    const baseUrl = startup.url.replace(/\/$/, "");

    console.log(`Mailbox Prefix  ${hab.pre}`);
    console.log(`Advertised URL  ${startup.url}`);
    console.log(`Mailbox Admin  ${baseUrl}/mailboxes`);
    console.log(
      `Mailbox OOBI   ${startup.url.replace(/\/$/, "")}/oobi/${hab.pre}/mailbox/${hab.pre}`,
    );
    console.log(`Listening On   ${listenHost}:${port}`);
    console.log(`Keystore       ${ensured.created ? "created" : "reused"}`);
    console.log(`Mailbox AID    ${aidCreated ? "created" : "reused"}`);

    yield* runIndirectHost(hby, {
      port,
      listenHost,
      serviceHab: hab,
      hostedPrefixes: [hab.pre],
      seedHabs: [hab],
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
  const hby = yield* openExistingMailboxHabery(commandArgs);

  try {
    const hab = requireHab(hby, commandArgs.alias);
    const organizer = new Organizer(hby);
    for (
      const [keys, end] of hby.db.ends.getTopItemIter(
        [hab.pre, Roles.mailbox],
        {
          topive: true,
        },
      )
    ) {
      const eid = keys[2];
      if (!eid || !end.allowed) {
        continue;
      }
      const contact = organizer.get(eid);
      const alias = typeof contact?.alias === "string" ? contact.alias : "";
      const url = preferredUrl(fetchEndpointUrls(hby, eid)) ?? "";
      const oobi = url.length > 0
        ? `${url.replace(/\/$/, "")}/oobi/${hab.pre}/mailbox/${eid}`
        : "";
      const fields: string[] = [
        alias,
        eid,
        url,
        oobi,
      ].filter((item) => item.length > 0);
      console.log(fields.join(" "));
    }
  } finally {
    yield* hby.close();
  }
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

  const topic = normalizeTopic(commandArgs.topic);
  const hby = yield* openExistingMailboxHabery(commandArgs);

  try {
    const hab = requireHab(hby, commandArgs.alias);
    const record = hby.db.tops.get([hab.pre, commandArgs.witness])
      ?? new TopicsRecord({ topics: {} });
    record.topics[topic] = Number(commandArgs.index);
    hby.db.tops.pin([hab.pre, commandArgs.witness], record);
    console.log(`${commandArgs.witness} ${topic} ${record.topics[topic]}`);
  } finally {
    yield* hby.close();
  }
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

  const hby = yield* openExistingMailboxHabery(commandArgs);
  try {
    const hab = requireHab(hby, commandArgs.alias);
    console.log("Configured Mailboxes");
    const organizer = new Organizer(hby);
    for (
      const [keys, end] of hby.db.ends.getTopItemIter(
        [hab.pre, Roles.mailbox],
        {
          topive: true,
        },
      )
    ) {
      const eid = keys[2];
      if (!eid || !end.allowed) {
        continue;
      }
      const contact = organizer.get(eid);
      const url = preferredUrl(fetchEndpointUrls(hby, eid)) ?? "";
      console.log(`${contact?.alias ?? ""} ${eid} ${url}`.trim());
    }

    console.log("");
    console.log("Local Index per Topic");
    const witrec = hby.db.tops.get([hab.pre, commandArgs.witness]);
    if (witrec) {
      for (const [topic, idx] of Object.entries(witrec.topics)) {
        console.log(`Topic ${topic}: ${idx}`);
      }
    } else {
      console.log("No local index");
    }

    console.log("");
    console.log("Outbox Pending");
    if (!hby.obx.enabled) {
      console.log("Outboxer disabled");
    } else {
      for (const pending of hby.obx.iterPending()) {
        if (pending.target.eid !== commandArgs.witness) {
          continue;
        }
        console.log(
          `${pending.message.topic} ${pending.target.eid} attempts=${pending.target.attempts ?? 0}`,
        );
      }
    }

    const endpointUrl = preferredUrl(
      fetchEndpointUrls(hby, commandArgs.witness),
    );
    if (!endpointUrl) {
      return;
    }

    const topics = witrec?.topics ?? {
      "/challenge": 0,
      "/reply": 0,
      "/receipt": 0,
      "/replay": 0,
    };
    const cursor: Record<string, number> = {};
    for (const [topic, idx] of Object.entries(topics)) {
      cursor[topic] = idx + 1;
    }

    const response = yield* fetchMailboxDebug(
      endpointUrl,
      hab.query(
        hab.pre,
        commandArgs.witness,
        { topics: cursor },
        "mbx",
      ),
      hby.cesrBodyMode,
      commandArgs.witness,
    );

    console.log("");
    console.log("Messages");
    for (const event of parseMailboxSse(response)) {
      if (!commandArgs.verbose) {
        console.log(`${event.topic} ${event.idx}: ${event.msg.slice(0, 20)}`);
      } else {
        console.log(`Topic: ${event.topic}`);
        console.log(`Index: ${event.idx}`);
        console.log(event.msg);
        console.log("");
      }
    }
  } finally {
    yield* hby.close();
  }
}

function* withMailboxWorkflow(
  args: MailboxAddRemoveArgs,
  allow: boolean,
): Operation<void> {
  const hby = yield* openExistingMailboxHabery(args);

  try {
    const hab = requireHab(hby, args.alias);
    const mailboxAid = resolveMailboxAid(hby, args.mailbox!);
    const endpointUrl = preferredUrl(fetchEndpointUrls(hby, mailboxAid));
    if (!endpointUrl) {
      throw new ValidationError(
        `No endpoint URL is stored for mailbox ${mailboxAid}.`,
      );
    }

    const kel = collectReplay(hby, hab.pre);
    const rpy = hab.makeEndRole(mailboxAid, Roles.mailbox, allow);
    const response = yield* postMailboxAdmin(endpointUrl, kel, rpy);
    if (!response.ok) {
      throw new ValidationError(
        `Mailbox admin request failed with HTTP ${response.status}: ${response.body}`,
      );
    }

    const runtime = yield* createAgentRuntime(hby, { mode: "local" });
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

    console.log(`${allow ? "added" : "removed"} ${mailboxAid}`);
  } finally {
    yield* hby.close();
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
  };
  if (!parsed.mailbox) {
    throw new ValidationError("Mailbox AID or alias is required.");
  }
  return parsed;
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
function* loadMailboxStartConfig(
  args: MailboxStartArgs,
): Operation<Record<string, unknown> | null> {
  if (!args.configFile) {
    return null;
  }

  for (
    const path of mailboxConfigCandidates(
      args.configFile,
      args.headDirPath,
      args.compat ?? false,
    )
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

function mailboxConfigCandidates(
  configFile: string,
  headDirPath?: string,
  compat = false,
): string[] {
  const fileName = configFile.endsWith(".json")
    ? configFile
    : `${configFile}.json`;
  const candidates = new Set<string>();
  candidates.add(configFile);
  candidates.add(fileName);

  const homes = [Deno.env.get("HOME")].filter((value): value is string => !!value);
  const suffixes = compat ? [".keri/cf"] : [".tufa/cf", "keri/cf"];

  if (headDirPath) {
    for (const suffix of suffixes) {
      candidates.add(join(headDirPath, suffix, fileName));
    }
  }
  for (const home of homes) {
    for (const suffix of suffixes) {
      candidates.add(join(home, suffix, fileName));
    }
  }
  candidates.add(join("/usr/local/var/keri/cf", fileName));

  return [...candidates];
}

function resolveConfiguredStartup(
  args: MailboxStartArgs,
  config: Record<string, unknown> | null,
  alias: string,
): MailboxStartupMaterial | null {
  const cli = args.url && args.datetime
    ? {
      url: normalizeMailboxUrl(args.url),
      datetime: validateStartupDatetime(args.datetime),
      source: "cli" as const,
    }
    : null;

  if (!config) {
    return cli;
  }
  const section = config[alias];
  if (!section || typeof section !== "object") {
    if (cli) {
      return cli;
    }
    throw new ValidationError(
      `Config file does not contain a '${alias}' mailbox startup section.`,
    );
  }

  const data = section as Record<string, unknown>;
  const dt = typeof data.dt === "string" ? data.dt : null;
  if (!dt) {
    throw new ValidationError(
      `Config section '${alias}' is missing dt.`,
    );
  }
  const curls = Array.isArray(data.curls)
    ? data.curls.filter((entry): entry is string => typeof entry === "string")
    : [];
  const httpUrls = curls
    .map((url) => normalizeMailboxUrl(url))
    .filter((url) => {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    });
  if (httpUrls.length !== 1) {
    throw new ValidationError(
      `Config section '${alias}' must provide exactly one HTTP(S) curl.`,
    );
  }
  const configured = {
    url: httpUrls[0]!,
    datetime: validateStartupDatetime(dt),
    source: "config" as const,
  };
  if (
    cli
    && (cli.url !== configured.url || cli.datetime !== configured.datetime)
  ) {
    throw new ValidationError(
      `Config section '${alias}' conflicts with explicit --url/--datetime startup material.`,
    );
  }
  return configured;
}

function resolveEffectiveStartupMaterial(
  hby: Habery,
  pre: string,
  configured: MailboxStartupMaterial | null,
): MailboxStartupMaterial {
  if (configured) {
    return configured;
  }
  const url = storedMailboxUrl(hby, pre);
  if (!url) {
    throw new ValidationError(
      "Selected alias does not have complete mailbox startup state and no config or CLI startup material was provided.",
    );
  }
  return { url, source: "state" };
}

function validateMailboxHabitat(
  hby: Habery,
  hab: ReturnType<typeof requireHab>,
): void {
  const record = hby.db.getHab(hab.pre);
  if (!hab.kever) {
    throw new ValidationError(
      `Mailbox alias ${hab.name} is missing accepted key state.`,
    );
  }
  if (hab.kever.transferable) {
    throw new ValidationError(
      `Mailbox alias ${hab.name} must be non-transferable.`,
    );
  }
  if (
    record?.mid || (record?.smids?.length ?? 0) > 0
    || (record?.rmids?.length ?? 0) > 0
  ) {
    throw new ValidationError(
      `Mailbox alias ${hab.name} must be a local single-identifier habitat.`,
    );
  }
}

function mailboxIdentityComplete(
  hby: Habery,
  pre: string,
  url: string,
): boolean {
  return storedMailboxUrl(hby, pre) === normalizeMailboxUrl(url)
    && roleEnabled(hby, pre, EndpointRoles.controller, pre)
    && roleEnabled(hby, pre, EndpointRoles.mailbox, pre);
}

function roleEnabled(
  hby: Habery,
  cid: string,
  role: string,
  eid: string,
): boolean {
  const end = hby.db.ends.get([cid, role, eid]);
  return !!(end?.allowed || end?.enabled);
}

function storedMailboxUrl(
  hby: Habery,
  pre: string,
): string | null {
  const urls = fetchEndpointUrls(hby, pre);
  const candidates = [urls.https, urls.http]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map((url) => normalizeMailboxUrl(url));
  if (candidates.length === 0) {
    return null;
  }
  if (candidates.length > 1) {
    throw new ValidationError(
      `Local mailbox alias ${pre} has more than one HTTP(S) URL; use one authoritative URL for mailbox start.`,
    );
  }
  return candidates[0]!;
}

function validateHostedBasePathClaim(
  hby: Habery,
  pre: string,
  url: string,
): void {
  const targetBasePath = endpointBasePath(url);
  for (const eid of hby.prefixes) {
    if (eid === pre) {
      continue;
    }
    const other = preferredUrl(fetchEndpointUrls(hby, eid));
    if (!other) {
      continue;
    }
    if (endpointBasePath(other) === targetBasePath) {
      throw new ValidationError(
        `Mailbox base path ${targetBasePath} is already claimed by local prefix ${eid}.`,
      );
    }
  }
}

function* reconcileMailboxIdentity(
  hby: Habery,
  hab: ReturnType<typeof requireHab>,
  startup: MailboxStartupMaterial,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  const scheme = new URL(startup.url).protocol === "https:" ? "https" : "http";
  ingestKeriBytes(
    runtime,
    hab.makeLocScheme(startup.url, hab.pre, scheme, startup.datetime),
  );
  ingestKeriBytes(
    runtime,
    hab.makeEndRole(hab.pre, EndpointRoles.controller, true, startup.datetime),
  );
  ingestKeriBytes(
    runtime,
    hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true, startup.datetime),
  );
  yield* processRuntimeTurn(runtime, { hab, pollMailbox: false });

  if (!mailboxIdentityComplete(hby, hab.pre, startup.url)) {
    throw new ValidationError(
      "Mailbox startup reconciliation did not produce accepted self location/controller/mailbox state.",
    );
  }
}

function normalizeMailboxUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError(`Mailbox URL must be HTTP(S): ${url}`);
    }
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(`Invalid mailbox URL: ${url}`);
  }
}

function validateStartupDatetime(dt: string): string {
  const parsed = new Date(dt);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(`Invalid ISO8601 datetime: ${dt}`);
  }
  const y = parsed.getUTCFullYear().toString().padStart(4, "0");
  const m = (parsed.getUTCMonth() + 1).toString().padStart(2, "0");
  const d = parsed.getUTCDate().toString().padStart(2, "0");
  const hh = parsed.getUTCHours().toString().padStart(2, "0");
  const mm = parsed.getUTCMinutes().toString().padStart(2, "0");
  const ss = parsed.getUTCSeconds().toString().padStart(2, "0");
  const micros = (parsed.getUTCMilliseconds() * 1000).toString().padStart(
    6,
    "0",
  );
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${micros}+00:00`;
}

function resolveListenPort(
  explicit: number | undefined,
  advertisedUrl: string,
): number {
  if (explicit !== undefined) {
    return explicit;
  }
  const parsed = new URL(advertisedUrl);
  return parsed.port.length > 0 ? Number(parsed.port) : 8000;
}

function resolveListenHost(
  explicit: string | undefined,
  advertisedUrl: string,
): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const hostname = new URL(advertisedUrl).hostname;
  return isBindableLiteralHost(hostname) ? hostname : "0.0.0.0";
}

function isBindableLiteralHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "0.0.0.0"
    || hostname === "::"
    || hostname === "::1"
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    || hostname.includes(":");
}

/**
 * Open the selected habitat with mailbox-aware options.
 *
 * `Outboxer` remains opt-in so compat and parity work can still open keystores
 * without the Tufa-only retry sidecar.
 */
function* openExistingMailboxHabery(
  args: MailboxBaseArgs,
): Operation<Habery> {
  if (!args.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!args.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  return yield* setupHby(
    args.name,
    args.base ?? "",
    args.passcode,
    false,
    args.headDirPath,
    {
      compat: args.compat ?? false,
      readonly: false,
      skipConfig: false,
      skipSignator: false,
      outboxer: args.outboxer ?? false,
      cesrBodyMode: args.cesrBodyMode,
    },
  );
}

/** Resolve the selected local habitat and fail fast when the alias is missing. */
function requireHab(
  hby: Habery,
  alias?: string,
) {
  const hab = hby.habByName(alias ?? "");
  if (!hab) {
    throw new ValidationError(`No local AID found for alias ${alias}`);
  }
  return hab;
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
 * Collect the local controller replay material submitted to remote mailbox
 * admin endpoints.
 */
function collectReplay(
  hby: Habery,
  pre: string,
): Uint8Array {
  const parts: Uint8Array[] = [...hby.db.clonePreIter(pre)];
  const kever = hby.db.getKever(pre);
  if (kever) {
    parts.push(...hby.db.cloneDelegation(kever));
  }
  return parts.length === 0 ? new Uint8Array() : concatBytes(...parts);
}

/** Normalize CLI topic input into the stored mailbox topic form. */
function normalizeTopic(topic: string): string {
  return topic.startsWith("/") ? topic : `/${topic}`;
}

/** Derive the mailbox admin URL relative to the mailbox endpoint base URL. */
function adminUrl(url: string): string {
  return `${url.replace(/\/$/, "")}/mailboxes`;
}

/**
 * Submit one mailbox add/remove request to the remote mailbox provider.
 *
 * Wire shape:
 * - multipart form
 * - `kel` plus signed `rpy`
 * - response body surfaced verbatim on failure for debugging
 */
function* postMailboxAdmin(
  url: string,
  kel: Uint8Array,
  rpy: Uint8Array,
): Operation<{ ok: boolean; status: number; body: string }> {
  const form = new FormData();
  form.set("kel", new TextDecoder().decode(kel));
  form.set("rpy", new TextDecoder().decode(rpy));

  const { response } = yield* fetchResponseHandle(adminUrl(url), {
    method: "POST",
    body: form,
  });

  const body = yield* action<string>((resolve, reject) => {
    response.text().then(resolve).catch(reject);
    return () => {};
  });
  return { ok: response.ok, status: response.status, body };
}

/**
 * Issue one remote `mbx` query used by `mailbox debug`.
 *
 * The response body remains textual here because the command wants to print the
 * raw SSE event view after parsing.
 */
function* fetchMailboxDebug(
  url: string,
  query: Uint8Array,
  bodyMode: CesrBodyMode,
  destination: string,
): Operation<string> {
  const request = buildCesrRequest(query, {
    bodyMode,
    destination,
  });
  const { response } = yield* fetchResponseHandle(url, {
    method: "POST",
    headers: request.headers,
    body: request.body,
  });
  if (!response.ok) {
    throw new ValidationError(
      `Mailbox debug query failed with HTTP ${response.status}.`,
    );
  }
  return yield* action<string>((resolve, reject) => {
    response.text().then(resolve).catch(reject);
    return () => {};
  });
}

/** Parse mailbox SSE output into CLI-friendly rows. */
function parseMailboxSse(
  text: string,
): Array<{ idx: number; topic: string; msg: string }> {
  const messages: Array<{ idx: number; topic: string; msg: string }> = [];
  for (const block of text.split("\n\n")) {
    if (block.trim().length === 0) {
      continue;
    }
    let idx = -1;
    let topic = "";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("id:")) {
        idx = Number(line.slice(3).trim());
      } else if (line.startsWith("event:")) {
        topic = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
    }
    if (idx >= 0 && topic.length > 0 && data.length > 0) {
      messages.push({ idx, topic, msg: data.join("\n") });
    }
  }
  return messages;
}
