import type { Operation } from "effection";
import { join } from "jsr:@std/path";
import {
  type Configer,
  createAgentRuntime,
  createConfiger,
  EndpointRoles,
  fetchEndpointUrls,
  type Hab,
  type Habery,
  ingestKeriBytes,
  makeNowIso8601,
  processRuntimeTurn,
  Receiptor,
  type Scheme,
  Schemes,
  ValidationError,
  type WitnessAuthMap,
  WitnessReceiptor,
} from "keri-ts/runtime";
import { runWitnessHost } from "../roles/witness.ts";
import { ensureHby, setupHby } from "./support/existing.ts";

interface WitnessBaseArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  alias?: string;
  compat?: boolean;
}

interface WitnessStartArgs extends WitnessBaseArgs {
  configDir?: string;
  configFile?: string;
  url?: string;
  tcpUrl?: string;
  datetime?: string;
  http?: number;
  tcp?: number;
  listenHost?: string;
}

interface WitnessSubmitArgs extends WitnessBaseArgs {
  force?: boolean;
  endpoint?: boolean;
  authenticate?: boolean;
  code?: string[];
  codeTime?: string;
}

interface WitnessStartupMaterial {
  httpUrl: string;
  tcpUrl: string;
  datetime?: string;
  source: "cli" | "config" | "state" | "default";
}

/** Start one combined witness+mailbox host after identity reconciliation. */
export function* witnessStartCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs = parseWitnessStartArgs(args);
  const startConfig = yield* loadWitnessStartConfig(commandArgs);
  const ensured = yield* ensureHby(
    commandArgs.name!,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      cf: startConfig,
      skipConfig: !startConfig,
      skipSignator: false,
    },
  );
  const hby = ensured.hby;
  let aidCreated = false;

  try {
    let hab = hby.habByName(commandArgs.alias!);
    if (!hab) {
      hab = hby.makeHab(commandArgs.alias!, undefined, {
        transferable: false,
        icount: 1,
        isith: "1",
        toad: 0,
      });
      aidCreated = true;
    }

    validateWitnessHabitat(hby, hab);
    const startup = resolveWitnessStartupMaterial(hby, hab.pre, commandArgs, startConfig);
    if (startup.source !== "state") {
      yield* reconcileWitnessIdentity(hby, hab, startup);
    } else if (!witnessIdentityComplete(hby, hab.pre, startup)) {
      throw new ValidationError(
        "Selected alias does not have complete witness startup state and no authoritative startup material was provided.",
      );
    }

    const httpListenHost = resolveListenHost(commandArgs.listenHost, startup.httpUrl);
    const httpPort = resolveHttpPort(commandArgs.http, startup.httpUrl);
    const tcpListenHost = resolveListenHost(commandArgs.listenHost, startup.tcpUrl);
    const tcpPort = resolveTcpPort(commandArgs.tcp, startup.tcpUrl);

    console.log(`Witness Prefix  ${hab.pre}`);
    console.log(`HTTP URL        ${startup.httpUrl}`);
    console.log(`TCP URL         ${startup.tcpUrl}`);
    console.log(`Mailbox Admin   ${adminUrl(startup.httpUrl)}`);
    console.log(
      `Witness OOBI    ${canonicalOrigin(startup.httpUrl)}/oobi/${hab.pre}/witness/${hab.pre}`,
    );
    console.log(
      `Mailbox OOBI    ${canonicalOrigin(startup.httpUrl)}/oobi/${hab.pre}/mailbox/${hab.pre}`,
    );
    console.log(`HTTP Listen     ${httpListenHost}:${httpPort}`);
    console.log(`TCP Listen      ${tcpListenHost}:${tcpPort}`);
    console.log(`Keystore        ${ensured.created ? "created" : "reused"}`);
    console.log(`Witness AID     ${aidCreated ? "created" : "reused"}`);

    yield* runWitnessHost(hby, {
      serviceHab: hab,
      httpPort,
      httpListenHost,
      tcpPort,
      tcpListenHost,
    });
  } finally {
    yield* hby.close();
  }
}

