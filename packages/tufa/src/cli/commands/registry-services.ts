/** Load explicit service credentials and evidence before entering registry role lifetimes. */
import { call, type Operation } from "effection";
import { parseIntegerOption, parseNumberOption, parseStringListOption, parseStringOption } from "keri-ts/cli";
import { ValidationError } from "keri-ts/runtime";
import { resolve } from "node:path";
import { runObserver, runRegistrar } from "../../roles/registry-services.ts";

/** Start publication with a fixed observer allowlist and an existing service identity. */
export function* registrarStartCommand(args: Record<string, unknown>): Operation<void> {
  const options = yield* serviceOptions(args, 6632, 6631);
  yield* runRegistrar({ ...options, observers: parseStringListOption(args.observer, "observer") ?? [] });
}

/** Start polling configured HTTPS registrars with explicit optional CA trust. */
export function* observerStartCommand(args: Record<string, unknown>): Operation<void> {
  const options = yield* serviceOptions(args, 6633, 6634);
  const caPath = parseStringOption(args.registrarCa, "registrar-ca");
  const caFile = caPath === undefined ? undefined : resolve(caPath);
  if (caFile) yield* readPem(caFile, "registrar-ca");
  const certName = parseStringOption(args.registrarCertName, "registrar-cert-name");
  const sources = (parseStringListOption(args.registrar, "registrar") ?? []).map((value) => ({
    url: httpsOrigin(value, "registrar"),
    ...(caFile === undefined ? {} : { caFile }),
    ...(certName === undefined ? {} : { certName }),
  }));
  yield* runObserver({
    ...options,
    sources,
    readers: parseStringListOption(args.reader, "reader") ?? [],
    pollIntervalMs: seconds(args.pollInterval, "poll-interval", 5),
    timeoutMs: seconds(args.timeout, "timeout", 5),
    maximumAgeMs: seconds(args.maximumAge, "maximum-age", 15),
  });
}

/** Validate common startup selections and load only explicitly selected files. */
function* serviceOptions(args: Record<string, unknown>, defaultHttp: number, defaultBoot: number) {
  const name = required(args.name, "name"), alias = required(args.alias, "alias");
  const publicUrl = httpsOrigin(required(args.url, "url"), "url");
  const httpPort = parseIntegerOption(args.http, "http") ?? defaultHttp;
  const bootPort = parseIntegerOption(args.bootPort, "boot-port") ?? defaultBoot;
  if (httpPort < 1 || httpPort > 65535 || bootPort < 1 || bootPort > 65535 || httpPort === bootPort) {
    throw new ValidationError("--http and --boot-port must be distinct ports between 1 and 65535.");
  }
  const httpHost = parseStringOption(args.listenHost, "listen-host") ?? "127.0.0.1";
  if (!httpHost.trim()) throw new ValidationError("--listen-host must not be empty.");
  const key = yield* readPem(required(args.tlsKey, "tls-key"), "tls-key");
  const cert = yield* readPem(required(args.tlsCert, "tls-cert"), "tls-cert");
  const initialEvidence: Uint8Array[] = [];
  for (const path of parseStringListOption(args.kel, "kel") ?? []) {
    initialEvidence.push(yield* call(() => Deno.readFile(path)));
  }
  return {
    name,
    alias,
    publicUrl,
    httpPort,
    bootPort,
    httpHost,
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "head-dir"),
    passcode: parseStringOption(args.passcode, "passcode"),
    tls: { key, cert },
    initialEvidence,
  };
}

/** Refuse empty required selections before opening a service store. */
function required(value: unknown, flag: string): string {
  const parsed = parseStringOption(value, flag);
  if (!parsed?.trim()) throw new ValidationError(`--${flag} is required and must not be empty.`);
  return parsed;
}

/** Public service URLs and acquisition sources are HTTPS origins only. */
function httpsOrigin(value: string, flag: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ValidationError(`--${flag} must be an HTTPS origin.`);
  }
  if (
    !/^https:\/\/[^/?#]+\/?$/i.test(value) || url.username || url.password || url.pathname !== "/" || url.search
    || url.hash
  ) {
    throw new ValidationError(`--${flag} must be an HTTPS origin without credentials, path, query or fragment.`);
  }
  return url.origin;
}

/** Convert finite positive CLI seconds into role milliseconds without overflow. */
function seconds(value: unknown, flag: string, fallback: number): number {
  const milliseconds = (parseNumberOption(value, flag) ?? fallback) * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new ValidationError(`--${flag} must be a positive finite number of seconds.`);
  }
  return milliseconds;
}

/** Read PEM text before startup so missing or empty files cannot leave a running listener. */
function* readPem(path: string, flag: string): Operation<string> {
  const pem = yield* call(() => Deno.readTextFile(path));
  if (!pem.trim()) throw new ValidationError(`--${flag} must contain PEM data.`);
  return pem;
}
