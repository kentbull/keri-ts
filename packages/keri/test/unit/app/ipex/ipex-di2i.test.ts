/** Application DI2I policy remains separate from the selected IPEX operator profile. */
import { type CesrFrame, Diger, NumberPrimitive, Prefixer, type SerderACDC, Vrsn_2_0 } from "cesr-ts";
import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { evaluateAcdcRelations } from "../../../../src/acdc/graphing.ts";
import { Exchanger } from "../../../../src/app/exchanges/exchanging.ts";
import type { Hab } from "../../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../../src/app/ipex/ipex-building.ts";
import { loadIpexHandlers } from "../../../../src/app/ipex/ipexing.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { messageAttachmentGroups } from "../../../../src/core/protocol-serialization.ts";
import { delegationChain, graph, learn } from "../../../fixtures/acdc-delegation.ts";

/** Current key-state signatures authenticate a node independently from its parent's proof. */
function signedNode(body: SerderACDC, hab: Hab): CesrFrame {
  return {
    body,
    gvrsn: Vrsn_2_0,
    attachments: messageAttachmentGroups({
      tsgs: [
        new TransIdxSigGroup(
          new Prefixer({ qb64: hab.pre }),
          NumberPrimitive.fromNum(BigInt(hab.kever!.lastEst.s)),
          new Diger({ qb64: hab.kever!.lastEst.d }),
          hab.sign(body.raw, true),
        ),
      ],
    }, Vrsn_2_0),
  };
}

Deno.test("IPEX refuses unsupported DI2I while application delegation policy remains independently evaluable", async () => {
  await run(function*() {
    const { validator, chain, approvals } = yield* delegationChain(1);
    const recipient = validator.makeHab("recipient");
    const evidence = graph(chain[1].pre, chain[0].pre);
    const nodes = [...evidence.nodes.values()].map(({ body }) => body);
    const nests = nodes.map((body) => signedNode(body, chain[1]));
    const grant = ipexExnBody(chain[1].pre, "/ipex/grant", nodes, {
      message: "approved issuer",
      recipient: recipient.pre,

      // Request node presence; dedicated IPEX closure controls own whole-disclosure claims.
      plan: nodes.map((body, index) => [(body.schema as { $id: string }).$id, index ? "/e/link/_/" : "/", []]),
    });
    const exchanger = new Exchanger(validator);
    loadIpexHandlers(validator, exchanger);
    const tsgs = [
      new TransIdxSigGroup(
        new Prefixer({ qb64: chain[1].pre }),
        NumberPrimitive.fromNum(0n),
        new Diger({ qb64: chain[1].kever!.lastEst.d }),
        chain[1].sign(grant.raw, true),
      ),
    ];
    assertEquals((yield* exchanger.processEvent({ serder: grant, tsgs, nests })).kind, "reject");
    assertEquals(validator.db.exns.get(grant.said!), null);
    assertEquals(validator.db.epse.get(grant.said!), null);
    assertEquals(evaluateAcdcRelations(evidence, validator.db, new Map()), { kind: "missingKel", pre: chain[0].pre });
    yield* learn(validator, approvals[0]);
    assertEquals(evaluateAcdcRelations(evidence, validator.db, new Map()), true);
    assertEquals(
      (yield* exchanger.processEvent({ serder: grant, tsgs, nests })).kind,
      "reject",
      "KEL arrival cannot implement an unsupported IPEX operator",
    );
    for (const node of nodes) assertEquals(validator.db.exns.get(node.said!), null);
  });
});
