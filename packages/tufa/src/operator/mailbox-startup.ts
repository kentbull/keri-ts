/**
 * Mailbox host startup planning and reconciliation.
 *
 * The CLI owns config/file loading and final host execution. This module owns
 * the operator policy for selecting/creating the mailbox service AID,
 * resolving advertised startup material, reconciling signed self endpoint
 * state, and deriving the concrete host plan.
 */
import type { Operation } from "effection";
import {
  createAgentRuntime,
  EndpointRoles,
  fetchEndpointUrls,
  type Hab,
  type Habery,
  ingestKeriBytes,
  processRuntimeTurn,
  ValidationError,
} from "keri-ts/runtime";
import {
  canonicalOrigin,
  controllerRoleEnabled,
  mailboxAdminUrl,
  normalizeHttpUrl,
  resolveListenHost,
  resolveListenPort,
  roleEnabled,
  schemeForUrl,
  validateIsoDatetime,
} from "./host-planning.ts";

/** Minimal startup inputs needed after CLI parsing and config loading. */
export interface MailboxStartupArgs {
  alias?: string;
  url?: string;
  datetime?: string;
  port?: number;
  listenHost?: string;
}

/** Resolved startup material and its authority source for one mailbox host. */
export interface MailboxStartupMaterial {
  url: string;
  datetime?: string;
  source: "cli" | "config" | "state";
}

/** Resolved mailbox host startup consumed by the mailbox CLI adapter. */
export interface MailboxHostStartup {
  hab: Hab;
  aidCreated: boolean;
  startup: MailboxStartupMaterial;
  listenHost: string;
  port: number;
  mailboxAdminUrl: string;
  mailboxOobi: string;
}

/**
 * Resolve explicit or config-provided mailbox startup material.
 *
 * Unlike witness startup, mailbox startup does not synthesize a new URL for a
 * missing existing alias; operators must provide config/CLI material or already
 * accepted endpoint state.
 */
export function resolveConfiguredMailboxStartup(
  args: MailboxStartupArgs,
  config: Record<string, unknown> | null,
  alias: string,
): MailboxStartupMaterial | null {
  const cli = args.url && args.datetime
    ? {
      url: normalizeMailboxUrl(args.url),
      datetime: validateIsoDatetime(args.datetime),
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
    throw new ValidationError(`Config section '${alias}' is missing dt.`);
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
    datetime: validateIsoDatetime(dt),
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

/** Resolve or create the service AID and derive the mailbox host plan. */
export function resolveMailboxHostStartup(
  hby: Habery,
  args: MailboxStartupArgs,
  config: Record<string, unknown> | null,
): MailboxHostStartup {
  const alias = args.alias ?? "";
  let hab = hby.habByName(alias);
  const configured = resolveConfiguredMailboxStartup(args, config, alias);
  let aidCreated = false;

  if (!hab && !configured) {
    throw new ValidationError(
      "Mailbox startup requires --url and --datetime, or a matching config alias section, when the alias does not already exist.",
    );
  }

  if (!hab) {
    hab = hby.makeHab(alias, undefined, {
      transferable: false,
      icount: 1,
      isith: "1",
      toad: 0,
    });
    aidCreated = true;
  }

  validateMailboxHabitat(hby, hab);
  const startup = resolveEffectiveMailboxStartup(hby, hab.pre, configured);
  const listenHost = resolveListenHost(args.listenHost, startup.url);
  const port = resolveListenPort(args.port, startup.url, 8000);
  const origin = canonicalOrigin(startup.url);

  return {
    hab,
    aidCreated,
    startup,
    listenHost,
    port,
    mailboxAdminUrl: mailboxAdminUrl(startup.url),
    mailboxOobi: `${origin}/oobi/${hab.pre}/mailbox/${hab.pre}`,
  };
}

/** Ensure signed self endpoint and role state exists before serving traffic. */
export function* reconcileMailboxHostStartup(
  hby: Habery,
  startup: MailboxHostStartup,
): Operation<void> {
  if (startup.startup.source !== "state") {
    yield* reconcileMailboxIdentity(hby, startup.hab, startup.startup);
    return;
  }
  if (!mailboxIdentityComplete(hby, startup.hab.pre, startup.startup.url)) {
    throw new ValidationError(
      "Selected alias does not have complete mailbox startup state and no authoritative --url/--datetime or config material was provided.",
    );
  }
}

/** Return true when self location plus controller/mailbox roles are accepted. */
export function mailboxIdentityComplete(
  hby: Habery,
  pre: string,
  url: string,
): boolean {
  return storedMailboxUrl(hby, pre) === normalizeMailboxUrl(url)
    && controllerRoleEnabled(hby, pre)
    && roleEnabled(hby, pre, EndpointRoles.mailbox, pre);
}

/** Normalize a mailbox HTTP(S) endpoint with mailbox-specific error text. */
export function normalizeMailboxUrl(url: string): string {
  return normalizeHttpUrl(url, "Mailbox");
}

function resolveEffectiveMailboxStartup(
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

function validateMailboxHabitat(hby: Habery, hab: Hab): void {
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

function* reconcileMailboxIdentity(
  hby: Habery,
  hab: Hab,
  startup: MailboxStartupMaterial,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  try {
    ingestKeriBytes(
      runtime,
      hab.makeLocScheme(
        startup.url,
        hab.pre,
        schemeForUrl(startup.url),
        startup.datetime,
      ),
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
  } finally {
    yield* runtime.close();
  }

  if (!mailboxIdentityComplete(hby, hab.pre, startup.url)) {
    throw new ValidationError(
      "Mailbox startup reconciliation did not produce accepted self location/controller/mailbox state.",
    );
  }
}
