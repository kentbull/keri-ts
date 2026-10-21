/** Mixed-member legacy credential evidence over real HTTP; Python uses public APIs, not KLI join. */
import { call, run, scoped, spawn } from "effection";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { concatBytes, parseBytes, type SerderKERI } from "../../../../cesr/mod.ts";
import { createProtocolHandler } from "../../../../tufa/src/http/protocol-handler.ts";
import { createAgentRuntime, runAgentRuntime } from "../../../src/app/agent-runtime.ts";
import { collectBytes } from "../../../src/app/byte-source.ts";
import { requestFrame } from "../../../src/app/cesr-egress.ts";
import { waitForTelPublication } from "../../../src/app/cli/common/tel-completion.ts";
import { revokeCredential } from "../../../src/app/credential-revoking.ts";
import { createCredential, inceptCredentialRegistry } from "../../../src/app/credential-workflows.ts";
import { createHabery } from "../../../src/app/habbing.ts";
import { FetchHttpClient } from "../../../src/app/http-client.ts";
import { credentialPresentationArtifacts, ipexCredentialGrant } from "../../../src/app/ipex-credentialing.ts";
import {
  approveMultisigIpex,
  publishInitialGroupIpex,
  sendCompletedGroupIpex,
} from "../../../src/app/ipex-grouping.ts";
import { ipexOfferExn, ipexSpurnExn } from "../../../src/app/ipexing.ts";
import { approvePendingMultisigProposal } from "../../../src/app/multisig-workflows.ts";
import { systemClock } from "../../../src/app/runtime-clock.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { createInteropContext, randomPort, spawnChild, withStartedChild } from "./interop-test-helpers.ts";
import { selectedKeripyProfile } from "./keripy-runtime.ts";

