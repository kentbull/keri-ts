/**
 * Local notification CLI commands.
 *
 * These commands intentionally reopen the `Notifier` sidecar for one bounded
 * operation and close both sidecar and `Habery` afterward. They are operator
 * inspection/mutation tools, not protocol delegation approval commands.
 */
import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import { Notifier, openNoterForHabery } from "../notifying.ts";
import { withExistingHabery } from "./common/context.ts";

interface NotificationsOpenArgs {
  name?: string;
  base?: string;
  headDirPath?: string;
  passcode?: string;
  compat?: boolean;
}

interface NotificationsListArgs extends NotificationsOpenArgs {
  start?: number;
  limit?: number;
}

interface NotificationsRidArgs extends NotificationsOpenArgs {
  rid?: string;
}

function requireName(name?: string): string {
  if (!name) {
    throw new ValidationError("Name is required and cannot be empty");
  }
  return name;
}

function requireRid(rid?: string): string {
  if (!rid) {
    throw new ValidationError("Notification rid is required.");
  }
  return rid;
}

/** Open the signed notification facade for one CLI invocation. */
function* withNotifier<TResult>(
  args: NotificationsOpenArgs,
  use: (context: {
    notifier: Notifier;
  }) => Operation<TResult>,
): Operation<TResult> {
  const name = requireName(args.name);
  return yield* withExistingHabery(
    { ...args, name },
    {
      compat: args.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: false,
    },
    function*({ hby }) {
      const noter = yield* openNoterForHabery(hby);
      const notifier = new Notifier(hby, { noter });
      try {
        return yield* use({ notifier });
      } finally {
        if (notifier.noter.opened) {
          yield* notifier.noter.close();
        }
      }
    },
  );
}

/** Print verified local controller notices as JSON for operator inspection. */
export function* notificationsListCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: NotificationsListArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
    start: args.start as number | undefined,
    limit: args.limit as number | undefined,
  };

  yield* withNotifier(commandArgs, function*({ notifier }) {
    const start = commandArgs.start ?? 0;
    const limit = commandArgs.limit ?? 25;
    const notices = notifier.list(start, limit).map((note) => ({
      rid: note.rid,
      dt: note.datetime,
      read: note.read,
      attrs: note.attrs,
    }));
    console.log(JSON.stringify(
      {
        total: notifier.count(),
        start,
        limit,
        notices,
      },
      null,
      2,
    ));
  });
}

/** Mark one verified notice as read and persist its new detached signature. */
export function* notificationsMarkReadCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: NotificationsRidArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
    rid: args.rid as string | undefined,
  };

  yield* withNotifier(commandArgs, function*({ notifier }) {
    const rid = requireRid(commandArgs.rid);
    const changed = notifier.markRead(rid);
    console.log(changed ? `marked-read ${rid}` : `already-read ${rid}`);
  });
}

/** Remove one verified notice from the notification sidecar. */
export function* notificationsRemoveCommand(
  args: Record<string, unknown>,
): Operation<void> {
  const commandArgs: NotificationsRidArgs = {
    name: args.name as string | undefined,
    base: args.base as string | undefined,
    headDirPath: args.headDirPath as string | undefined,
    passcode: args.passcode as string | undefined,
    compat: args.compat as boolean | undefined,
    rid: args.rid as string | undefined,
  };

  yield* withNotifier(commandArgs, function*({ notifier }) {
    const rid = requireRid(commandArgs.rid);
    const removed = notifier.remove(rid);
    console.log(removed ? `removed ${rid}` : `missing ${rid}`);
  });
}
