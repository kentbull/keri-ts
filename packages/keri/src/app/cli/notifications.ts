import { type Operation } from "npm:effection@^3.6.0";
import { ValidationError } from "../../core/errors.ts";
import type { Habery } from "../habbing.ts";
import { Notifier, openNoterForHabery } from "../notifying.ts";
import { setupHby } from "./common/existing.ts";

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

function* openNotifier(args: NotificationsOpenArgs): Operation<{
  hby: Habery;
  notifier: Notifier;
}> {
  const hby = yield* setupHby(
    requireName(args.name),
    args.base ?? "",
    args.passcode,
    false,
    args.headDirPath,
    {
      compat: args.compat ?? false,
      readonly: false,
      skipConfig: true,
      skipSignator: false,
    },
  );
  const noter = yield* openNoterForHabery(hby);
  return {
    hby,
    notifier: new Notifier(hby, { noter }),
  };
}

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

  const { hby, notifier } = yield* openNotifier(commandArgs);
  try {
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
  } finally {
    if (notifier.noter.opened) {
      yield* notifier.noter.close();
    }
    yield* hby.close();
  }
}

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

  const { hby, notifier } = yield* openNotifier(commandArgs);
  try {
    const rid = requireRid(commandArgs.rid);
    const changed = notifier.markRead(rid);
    console.log(changed ? `marked-read ${rid}` : `already-read ${rid}`);
  } finally {
    if (notifier.noter.opened) {
      yield* notifier.noter.close();
    }
    yield* hby.close();
  }
}

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

  const { hby, notifier } = yield* openNotifier(commandArgs);
  try {
    const rid = requireRid(commandArgs.rid);
    const removed = notifier.remove(rid);
    console.log(removed ? `removed ${rid}` : `missing ${rid}`);
  } finally {
    if (notifier.noter.opened) {
      yield* notifier.noter.close();
    }
    yield* hby.close();
  }
}