Deno.test("selected Python and TypeScript public APIs complete reciprocal legacy group credential handoffs", async () => {
  const ctx = await createInteropContext();
  const port = randomPort(), origin = `http://127.0.0.1:${port}`;
  const legacy = selectedKeripyProfile(ctx.env)?.protocolVersionArgument === false;
  const child = spawnChild(
    ctx.pythonCommand,
    [
      "packages/keri/test/fixtures/legacy_group_peer.py",
      String(port),
      ...(legacy ? ["--legacy"] : []),
    ],
    ctx.env,
    ctx.repoRoot,
  );
  try {
    await withStartedChild(child, port, async () => {
      /** Commands only choose signer/processor operations; signed messages use ordinary / intake. */
      async function control(action: string, data: Record<string, unknown> = {}) {
        const response = await fetch(`${origin}/_fixture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action, ...data }),
        });
        const body = await response.text();
        assertEquals(response.status, 200, body);
        return JSON.parse(body) as Record<string, unknown>;
      }
      const accepted = await run(function*() {
        const hby = yield* createHabery({ name: "group-api", headDirPath: ctx.home, skipConfig: true });
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        const member = hby.makeHab("member");
        const handler = createProtocolHandler(runtime, { serviceHab: member, hostedPrefixes: [member.pre] });
        const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, handler);
        const url = `http://127.0.0.1:${server.addr.port}/`;
        /** Use the production detached-attachment sender for every TypeScript frame. */
        function* post(wire: Uint8Array) {
          for (const frame of parseBytes(wire)) {
            yield* scoped(function*() {
              const response = yield* requestFrame(origin, frame, runtime.http);
              yield* call(() => collectBytes(response.body()));
              assertEquals(response.status, 204);
            });
          }
        }
        try {
          yield* post(concatBytes(...hby.db.clonePreIter(member.pre)));
          const peer = yield* call(() => control("connect", { url }));
          const pyPre = String(peer.member);
          for (
            const wire of [
              member.makeEndRole(member.pre, "controller", true),
              member.makeLocScheme(url, member.pre, "http"),
            ]
          ) {
            yield* runtime.reactor.processBytes(wire);
            yield* post(wire);
          }
          const made = hby.makeGroupHab("group", member, [member.pre, pyPre], [member.pre, pyPre], undefined, {
            isith: "2",
            nsith: "2",
          });
          yield* post(made.message);
          const joined = yield* call(() => control("group", { member: member.pre }));
          assertEquals(joined.group, made.hab.pre);
          assertExists(hby.db.getKever(made.hab.pre));
          const schema = new Schemer({ sed: { $id: "", title: "InteropGroupCredential", type: "object" } });
          hby.db.schema.pin(schema.said, schema);
          yield* call(() => control("schema", { schema: schema.sed }));
          const worker = yield* spawn(() => runAgentRuntime(runtime, { hab: member }));
          try {
            const rgy = runtime.vdr!;
            const registry = yield* inceptCredentialRegistry(rgy, runtime.reactor, runtime.postman, made.hab, {
              registryName: "registry",
            });
            assertEquals(registry.group!.accepted, false);
            yield* call(() => control("endorse", { said: registry.group!.messages[0].exnSaid }));
            assertEquals(
              yield* waitForTelPublication(rgy.publication, registry.registry!, 0, Date.now() + 10_000),
              true,
            );
            const issued = yield* createCredential(rgy, runtime.reactor, runtime.postman, {
              registryName: "registry",
              schema: schema.said,
              recipient: pyPre,
              data: { role: "member" },
            });
            assertEquals(issued.group!.saved, false);
            yield* call(() => control("endorse", { said: issued.group!.messages[0].exnSaid }));
            const said = issued.creder.said!;
            assertEquals(yield* waitForTelPublication(rgy.publication, said, 0, Date.now() + 10_000), true);
            yield* runtime.protocol.processEscrowsOnce();
            assertExists(rgy.reger.saved.get(said));
            const pyIssued = yield* call(() => control("snapshot", { registry: registry.registry, credential: said }));
            assertEquals(pyIssued.state, "iss");
            assertEquals(pyIssued.saved, true);
            const pythonIssue = yield* call(() =>
              control("issue", {
                registry: registry.registry,
                schema: schema.said,
                recipient: member.pre,
              })
            );
            const pythonSaid = String(pythonIssue.credential);
            const approved = yield* approvePendingMultisigProposal(hby, runtime, {
              said: String(pythonIssue.exnSaid),
              callbacks: {
                approveProposal: () => true,
                chooseGroupAlias: () => "group",
                chooseRegistryName: () => "registry",
              },
            });
            assertEquals(approved?.accepted, true);
            assertEquals(yield* waitForTelPublication(rgy.publication, pythonSaid, 0, Date.now() + 10_000), true);
            yield* runtime.protocol.processEscrowsOnce();
            assertExists(rgy.reger.saved.get(pythonSaid));
            const pyAuthored = yield* call(() =>
              control("snapshot", { registry: registry.registry, credential: pythonSaid })
            );
            assertEquals(pyAuthored.state, "iss");
            assertEquals(pyAuthored.saved, true);
            /** Reuse the production approval/lead-delivery flow for offer, grant and spurn. */
            const completeGroupExchange = function*(event: SerderKERI, wire: Uint8Array) {
              const publication = yield* publishInitialGroupIpex(
                hby,
                runtime.protocol,
                runtime.postman,
                made.hab,
                wire,
              );
              assertEquals(runtime.exc.complete(event.said!), false);
              const approval = yield* call(() =>
                control("approve-exchange", { said: publication.messages[0].exnSaid })
              );
              assertEquals(approval.accepted, event.said);
              const completed = yield* approveMultisigIpex(
                hby,
                runtime.protocol,
                runtime.postman,
                rgy.reger,
                hby.db.exns.get([String(approval.exnSaid)])!,
                { sendLead: false },
              );
              assertEquals(completed.accepted, true);
              assertEquals(runtime.exc.complete(event.said!), true);
              assertEquals(runtime.exc.lead(made.hab, event.said!), true);
              const destinations = yield* sendCompletedGroupIpex(hby, runtime.postman, rgy.reger, made.hab, event);
              assertEquals(destinations.length > 0, true);
              const peerAccepted = yield* call(() =>
                control("snapshot", { registry: registry.registry, credential: said, exchange: event.said })
              );
              assertEquals(peerAccepted.accepted, true);
            };
            const request = yield* call(() =>
              control("request", { schema: schema.said, message: "credential please" })
            );
            const application = hby.db.exns.get([String(request.said)])!;
            assertEquals(application.route, "/ipex/apply");
            const artifacts = credentialPresentationArtifacts(hby, rgy.reger, said);
            const [offer, offerAttachments] = ipexOfferExn(made.hab, "offered", artifacts.acdc.wire, application);
            yield* completeGroupExchange(
              offer,
              concatBytes(made.hab.endorse(offer, { pipelined: false }), offerAttachments),
            );
            const agreement = yield* call(() => control("agree", { said: offer.said }));
            const agreed = hby.db.exns.get([String(agreement.said)])!;
            assertEquals(agreed.route, "/ipex/agree");
            assertEquals(agreed.ked?.p, offer.said);
            // The Python member is also this credential's recipient. This checks
            // mixed group approval/business handoff; independent-holder wallet
            // settlement remains covered by the separate maintained CLI workflow.
            const grant = ipexCredentialGrant({
              hby,
              hab: made.hab,
              reger: rgy.reger,
              recipient: pyPre,
              credentialSaid: said,
              options: { agree: agreed },
            });
            yield* completeGroupExchange(grant.grant, grant.wire);
            const admission = yield* call(() => control("admit", { said: grant.grant.said }));
            const receivedAdmit = hby.db.exns.get([String(admission.said)]);
            assertEquals(receivedAdmit?.route, "/ipex/admit");
            assertEquals(receivedAdmit?.ked?.p, grant.grant.said);
            const refusedRequest = yield* call(() =>
              control("request", { schema: schema.said, message: "second request" })
            );
            const refused = hby.db.exns.get([String(refusedRequest.said)])!;
            const [spurn, spurnAttachments] = ipexSpurnExn(made.hab, "declined", refused);
            yield* completeGroupExchange(
              spurn,
              concatBytes(made.hab.endorse(spurn, { pipelined: false }), spurnAttachments),
            );
            assertEquals(hby.db.exns.get([spurn.said!])?.ked?.p, refused.said);
            const revoked = yield* revokeCredential(rgy, runtime.reactor, runtime.postman, {
              registryName: "registry",
              credentialSaid: said,
            });
            yield* call(() => control("endorse", { said: revoked.group!.messages[0].exnSaid }));
            assertEquals(yield* waitForTelPublication(rgy.publication, said, 1, Date.now() + 10_000), true);
            const pyRevoked = yield* call(() => control("snapshot", { registry: registry.registry, credential: said }));
            assertEquals(pyRevoked.state, "rev");
            assertEquals(rgy.tvy.tevers.get(registry.registry!)?.vcState(said)?.et, "rev");
            return { registry: registry.registry!, credential: said, revocation: revoked.tel };
          } finally {
            yield* worker.halt();
          }
        } finally {
          yield* call(() => server.shutdown());
          yield* call(() => handler.close?.());
          yield* runtime.close();
          yield* hby.close();
        }
      });
      // New owners load the committed mixed-member evidence without any live
      // parser, key-state cache or retained Python response from the first scope.
      await run(function*() {
        const hby = yield* createHabery({ name: "group-api", headDirPath: ctx.home, skipConfig: true });
        const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock);
        try {
          const state = runtime.vdr!.tvy.tevers.get(accepted.registry)?.vcState(accepted.credential);
          assertEquals(state?.et, "rev");
          assertEquals(state?.d, accepted.revocation);
        } finally {
          yield* runtime.close();
          yield* hby.close();
        }
      });
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});