/** Submit the current local event to witnesses and converge the receipt set. */
export function* witnessSubmitCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: WitnessSubmitArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    force: args.force as boolean | undefined,
    endpoint: args.endpoint as boolean | undefined,
    authenticate: args.authenticate as boolean | undefined,
    code: args.code as string[] | undefined,
    codeTime: args.codeTime as string | undefined,
  };

  const hby = yield* setupHby(
    commandArgs.name!,
    commandArgs.base ?? "",
    commandArgs.passcode,
    false,
    commandArgs.headDirPath,
    {
      compat: commandArgs.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: true,
    },
  );
  try {
    const hab = requireWitnessHab(hby, commandArgs.alias);
    const auths = resolveWitnessAuths(
      hab.kever?.wits ?? [],
      commandArgs.code ?? [],
      commandArgs.codeTime,
      commandArgs.authenticate ?? false,
    );
    if (commandArgs.endpoint) {
      const receiptor = new Receiptor(hby);
      yield* receiptor.receipt(hab.pre, { sn: hab.kever?.sn, auths });
    } else {
      const witDoer = new WitnessReceiptor(hby, {
        force: commandArgs.force ?? false,
      });
      yield* witDoer.submit(hab.pre, {
        sn: hab.kever?.sn,
        auths,
      });
    }

    console.log(`Prefix  ${hab.pre}`);
    console.log(`Sequence No.  ${hab.kever?.sn ?? ""}`);
  } finally {
    yield* hby.close();
  }
}

function parseWitnessStartArgs(args: Record<string, unknown>): WitnessStartArgs {
  const parsed: WitnessStartArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    alias: args.alias as string | undefined,
    compat: args.compat as boolean | undefined,
    configDir: args.configDir as string | undefined,
    configFile: args.configFile as string | undefined,
    url: args.url as string | undefined,
    tcpUrl: args.tcpUrl as string | undefined,
    datetime: args.datetime as string | undefined,
    http: args.http !== undefined ? Number(args.http) : undefined,
    tcp: args.tcp !== undefined ? Number(args.tcp) : undefined,
    listenHost: args.listenHost as string | undefined,
  };
  if (!parsed.name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  if (!parsed.alias) {
    throw new ValidationError("Alias is required and cannot be empty");
  }
  return parsed;
}

function* loadWitnessStartConfig(
  args: WitnessStartArgs,
): Operation<Configer | undefined> {
  if (!args.configFile) {
    return undefined;
  }

  try {
    return yield* createConfiger({
      name: args.configFile,
      base: "",
      temp: false,
      headDirPath: args.configDir,
      reopen: true,
      clear: false,
    });
  } catch {
    for (
      const candidate of witnessConfigCandidates(
        args.configFile,
        args.headDirPath,
        args.compat ?? false,
      )
    ) {
      try {
        return yield* createConfiger({
          name: candidate,
          base: "",
          temp: false,
          reopen: true,
          clear: false,
        });
      } catch {
        continue;
      }
    }
  }

  throw new ValidationError(`Config file '${args.configFile}' was not found.`);
}

