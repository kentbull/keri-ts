/** Negation uses authenticated node facts; unknown or malformed evidence never becomes true. */
import { Vrsn_2_0 } from "cesr-ts";
import { ensure, run } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { acdcmap } from "../../../src/acdc/messaging.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { walkIpexGraph } from "../../../src/app/ipex-graph.ts";

Deno.test("IPEX graph dependency order handles shared cross-links independently of disclosure order", async () => {
  await run(function*() {
    const hby = yield* createHabery({ name: crypto.randomUUID(), temp: true, skipConfig: true });
    yield* ensure(() => hby.close(true));
    const issuer = hby.makeHab("issuer");
    const tail = acdcmap(issuer.pre, { attribute: { d: "", name: "tail" } });
    const left = acdcmap(issuer.pre, {
      attribute: { d: "", name: "left" },
      edge: { d: "", link: { n: tail.said, o: "NI2I" } },
    });
    const right = acdcmap(issuer.pre, {
      attribute: { d: "", name: "right" },
      edge: { d: "", link: { n: left.said, o: "NI2I" } },
    });
    const root = acdcmap(issuer.pre, {
      attribute: { d: "", name: "root" },
      edge: { d: "", left: { n: left.said, o: "NI2I" }, right: { n: right.said, o: "NI2I" } },
    });
    const graph = walkIpexGraph(
      root.said!,
      [root, left, right, tail].map((body) => ({
        body,
        attachments: [],
        gvrsn: Vrsn_2_0,
      })),
      true,
    );
    assertExists(graph);
    assertEquals(graph.order, [root.said!, left.said!, right.said!, tail.said!]);
    assertEquals(graph.dependencyOrder, [tail.said!, left.said!, right.said!, root.said!]);
  });
});
