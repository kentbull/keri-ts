// @file-test-lane app-fast-parallel

import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import {
  notificationsListCommand,
  notificationsMarkReadCommand,
  notificationsRemoveCommand,
} from "../../../src/app/cli/notifications.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { Notifier, openNoterForHabery } from "../../../src/app/notifying.ts";
import { CLITestHarness } from "../../../test/utils.ts";

async function captureCommand(
  args: Record<string, unknown>,
  command: (args: Record<string, unknown>) => ReturnType<typeof notificationsListCommand>,
): Promise<string[]> {
  const harness = new CLITestHarness();
  harness.captureOutput();
  try {
    await run(() => command(args));
    return harness.getOutput();
  } finally {
    harness.restoreOutput();
  }
}

Deno.test("notifications CLI list, mark-read, and remove round-trip local notices", async () => {
  const name = `notifications-cli-${crypto.randomUUID().slice(0, 8)}`;
  const headDirPath = await Deno.makeTempDir({
    prefix: "notifications-cli-",
  });

  try {
    await run(function*() {
      const hby = yield* createHabery({
        name,
        headDirPath,
        skipConfig: true,
      });
      const noter = yield* openNoterForHabery(hby);
      const notifier = new Notifier(hby, { noter });

      try {
        notifier.add({
          r: "/delegate/request",
          src: "EA",
          delpre: "EB",
        });
      } finally {
        yield* noter.close();
        yield* hby.close();
      }
    });

    const listed = await captureCommand(
      { name, headDirPath },
      notificationsListCommand,
    );
    const initial = JSON.parse(listed.join("\n")) as {
      total: number;
      notices: Array<{ rid: string; read: boolean }>;
    };
    assertEquals(initial.total, 1);
    assertEquals(initial.notices.length, 1);
    assertEquals(initial.notices[0]!.read, false);

    const rid = initial.notices[0]!.rid;
    const marked = await captureCommand(
      { name, headDirPath, rid },
      notificationsMarkReadCommand,
    );
    assertEquals(marked.at(-1), `marked-read ${rid}`);

    const relisted = await captureCommand(
      { name, headDirPath },
      notificationsListCommand,
    );
    const reread = JSON.parse(relisted.join("\n")) as {
      notices: Array<{ read: boolean }>;
    };
    assertEquals(reread.notices[0]!.read, true);

    const removed = await captureCommand(
      { name, headDirPath, rid },
      notificationsRemoveCommand,
    );
    assertEquals(removed.at(-1), `removed ${rid}`);

    const empty = await captureCommand(
      { name, headDirPath },
      notificationsListCommand,
    );
    const finalList = JSON.parse(empty.join("\n")) as {
      total: number;
      notices: unknown[];
    };
    assertEquals(finalList.total, 0);
    assertEquals(finalList.notices.length, 0);
  } finally {
    await Deno.remove(headDirPath, { recursive: true }).catch(() => undefined);
  }
});
