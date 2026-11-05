/** Validate one hosted-watcher backend invocation before its role opens stores or listeners. */
import type { Operation } from "effection";
import { parseIntegerOption, parseNumberOption, parseStringOption } from "keri-ts/cli";
import { ValidationError } from "keri-ts/runtime";
import { runHostedWatchers } from "../../roles/hosted-watcher.ts";

/** Start the public observation backend and its separately loopback-bound provisioning listener. */
export function* hostedWatcherCommand(args: Record<string, unknown>): Operation<void> {
  const name = parseStringOption(args.name, "name"), advertised = parseStringOption(args.url, "url");
  if (!name?.trim() || !advertised) throw new ValidationError("--name and --url are required.");
  let url: URL;
  try {
    url = new URL(advertised);
  } catch {
    throw new ValidationError("--url must be an HTTP(S) origin.");
  }
  if (
    !/^https?:\/\/[^/?#]+\/?$/i.test(advertised) || url.username || url.password
    || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new ValidationError("--url must be an HTTP(S) origin without credentials, path, query or fragment.");
  }
  const httpPort = parseIntegerOption(args.http, "http") ?? 5642;
  const bootPort = parseIntegerOption(args.bootPort, "boot-port") ?? 5641;
  if (httpPort < 1 || httpPort > 65535 || bootPort < 1 || bootPort > 65535 || httpPort === bootPort) {
    throw new ValidationError("--http and --boot-port must be distinct ports between 1 and 65535.");
  }
  const httpHost = parseStringOption(args.listenHost, "listen-host") ?? "127.0.0.1";
  if (!httpHost.trim()) throw new ValidationError("--listen-host must not be empty.");
  const pollSeconds = parseNumberOption(args.pollInterval, "poll-interval") ?? 30;
  const pollIntervalMs = pollSeconds * 1000;
  if (pollSeconds <= 0 || !Number.isFinite(pollIntervalMs)) {
    throw new ValidationError("--poll-interval must be a positive finite number of seconds.");
  }
  yield* runHostedWatchers({
    name,
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "head-dir"),
    passcode: parseStringOption(args.passcode, "passcode"),
    publicUrl: url.origin,
    httpPort,
    httpHost,
    bootPort,
    pollIntervalMs,
  });
}
