/** Registry event status, settle and wait over a real group anchor and v2 registry store. */
import { concatBytes } from "cesr-ts";
import { run } from "effection";
import { assertEquals } from "jsr:@std/assert";
import { regcept as acdcV2Regcept } from "../../../../src/acdc/messaging.ts";
import {
  registryEventRef,
  registryEventStatus,
  settleRegistryEvent,
  waitForRegistryEvent,
} from "../../../../src/app/credentials/registry-settling.ts";
import { approveAcdcV2Registry } from "../../../../src/app/multisig/multisig-workflows.ts";
import { proposeRegistryEvent } from "../../../../src/app/multisig/proposing.ts";
import { depsFor, pair } from "./registry-fixture.ts";

Deno.test("a registry event moves from awaiting-anchor to accepted as the anchor completes and escrows settle", async () => {
  await run(function*() {
    yield* pair("2", function*(p) {
      const wires: Uint8Array[] = [];
      p.receiver.postman.sendStream =
        ((evt: { msgs: Uint8Array[] }) => (wires.push(...evt.msgs), { ...evt, kin: "msg" })) as never;
      const proposed = yield* proposeRegistryEvent(
        depsFor(p.left, p.receiver, []),
        p.group,
        acdcV2Regcept(p.group.pre),
      );
      const tel = p.receiver.acdc!.store.event(proposed.embedded)!;
      const ref = registryEventRef(tel, proposed.event);
      const deps = { db: p.left.db, store: p.receiver.acdc!.store, protocol: p.receiver.protocol };
      assertEquals(registryEventStatus(deps, ref), { state: "awaiting-anchor" });
      assertEquals(proposed.accepted, false);

      // An expired wait is a returned value carrying the status read at return.
      const waited = yield* waitForRegistryEvent(deps, ref, { deadline: Date.now() + 20 });
      assertEquals(waited.outcome, "timed-out");
      assertEquals(waited.status, { state: "awaiting-anchor" });

      // The peer approves the exact proposal; its contribution completes the anchor.
      yield* p.sender.reactor.processBytes(wires[0], { local: true });
      const anchor = p.left.db.getEvtSerder(p.group.pre, proposed.event.said)!;
      const [peer, peerFoot] = yield* approveAcdcV2Registry(
        p.right,
        p.sender.protocol,
        p.right.habs.get(p.group.pre)!,
        tel,
        {
          anchor,
        },
      );
      yield* p.receiver.reactor.processBytes(concatBytes(peer.raw, peerFoot), { local: true });

      // Settling reprocesses escrows only; it is idempotent and signs nothing.
      const settled = yield* settleRegistryEvent(deps, ref);
      assertEquals(settled, { state: "accepted" });
      assertEquals(yield* settleRegistryEvent(deps, ref), { state: "accepted" });
      const after = yield* waitForRegistryEvent(deps, ref, { deadline: Date.now() + 1000 });
      assertEquals(after.outcome, "settled");
    });
  });
});
