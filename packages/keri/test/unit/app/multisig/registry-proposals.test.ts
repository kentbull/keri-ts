/** Approving and proposing registry events (vcp and rip/bup) through the proposal API. */
import { concatBytes, Diger, parseBytes, Prefixer, SerderKERI, Vrsn_1_0, Vrsn_2_0 } from "cesr-ts";
import { call, type Operation, run } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import { regcept as acdcV2Regcept } from "../../../../src/acdc/messaging.ts";
import { inceptCredentialRegistry } from "../../../../src/app/credentials/credential-workflows.ts";
import type { Hab, Habery } from "../../../../src/app/identity/habbing.ts";
import { createHabery } from "../../../../src/app/identity/lmdb-habery.ts";
import type { GroupEventRef } from "../../../../src/app/multisig/counseling.ts";
import { approveGroupProposal } from "../../../../src/app/multisig/proposals.ts";
import { proposeRegistryEvent } from "../../../../src/app/multisig/proposing.ts";
import { type AgentRuntime, createAgentRuntime } from "../../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../../src/app/runtime/runtime-clock.ts";
import { FetchHttpClient } from "../../../../src/app/transport/http-client.ts";
import { TransIdxSigGroup } from "../../../../src/core/dispatch.ts";
import { ValidationError } from "../../../../src/core/errors.ts";
import { exchange } from "../../../../src/core/exchange/protocol-exchanging.ts";
import { interact as interactEvent } from "../../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../../src/core/protocol-serialization.ts";
import { depsFor, pair, ripProposal } from "./registry-fixture.ts";

Deno.test("approveGroupProposal approves a legacy registry proposal and needs its name first", async () => {
  await run(function*() {
    yield* pair("1", function*(p) {
      const wires: Uint8Array[] = [];
      p.receiver.postman.send = evt => (wires.push(evt.msg), { ...evt, kin: "msg" });
      p.receiver.postman.wait = function*(evt) {
        return { kin: "sent", evt, deliveries: ["peer"] };
      };
      yield* inceptCredentialRegistry(p.receiver.vdr!, p.receiver.reactor, p.receiver.postman, p.group, {
        registryName: "proposed",
      });
      const wire = wires[0];
      const wrapper = new SerderKERI({ raw: wire });
      yield* p.sender.reactor.processBytes(wire, { local: true });
      const started: GroupEventRef[] = [];
      const deps = depsFor(p.right, p.sender, started);
      yield* call(() =>
        assertRejects(
          () => run(() => approveGroupProposal(deps, wrapper.said!)),
          ValidationError,
          "registry name",
        )
      );
      assertEquals(started, []);
      const result = yield* approveGroupProposal(deps, wrapper.said!, { registryName: "approved-name" });
      assertEquals(result.route, "/multisig/vcp");
      assertEquals(result.group, p.group.pre);
      assertExists(p.sender.vdr!.reger.regs.get("approved-name"));
      assertEquals(started.length, 1);
      assertEquals(result.event, started[0]);
    });
  });
});

Deno.test("approveGroupProposal approves a rip proposal and counsels its anchor", async () => {
  await run(function*() {
    yield* pair("2", function*(p) {
      const { rip, anchor, wrapper, candidate } = ripProposal(p);
      assertEquals((yield* p.receiver.exc.processEvent(candidate)).kind, "accept");
      const started: GroupEventRef[] = [];
      const result = yield* approveGroupProposal(depsFor(p.left, p.receiver, started), wrapper.said!);
      assertEquals(result.route, "/multisig/rip");
      assertEquals(result.embedded, rip.said);
      assertEquals(result.event, { pre: p.group.pre, sn: 1, said: anchor.said });
      assertEquals(started, [result.event]);
      assertEquals(p.receiver.exc.complete(result.said), true);
    });
  });
});

Deno.test("proposeRegistryEvent authors the anchor, counsels it and publishes the proposal", async () => {
  await run(function*() {
    yield* pair("1", function*(p) {
      const started: GroupEventRef[] = [];
      const deps = depsFor(p.left, p.receiver, started);
      const rip = acdcV2Regcept(p.group.pre);
      const result = yield* proposeRegistryEvent(deps, p.group, rip);
      assertEquals(result.route, "/multisig/rip");
      assertEquals(result.embedded, rip.said);
      assertEquals(result.event.pre, p.group.pre);
      assertEquals(result.event.sn, 1);
      assertEquals(started, [result.event]);
      assertEquals(result.messages.length, 1);
      assertEquals(result.accepted, true);
    });
  });
});
