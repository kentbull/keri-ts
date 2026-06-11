/**
 * Witness host startup planning and reconciliation.
 *
 * Witness hosts are Tufa operator surfaces: they combine HTTP mailbox/runtime
 * hosting with a TCP witness listener over one non-transferable service AID.
 * This module keeps that startup policy named and testable while leaving CLI
 * config loading, console output, and long-lived listener execution at the edge.
 */
import type { Operation } from "effection";
import {
  createAgentRuntime,
  EndpointRoles,
  fetchEndpointUrls,
  type Hab,
  type Habery,
  ingestKeriBytes,
  makeNowIso8601,
  processRuntimeTurn,
  Schemes,
  ValidationError,
} from "keri-ts/runtime";
import {
  canonicalOrigin,
  controllerRoleEnabled,
  mailboxAdminUrl,
  normalizeHttpUrl,
  normalizeTcpUrl,
  resolveListenHost,
  resolveListenPort,
  roleEnabled,
  schemeForUrl,
  synthesizeHttpUrl,
  synthesizeTcpUrl,
  validateIsoDatetime,
} from "./host-planning.ts";

/** Minimal startup inputs needed after CLI parsing and config loading. */
export interface WitnessStartupArgs {
  alias?: string;
  url?: string;
  tcpUrl?: string;
  datetime?: string;
  http?: number;
  tcp?: number;
  listenHost?: string;
}

/** Resolved startup material and its authority source for one witness host. */
export interface WitnessStartupMaterial {
  httpUrl: string;
  tcpUrl: string;
  datetime?: string;
  source: "cli" | "config" | "state";
}

/** Resolved witness host startup consumed by the witness CLI adapter. */
export interface WitnessHostStartup {
  hab: Hab;
  aidCreated: boolean;
  startup: WitnessStartupMaterial;
  httpListenHost: string;
  httpPort: number;
  tcpListenHost: string;
  tcpPort: number;
  mailboxAdminUrl: string;
  witnessOobi: string;
  mailboxOobi: string;
}

/**
 * Resolve witness startup material in authority order.
 *
 * Precedence:
 * - explicit CLI URL/TCP URL input
 * - alias-scoped config section
 * - already accepted local endpoint state
 */
export function resolveWitnessStartupMaterial(
  hby: Habery,
  pre: string,
  args: WitnessStartupArgs,
  config: Record<string, unknown> | null,
): WitnessStartupMaterial {
  const cli = resolveExplicitWitnessStartup(args);

  if (config) {
    const section = config[args.alias!];
    if (!section || typeof section !== "object") {
      if (cli) {
        return cli;
      }
      throw new ValidationError(
        `Config file does not contain a '${args
          .alias!}' witness startup section.`,
      );
    }
    const data = section as Record<string, unknown>;
    const dt = typeof data.dt === "string" ? validateIsoDatetime(data.dt) : makeNowIso8601();
    const curls = Array.isArray(data.curls)
      ? data.curls.filter((entry): entry is string => typeof entry === "string")
      : [];
    const httpUrl = curls.find((entry) => {
      const protocol = new URL(entry).protocol;
      return protocol === "http:" || protocol === "https:";
    });
    const tcpUrl = curls.find((entry) => new URL(entry).protocol === "tcp:");
    if (!httpUrl || !tcpUrl) {
      throw new ValidationError(
        `Config section '${args
          .alias!}' must provide one HTTP(S) url and one tcp url.`,
      );
    }
    const configured = {
      httpUrl: normalizeWitnessHttpUrl(httpUrl),
      tcpUrl: normalizeTcpUrl(tcpUrl),
      datetime: dt,
      source: "config" as const,
    };
    if (
      cli
      && (cli.httpUrl !== configured.httpUrl
        || cli.tcpUrl !== configured.tcpUrl
        || cli.datetime !== configured.datetime)
    ) {
      throw new ValidationError(
        `Config section '${args
          .alias!}' conflicts with explicit witness startup material.`,
      );
    }
    return configured;
  }

  const state = storedWitnessStartupMaterial(hby, pre);
  if (state) {
    return state;
  }
  if (cli) {
    return cli;
  }

  throw new ValidationError(
    "Selected alias does not have complete witness startup state and no config or CLI startup material was provided.",
  );
}

function resolveExplicitWitnessStartup(
  args: WitnessStartupArgs,
): WitnessStartupMaterial | null {
  if (!args.url && !args.tcpUrl) {
    return null;
  }

  let httpUrl: string;
  if (args.url) {
    httpUrl = normalizeWitnessHttpUrl(args.url);
  } else {
    httpUrl = synthesizeHttpUrl(args.http ?? 5631, args.listenHost);
  }

  let tcpUrl: string;
  if (args.tcpUrl) {
    tcpUrl = normalizeTcpUrl(args.tcpUrl);
  } else {
    tcpUrl = synthesizeTcpUrl(args.tcp ?? 5632, args.listenHost);
  }

  const datetime = args.datetime
    ? validateIsoDatetime(args.datetime)
    : makeNowIso8601();

  return {
    httpUrl,
    tcpUrl,
    datetime,
    source: "cli",
  };
}

