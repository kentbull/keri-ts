/** Finite signed KF allocation and account onboarding over existing local identities. */
import { ensure, type Operation, race, scoped, sleep } from "effection";
import { parseNumberOption, parseStringOption } from "keri-ts/cli";
import {
  type AgentRuntime,
  createAgentRuntime,
  FetchHttpClient,
  type Habery,
  type KramConfig,
  Receiptor,
  systemClock,
  ValidationError,
} from "keri-ts/runtime";
import { discoverKfBoot, KfBootClient } from "../../operator/kfboot/client.ts";
import { onboardKfAccount } from "../../operator/kfboot/onboarding.ts";
import { withExistingHab } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";

/** Validate explicit command coordinates before opening stores or submitting a signed request. */
function required(args: Record<string, unknown>, key: string, flag = key): string {
  const value = parseStringOption(args[key], flag);
  if (!value?.trim()) throw new ValidationError(`--${flag} is required.`);
  return value;
}

/** Bound one command's owned network work and join it before returning or closing the store. */
function* timed<T>(args: Record<string, unknown>, work: () => Operation<T>): Operation<T> {
  const timeoutMs = timeout(args);
  return yield* race([
    work(),
    (function*(): Operation<never> {
      yield* sleep(timeoutMs);
      throw new ValidationError("KF boot command timed out; inspect the existing session before retrying allocation.");
    })(),
  ]);
}

/** Validate seconds before effects and reject conversion overflow. */
function timeout(args: Record<string, unknown>): number {
  const milliseconds = (parseNumberOption(args.timeout, "timeout") ?? 60) * 1000;
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new ValidationError("KF boot --timeout must be positive and finite.");
  }
  return milliseconds;
}

/** Discovery is public configuration and never reports account or allocation acceptance. */
export function* kfBootDiscoverCommand(args: Record<string, unknown>): Operation<void> {
  const provider = required(args, "url");
  const discovery = yield* timed(args, () => discoverKfBoot(new FetchHttpClient(), provider));
  writeJsonLine(discovery);
}

/** Compose the selected existing signer with ordinary KRAM; retain no separate provider ledger. */
function* authenticated<T>(
  args: Record<string, unknown>,
  use: (client: KfBootClient, hby: Habery, runtime: AgentRuntime) => Operation<T>,
): Operation<T> {
  const provider = required(args, "url"), alias = required(args, "alias");
  const server = parseStringOption(args.serverAid, "server-aid");
  const surface = parseStringOption(args.surface, "surface") ?? "onboarding";
  if (surface !== "onboarding" && surface !== "account") {
    throw new ValidationError("--surface must be onboarding or account.");
  }
  const store = {
    name: required(args, "name"),
    base: parseStringOption(args.base, "base"),
    headDirPath: parseStringOption(args.headDirPath, "head-dir"),
    passcode: parseStringOption(args.passcode, "passcode"),
    compat: args.compat === true,
  };
  return yield* timed(args, function*() {
    return yield* withExistingHab(store, alias, { skipConfig: false }, function*({ hby, hab }) {
      return yield* scoped(function*() {
        const configured = hby.cf?.get<{ kram?: KramConfig }>().kram;
        if (configured?.enabled === false) throw new ValidationError("KF boot requires enabled KRAM.");
        const http = new FetchHttpClient();
        // Match kf-boot's ordinary cache windows unless the store selects its own policy.
        const kram: KramConfig = {
          ...configured,
          enabled: true,
          caches: configured?.caches ?? { "~": [1000, 5000, 5000, 86400000, 5000, 5000, 86400000] },
        };
        const runtime = yield* createAgentRuntime(hby, http, systemClock, { kram });
        yield* ensure(() => runtime.close());
        const discovery = yield* discoverKfBoot(http, provider);
        return yield* use(new KfBootClient(hby, hab, runtime.protocol, http, discovery, server, surface), hby, runtime);
      });
    });
  });
}

/** Start/reuse allocation for the explicit account AID using the selected onboarding signer. */
export function* kfBootStartCommand(args: Record<string, unknown>): Operation<void> {
  const account = required(args, "account"), alias = parseStringOption(args.accountAlias, "account-alias") ?? "";
  const profile = parseStringOption(args.profile, "profile") ?? "3-of-4";
  const reply = yield* authenticated(args, client => client.start(account, alias, profile));
  writeJsonLine(reply);
}

/** Enroll a permanent local account through its separately selected onboarding signer. */
export function* kfBootOnboardCommand(args: Record<string, unknown>): Operation<void> {
  const alias = required(args, "alias"), onboardingAlias = required(args, "onboardingAlias", "onboarding-alias");
  const credentialFile = required(args, "credentials"), timeoutMs = timeout(args);
  if (alias === onboardingAlias) throw new ValidationError("--alias and --onboarding-alias must be distinct.");
  const result = yield* authenticated({ ...args, alias: onboardingAlias }, function*(client, hby, runtime) {
    const account = hby.habByName(alias);
    if (!account) throw new ValidationError(`Account alias ${alias} is invalid.`);
    if (!hby.mgr.aeid || !hby.mgr.seed) {
      throw new ValidationError("Account onboarding requires an unlocked encrypted Keeper.");
    }
    return yield* onboardKfAccount({
      client,
      account,
      receiptor: new Receiptor(hby, runtime.protocol, runtime.http, runtime.clock),
      profile: parseStringOption(args.profile, "profile") ?? "3-of-4",
      sessionId: parseStringOption(args.session, "session"),
      timeoutMs,
      credentialFile,
    });
  });
  writeJsonLine(result);
}

/** Inspect one explicit service-owned session or operation without starting another allocation. */
export function* kfBootStatusCommand(args: Record<string, unknown>): Operation<void> {
  const session = parseStringOption(args.session, "session"),
    operation = parseStringOption(args.operation, "operation");
  if (!!session === !!operation) throw new ValidationError("Select exactly one of --session or --operation.");
  const reply = yield* authenticated(args, client => session ? client.session(session) : client.operation(operation!));
  writeJsonLine(reply);
}

/** Explicitly request cancellation; subsequent operation/session status proves cleanup completion. */
export function* kfBootCancelCommand(args: Record<string, unknown>): Operation<void> {
  const session = required(args, "session"), reason = parseStringOption(args.reason, "reason") ?? "";
  const reply = yield* authenticated(args, client => client.cancel(session, reason));
  writeJsonLine(reply);
}
