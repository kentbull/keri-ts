/** Finite KF allocation commands; account activation and wallet admission are separate operations. */
import { ensure, type Operation, race, scoped, sleep } from "effection";
import { parseNumberOption, parseStringOption } from "keri-ts/cli";
import { createAgentRuntime, FetchHttpClient, type KramConfig, systemClock, ValidationError } from "keri-ts/runtime";
import { discoverKfBoot, KfBootClient, type KfBootReply } from "../../operator/kfboot/client.ts";
import { withExistingHab } from "../support/context.ts";
import { writeJsonLine } from "../support/rendering.ts";

/** Validate explicit command coordinates before opening stores or submitting a signed request. */
function required(args: Record<string, unknown>, key: string): string {
  const value = parseStringOption(args[key], key);
  if (!value) throw new ValidationError(`--${key} is required.`);
  return value;
}

/** Bound one command's owned network work and join it before returning or closing the store. */
function* timed<T>(args: Record<string, unknown>, work: () => Operation<T>): Operation<T> {
  const seconds = parseNumberOption(args.timeout, "timeout") ?? 60;
  if (!Number.isFinite(seconds) || seconds <= 0) throw new ValidationError("KF boot --timeout must be positive.");
  return yield* race([
    work(),
    (function*(): Operation<never> {
      yield* sleep(seconds * 1000);
      throw new ValidationError("KF boot command timed out; inspect the existing session before retrying allocation.");
    })(),
  ]);
}

/** Discovery is public configuration and never reports account or allocation acceptance. */
export function* kfBootDiscoverCommand(args: Record<string, unknown>): Operation<void> {
  const provider = required(args, "url");
  const discovery = yield* timed(args, () => discoverKfBoot(new FetchHttpClient(), provider));
  writeJsonLine(discovery);
}

/** Compose the selected existing signer with ordinary KRAM; retain no separate provider ledger. */
function* authenticated(
  args: Record<string, unknown>,
  use: (client: KfBootClient) => Operation<KfBootReply>,
): Operation<KfBootReply> {
  const provider = required(args, "url"), alias = required(args, "alias");
  const server = parseStringOption(args.serverAid, "server-aid");
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
        return yield* use(new KfBootClient(hby, hab, runtime.protocol, http, discovery, server));
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
