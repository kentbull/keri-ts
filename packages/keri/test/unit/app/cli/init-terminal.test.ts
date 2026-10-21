import { assertEquals } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { t } from "../../../../../cesr/mod.ts";

Deno.test({
  name: "init terminal - hidden input restores the real terminal on completion, rejection and cancellation",
  ignore: Deno.build.os === "windows", // Unix PTY coverage; noninteractive choices run on every platform.
  async fn() {
    const result = await new Deno.Command("python3", {
      args: [fromFileUrl(new URL("../../../fixtures/init-terminal.py", import.meta.url)), Deno.execPath()],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, `${t(result.stderr)}\n${t(result.stdout)}`);
    assertEquals(JSON.parse(t(result.stdout)), {
      cases: ["confirm", "blank", "mismatch", "cancel", "eof", "halt"],
      hidden: true,
      restored: true,
    });
  },
});