/** Resolve or create the service AID and derive the witness host plan. */
export function resolveWitnessHostStartup(
  hby: Habery,
  args: WitnessStartupArgs,
  config: Record<string, unknown> | null,
): WitnessHostStartup {
  const alias = args.alias ?? "";
  let hab = hby.habByName(alias);
  let aidCreated = false;
  if (!hab) {
    hab = hby.makeHab(alias, undefined, {
      transferable: false,
      icount: 1,
      isith: "1",
      toad: 0,
    });
    aidCreated = true;
  }

  validateWitnessHabitat(hby, hab);
  const startup = resolveWitnessStartupMaterial(hby, hab.pre, args, config);
  const httpListenHost = resolveListenHost(args.listenHost, startup.httpUrl);
  const httpPort = resolveListenPort(args.http, startup.httpUrl, 5631);
  const tcpListenHost = resolveListenHost(args.listenHost, startup.tcpUrl);
  const tcpPort = resolveListenPort(args.tcp, startup.tcpUrl, 5632);
  const origin = canonicalOrigin(startup.httpUrl);

  return {
    hab,
    aidCreated,
    startup,
    httpListenHost,
    httpPort,
    tcpListenHost,
    tcpPort,
    mailboxAdminUrl: mailboxAdminUrl(startup.httpUrl),
    witnessOobi: `${origin}/oobi/${hab.pre}/witness/${hab.pre}`,
    mailboxOobi: `${origin}/oobi/${hab.pre}/mailbox/${hab.pre}`,
  };
}

/** Ensure signed self endpoint and role state exists before serving traffic. */
export function* reconcileWitnessHostStartup(
  hby: Habery,
  startup: WitnessHostStartup,
): Operation<void> {
  if (startup.startup.source !== "state") {
    yield* reconcileWitnessIdentity(hby, startup.hab, startup.startup);
    return;
  }
  if (!witnessIdentityComplete(hby, startup.hab.pre, startup.startup)) {
    throw new ValidationError(
      "Selected alias does not have complete witness startup state and no authoritative startup material was provided.",
    );
  }
}

/** Normalize a witness HTTP(S) endpoint with witness-specific error text. */
export function normalizeWitnessHttpUrl(url: string): string {
  return normalizeHttpUrl(url, "Witness HTTP");
}

/** True when self location plus controller/witness/mailbox roles are accepted. */
export function witnessIdentityComplete(
  hby: Habery,
  pre: string,
  startup: WitnessStartupMaterial,
): boolean {
  const stored = storedWitnessStartupMaterial(hby, pre);
  return !!stored
    && stored.httpUrl === normalizeWitnessHttpUrl(startup.httpUrl)
    && stored.tcpUrl === normalizeTcpUrl(startup.tcpUrl)
    && controllerRoleEnabled(hby, pre)
    && roleEnabled(hby, pre, EndpointRoles.witness, pre)
    && roleEnabled(hby, pre, EndpointRoles.mailbox, pre);
}

function validateWitnessHabitat(hby: Habery, hab: Hab): void {
  const record = hby.db.getHab(hab.pre);
  if (!hab.kever) {
    throw new ValidationError(
      `Witness alias ${hab.name} is missing accepted key state.`,
    );
  }
  if (hab.kever.transferable) {
    throw new ValidationError(
      `Witness alias ${hab.name} must be non-transferable.`,
    );
  }
  if (
    record?.mid || (record?.smids?.length ?? 0) > 0
    || (record?.rmids?.length ?? 0) > 0
  ) {
    throw new ValidationError(
      `Witness alias ${hab.name} must be a local single-identifier habitat.`,
    );
  }
}

function storedWitnessStartupMaterial(
  hby: Habery,
  pre: string,
): WitnessStartupMaterial | null {
  const urls = fetchEndpointUrls(hby, pre);
  const httpEntries = [urls.https, urls.http]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map(normalizeWitnessHttpUrl);
  const tcpEntries = [urls.tcp]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map(normalizeTcpUrl);
  if (httpEntries.length === 0 || tcpEntries.length === 0) {
    return null;
  }
  if (httpEntries.length > 1) {
    throw new ValidationError(
      `Local witness alias ${pre} has more than one HTTP(S) URL; use one authoritative URL.`,
    );
  }
  if (tcpEntries.length > 1) {
    throw new ValidationError(
      `Local witness alias ${pre} has more than one tcp URL; use one authoritative URL.`,
    );
  }
  return {
    httpUrl: httpEntries[0]!,
    tcpUrl: tcpEntries[0]!,
    source: "state",
  };
}

function* reconcileWitnessIdentity(
  hby: Habery,
  hab: Hab,
  startup: WitnessStartupMaterial,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  try {
    ingestKeriBytes(
      runtime,
      hab.makeLocScheme(
        startup.httpUrl,
        hab.pre,
        schemeForUrl(startup.httpUrl),
        startup.datetime,
      ),
    );
    ingestKeriBytes(
      runtime,
      hab.makeLocScheme(startup.tcpUrl, hab.pre, Schemes.tcp, startup.datetime),
    );
    ingestKeriBytes(
      runtime,
      hab.makeEndRole(hab.pre, EndpointRoles.controller, true, startup.datetime),
    );
    ingestKeriBytes(
      runtime,
      hab.makeEndRole(hab.pre, EndpointRoles.witness, true, startup.datetime),
    );
    ingestKeriBytes(
      runtime,
      hab.makeEndRole(hab.pre, EndpointRoles.mailbox, true, startup.datetime),
    );
    yield* processRuntimeTurn(runtime, { hab, pollMailbox: false });
  } finally {
    yield* runtime.close();
  }

  if (!witnessIdentityComplete(hby, hab.pre, startup)) {
    throw new ValidationError(
      "Witness startup reconciliation did not produce accepted self location/controller/witness/mailbox state.",
    );
  }
}
