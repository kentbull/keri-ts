import { b, Diger, Prefixer, Texter } from "cesr-ts";
import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { fromFileUrl } from "jsr:@std/path";
import { Exchanger } from "../../../src/app/exchanging.ts";
import { createHabery, type Hab } from "../../../src/app/habbing.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { exchange } from "../../../src/core/protocol-exchanging.ts";
import { createScenarioContext, runCmd } from "./interop-keystore-helpers.ts";

/** Produce a signed commitment using the real sender's accepted establishment state. */
function input(sender: Hab, raw: string) {
  const [serder] = exchange("/essr/store", {}, {
    sender: sender.pre,
    diger: new Diger({ raw: Diger.digest(b(raw), "E"), code: "E" }),
  });
  return {
    serder,
    tsgs: [
      new TransIdxSigGroup(
        new Prefixer({ qb64: sender.pre }),
        sender.kever!.sner,
        new Diger({ qb64: sender.kever!.said }),
        sender.sign(serder.raw, true),
      ),
    ],
  };
}

Deno.test("interop/essr-storage - Python reads repeated TS rows; TS reopens Python-written evidence", async () => {
  const ctx = await createScenarioContext(), name = "essr-storage";
  const options = { name, headDirPath: ctx.env.HOME, compat: true, skipConfig: true };
  try {
    const { accepted, pending } = await run(function*() {
      const hby = yield* createHabery(options);
      try {
        const sender = hby.makeHab("sender"), exchanger = new Exchanger(hby);
        const accepted = input(sender, "abcabc"), pending = input(sender, "xyzuvw");
        assertEquals(
          (yield* exchanger.processEvent({
            ...accepted,
            essrs: ["abc", "abc"].map((raw) => new Texter({ raw: b(raw), code: "4B" })),
          })).kind,
          "accept",
        );
        assertEquals(
          (yield* exchanger.processEvent({
            ...pending,
            essrs: ["xyz", "uvw"].map((raw) => new Texter({ raw: b(raw), code: "4B" })),
          })).kind,
          "accept",
        );
        return { accepted: accepted.serder.said!, pending: pending.serder.said! };
      } finally {
        yield* hby.close();
      }
    });
    const result = await runCmd(
      ctx.pythonCommand,
      [
        fromFileUrl(new URL("./essr-store-reference.py", import.meta.url)),
        ctx.env.HOME,
        name,
        accepted,
        pending,
      ],
      ctx.env,
      ctx.packageRoot,
    );
    assertEquals(result.code, 0, `${result.stderr}\n${result.stdout}`);
    assertEquals(JSON.parse(result.stdout), { read: ["abc", "abc"], written: ["xyz", "uvw"] });
    await run(function*() {
      const hby = yield* createHabery(options);
      try {
        const exchanger = new Exchanger(hby);
        assertEquals(hby.db.getEssrs(accepted)!.map((part) => part.text), ["abc", "abc"]);
        assertEquals(hby.db.getEssrs(pending)!.map((part) => part.text), ["xyz", "uvw"]);
        assertEquals(exchanger.complete(pending), true);
        assertEquals(hby.db.epse.get([pending]), null);
      } finally {
        yield* hby.close();
      }
    });
  } finally {
    await Deno.remove(ctx.env.HOME, { recursive: true });
  }
});
