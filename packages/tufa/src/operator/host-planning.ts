/**
 * Shared planning helpers for Tufa operator-host startup commands.
 *
 * This module owns pure URL, port, datetime, and endpoint-role policy used by
 * mailbox and witness startup. It intentionally avoids console, filesystem,
 * environment, and listener side effects.
 */
import { EndpointRoles, type Habery, type Scheme, Schemes, ValidationError } from "keri-ts/runtime";

/** Build KLI/Tufa-compatible config path candidates from explicit roots. */
export function configFileCandidates(
  configFile: string,
  {
    headDirPath,
    compat = false,
    home,
  }: {
    headDirPath?: string;
    compat?: boolean;
    home?: string;
  } = {},
): string[] {
  const fileName = configFile.endsWith(".json") ? configFile : `${configFile}.json`;
  const candidates = new Set<string>();
  candidates.add(configFile);
  candidates.add(fileName);

  const suffixes = compat ? [".keri/cf"] : [".tufa/cf", "keri/cf"];
  if (headDirPath) {
    for (const suffix of suffixes) {
      candidates.add(joinConfigPath(headDirPath, suffix, fileName));
    }
  }
  if (home) {
    for (const suffix of suffixes) {
      candidates.add(joinConfigPath(home, suffix, fileName));
    }
  }
  candidates.add(joinConfigPath("/usr/local/var/keri/cf", fileName));

  return [...candidates];
}

/** Normalize an advertised HTTP(S) endpoint while preserving path/query/hash. */
export function normalizeHttpUrl(url: string, label: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new ValidationError(`${label} URL must be HTTP(S): ${url}`);
    }
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(`Invalid ${label.toLowerCase()} URL: ${url}`);
  }
}

/** Normalize an advertised TCP endpoint for witness receipt transport. */
export function normalizeTcpUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "tcp:") {
    throw new ValidationError(`Witness TCP URL must use tcp: ${url}`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

/** Convert an ISO-like timestamp into the KERIpy-style UTC microsecond string. */
export function validateIsoDatetime(dt: string): string {
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
  const micros = (parsed.getUTCMilliseconds() * 1000).toString().padStart(6, "0");
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}.${micros}+00:00`;
}

/** Choose a bind address from explicit input or the advertised endpoint host. */
export function resolveListenHost(
  explicit: string | undefined,
  advertisedUrl: string,
): string {
  if (explicit && explicit.length > 0) {
    return explicit;
  }
  const hostname = new URL(advertisedUrl).hostname;
  return isBindableLiteralHost(hostname) ? hostname : "0.0.0.0";
}

/** Resolve a listener port from explicit input or an advertised URL. */
export function resolveListenPort(
  explicit: number | undefined,
  advertisedUrl: string,
  defaultPort: number,
): number {
  if (explicit !== undefined) {
    return explicit;
  }
  const parsed = new URL(advertisedUrl);
  return parsed.port.length > 0 ? Number(parsed.port) : defaultPort;
}

/** Convert wildcard bind hosts into a usable advertised localhost endpoint. */
export function bindableAdvertiseHost(host?: string): string {
  if (!host || host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

/** Synthesize an HTTP URL from a listener port and optional bind host. */
export function synthesizeHttpUrl(
  port: number,
  listenHost?: string,
): string {
  const host = bindableAdvertiseHost(listenHost);
  return normalizeHttpUrl(`http://${host}:${port}`, "Witness HTTP");
}

/** Synthesize a TCP URL from a listener port and optional bind host. */
export function synthesizeTcpUrl(
  port: number,
  listenHost?: string,
): string {
  const host = bindableAdvertiseHost(listenHost);
  return normalizeTcpUrl(`tcp://${host}:${port}`);
}

/** Return the origin portion used in generated role OOBIs. */
export function canonicalOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

/** Derive the mailbox-admin URL relative to one hosted endpoint path. */
export function mailboxAdminUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    const base = pathname === "/" ? "" : pathname;
    return `${parsed.protocol}//${parsed.host}${base}/mailboxes`;
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }
    throw new ValidationError(`Invalid mailbox URL: ${url}`);
  }
}

/** Map an advertised URL protocol to the KERI location scheme identifier. */
export function schemeForUrl(url: string): Scheme {
  const protocol = new URL(url).protocol;
  if (protocol === "https:") {
    return Schemes.https;
  }
  if (protocol === "tcp:") {
    return Schemes.tcp;
  }
  return Schemes.http;
}

/** True when an accepted or enabled endpoint-role row exists. */
export function roleEnabled(
  hby: Habery,
  cid: string,
  role: string,
  eid: string,
): boolean {
  const end = hby.db.ends.get([cid, role, eid]);
  return !!(end?.allowed || end?.enabled);
}

/** True when the service AID has accepted local controller role state. */
export function controllerRoleEnabled(hby: Habery, pre: string): boolean {
  return roleEnabled(hby, pre, EndpointRoles.controller, pre);
}

function isBindableLiteralHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "0.0.0.0"
    || hostname === "::"
    || hostname === "::1"
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    || hostname.includes(":");
}

function joinConfigPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .map((part, index) => {
      if (index === 0) {
        return part.replace(/\/+$/, "");
      }
      return part.replace(/^\/+|\/+$/g, "");
    })
    .join("/");
}