function witnessConfigCandidates(
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

function resolveWitnessStartupMaterial(
  hby: Habery,
  pre: string,
  args: WitnessStartArgs,
  configer?: Configer,
): WitnessStartupMaterial {
  const cli = args.url || args.tcpUrl
    ? {
      httpUrl: args.url
        ? normalizeHttpUrl(args.url)
        : synthesizeHttpUrl(args.http ?? 5631, args.listenHost),
      tcpUrl: args.tcpUrl
        ? normalizeTcpUrl(args.tcpUrl)
        : synthesizeTcpUrl(args.tcp ?? 5632, args.listenHost),
      datetime: args.datetime ? validateIsoDatetime(args.datetime) : makeNowIso8601(),
      source: "cli" as const,
    }
    : null;

  const config = configer?.get<Record<string, unknown>>() ?? null;
  if (config) {
    const section = config[args.alias!];
    if (!section || typeof section !== "object") {
      if (cli) {
        return cli;
      }
      throw new ValidationError(
        `Config file does not contain a '${args.alias!}' witness startup section.`,
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
        `Config section '${args.alias!}' must provide one HTTP(S) url and one tcp url.`,
      );
    }
    const configured = {
      httpUrl: normalizeHttpUrl(httpUrl),
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
        `Config section '${args.alias!}' conflicts with explicit witness startup material.`,
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

  return {
    httpUrl: synthesizeHttpUrl(args.http ?? 5631, args.listenHost),
    tcpUrl: synthesizeTcpUrl(args.tcp ?? 5632, args.listenHost),
    datetime: makeNowIso8601(),
    source: "default",
  };
}

function validateWitnessHabitat(hby: Habery, hab: Hab): void {
  const record = hby.db.getHab(hab.pre);
  if (!hab.kever) {
    throw new ValidationError(`Witness alias ${hab.name} is missing accepted key state.`);
  }
  if (hab.kever.transferable) {
    throw new ValidationError(`Witness alias ${hab.name} must be non-transferable.`);
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

function roleEnabled(
  hby: Habery,
  cid: string,
  role: string,
  eid: string,
): boolean {
  const end = hby.db.ends.get([cid, role, eid]);
  return !!(end?.allowed || end?.enabled);
}

function storedWitnessStartupMaterial(
  hby: Habery,
  pre: string,
): WitnessStartupMaterial | null {
  const urls = fetchEndpointUrls(hby, pre);
  const httpEntries = [urls.https, urls.http]
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    .map(normalizeHttpUrl);
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

function witnessIdentityComplete(
  hby: Habery,
  pre: string,
  startup: WitnessStartupMaterial,
): boolean {
  const stored = storedWitnessStartupMaterial(hby, pre);
  return !!stored
    && stored.httpUrl === normalizeHttpUrl(startup.httpUrl)
    && stored.tcpUrl === normalizeTcpUrl(startup.tcpUrl)
    && roleEnabled(hby, pre, EndpointRoles.controller, pre)
    && roleEnabled(hby, pre, EndpointRoles.witness, pre)
    && roleEnabled(hby, pre, EndpointRoles.mailbox, pre);
}

function* reconcileWitnessIdentity(
  hby: Habery,
  hab: Hab,
  startup: WitnessStartupMaterial,
): Operation<void> {
  const runtime = yield* createAgentRuntime(hby, { mode: "local" });
  ingestKeriBytes(
    runtime,
    hab.makeLocScheme(startup.httpUrl, hab.pre, schemeForUrl(startup.httpUrl), startup.datetime),
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
  yield* runtime.close();

  if (!witnessIdentityComplete(hby, hab.pre, startup)) {
    throw new ValidationError(
      "Witness startup reconciliation did not produce accepted self location/controller/witness/mailbox state.",
    );
  }
}

function requireWitnessHab(hby: Habery, alias?: string): Hab {
  const hab = hby.habByName(alias ?? "");
  if (!hab) {
    throw new ValidationError(`No local AID found for alias ${alias}`);
  }
  return hab;
}

function resolveWitnessAuths(
  witnesses: readonly string[],
  codes: readonly string[],
  codeTime: string | undefined,
  promptMissing: boolean,
): WitnessAuthMap {
  const timestamp = codeTime ? validateIsoDatetime(codeTime) : makeNowIso8601();
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

function normalizeHttpUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError(`Witness HTTP URL must be HTTP(S): ${url}`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}${parsed.hash}`;
}

function normalizeTcpUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== "tcp:") {
    throw new ValidationError(`Witness TCP URL must use tcp: ${url}`);
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.protocol}//${parsed.host}${pathname}`;
}

function schemeForUrl(url: string): Scheme {
  const protocol = new URL(url).protocol;
  if (protocol === "https:") {
    return Schemes.https;
  }
  if (protocol === "tcp:") {
    return Schemes.tcp;
  }
  return Schemes.http;
}

function validateIsoDatetime(dt: string): string {
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

function resolveHttpPort(explicit: number | undefined, advertisedUrl: string): number {
  if (explicit !== undefined) {
    return explicit;
  }
  const parsed = new URL(advertisedUrl);
  return parsed.port.length > 0 ? Number(parsed.port) : 5631;
}

function resolveTcpPort(explicit: number | undefined, advertisedUrl: string): number {
  if (explicit !== undefined) {
    return explicit;
  }
  const parsed = new URL(advertisedUrl);
  return parsed.port.length > 0 ? Number(parsed.port) : 5632;
}

function synthesizeHttpUrl(
  port: number,
  listenHost?: string,
): string {
  const host = bindableAdvertiseHost(listenHost);
  return normalizeHttpUrl(`http://${host}:${port}`);
}

function synthesizeTcpUrl(
  port: number,
  listenHost?: string,
): string {
  const host = bindableAdvertiseHost(listenHost);
  return normalizeTcpUrl(`tcp://${host}:${port}`);
}

function bindableAdvertiseHost(host?: string): string {
  if (!host || host === "0.0.0.0" || host === "::") {
    return "127.0.0.1";
  }
  return host;
}

function isBindableLiteralHost(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "0.0.0.0"
    || hostname === "::"
    || hostname === "::1"
    || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
    || hostname.includes(":");
}

function canonicalOrigin(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}

function adminUrl(url: string): string {
  const parsed = new URL(url);
  const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
  const base = pathname === "/" ? "" : pathname;
  return `${parsed.protocol}//${parsed.host}${base}/mailboxes`;
}
