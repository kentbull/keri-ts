/** Mailbox presentation retains the independently pinned fork that implements mailbox hosting. */
import { fromFileUrl } from "jsr:@std/path/from-file-url";
import { createInteropContext, randomPort, spawnChild, withStartedChild } from "./interop-test-helpers.ts";
import { presentationCutoff } from "./ipex-presentation-workflow.ts";

const PROVIDER = fromFileUrl(new URL("../../fixtures/kram-mailbox-peer.py", import.meta.url));
for (const count of [1, 2]) {
  Deno.test(`IPEX mailbox presentation cutoff: ${count}-signer holder, Python provider and three witnesses`, async () => {
    const ctx = await createInteropContext(), port = randomPort();
    const provider = spawnChild(
      ctx.pythonCommand,
      [PROVIDER, String(port), "1", `${ctx.home}/mailbox`],
      ctx.env,
      ctx.repoRoot,
    );
    try {
      await withStartedChild(provider, port, () => presentationCutoff(count, `http://127.0.0.1:${port}/`));
    } finally {
      await Deno.remove(ctx.home, { recursive: true });
    }
  });
}
