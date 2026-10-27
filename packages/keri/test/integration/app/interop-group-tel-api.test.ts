/** Mixed-member legacy credential evidence over real HTTP; Python uses public APIs, not KLI join. */
import { createProtocolHandler } from "@keri-ts/hosting";
import { call, run, scoped, spawn } from "effection";
import { assertEquals, assertExists, assertRejects } from "jsr:@std/assert";
import reference from "../../../../../scripts/ci/keripy-reference.json" with { type: "json" };
import {
  concatBytes,
  Counter,
  Diger,
  makeBlindState,
  NumberPrimitive,
  parseBytes,
  type SerderACDC,
  type SerderKERI,
  Vrsn_1_0,
  Vrsn_2_0,
} from "../../../../cesr/mod.ts";
import { createWalletBaser, type PreparedGrantBody, Wallet, WalletDiscloser } from "../../../../wallet/mod.ts";
import { acdcmap, blindate as acdcBlindate } from "../../../src/acdc/messaging.ts";
import type { RegistryDisclosure } from "../../../src/acdc/regeventing.ts";
import { publicOpeningAttachment } from "../../../src/acdc/registering.ts";
import { deliverCredentialRevocation, revokeCredential } from "../../../src/app/credentials/credential-revoking.ts";
import { createCredential, inceptCredentialRegistry } from "../../../src/app/credentials/credential-workflows.ts";
import { groupEndorseReply } from "../../../src/app/identity/endpoint-roleing.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/identity/habbing.ts";
import { credentialPresentationArtifacts, ipexCredentialGrant } from "../../../src/app/ipex/ipex-credentialing.ts";
import {
  approveMultisigIpex,
  prepareAcdcV2GroupIpex,
  publishInitialGroupIpex,
  sendCompletedGroupIpex,
} from "../../../src/app/ipex/ipex-grouping.ts";
import { ipexOfferExn, ipexSpurnExn } from "../../../src/app/ipex/ipexing.ts";
import { approveAcdcV2Registry, approvePendingMultisigProposal } from "../../../src/app/multisig/multisig-workflows.ts";
import { envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { collectBytes } from "../../../src/app/transport/byte-source.ts";
import { requestFrame } from "../../../src/app/transport/cesr-egress.ts";
import { buildCesrStreamRequest } from "../../../src/app/transport/cesr-http.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { Receiptor } from "../../../src/app/witness/receipting.ts";
import { waitForTelPublication } from "../../../src/cli/common/tel-completion.ts";
import { reply as replyEvent } from "../../../src/core/protocol-eventing.ts";
import { Schemer } from "../../../src/core/scheming.ts";
import { loadNests } from "../../../src/db/exchange/exchange-nests.ts";
import {
  createInteropContext,
  randomPort,
  runCmdWithTimeout,
  spawnChild,
  withStartedChild,
} from "./interop-test-helpers.ts";
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
        function* post(wire: Uint8Array, destination = origin) {
          for (const frame of parseBytes(wire)) {
            yield* scoped(function*() {
              const response = yield* requestFrame(destination, frame, runtime.http);
              yield* call(() => collectBytes(response.body()));
              assertEquals(response.status, 204);
            });
          }
        }
        try {
          yield* post(concatBytes(...hby.db.clonePreIter(member.pre)));
          const peer = yield* call(() => control("connect", { url }));
          const pyPre = String(peer.member);
          const holderPre = String(peer.holder);
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
            // A third identity/store proves grant acceptance is independent
            // of co-issuance: it has no group member role or credential rows.
            const holderUrl = `${origin}/holder`;
            yield* post(concatBytes(...hby.db.clonePreIter(made.hab.pre)), holderUrl);
            const held = yield* createCredential(rgy, runtime.reactor, runtime.postman, {
              registryName: "registry",
              schema: schema.said,
              recipient: holderPre,
              data: { role: "independent-holder" },
            });
            yield* call(() => control("endorse", { said: held.group!.messages[0].exnSaid }));
            const heldSaid = held.creder.said!;
            assertEquals(yield* waitForTelPublication(rgy.publication, heldSaid, 0, Date.now() + 10_000), true);
            yield* runtime.protocol.processEscrowsOnce();
            const beforeGrant = yield* call(() =>
              control("wallet-snapshot", { registry: registry.registry, credential: heldSaid })
            );
            assertEquals(beforeGrant.saved, false);
            const holderGrant = ipexCredentialGrant({
              hby,
              hab: made.hab,
              reger: rgy.reger,
              recipient: holderPre,
              credentialSaid: heldSaid,
            });
            yield* completeGroupExchange(holderGrant.grant, holderGrant.wire);
            const holderAdmit = yield* call(() => control("wallet-admit", { said: holderGrant.grant.said }));
            assertEquals(hby.db.exns.get([String(holderAdmit.said)])?.ked?.p, holderGrant.grant.said);
            const heldState = yield* call(() =>
              control("wallet-snapshot", {
                registry: registry.registry,
                credential: heldSaid,
                exchange: holderGrant.grant.said,
              })
            );
            assertEquals(heldState.saved, true);
            assertEquals(heldState.state, "iss");
            assertEquals(heldState.accepted, true);
            const heldRevoked = yield* revokeCredential(rgy, runtime.reactor, runtime.postman, {
              registryName: "registry",
              credentialSaid: heldSaid,
            });
            yield* call(() => control("endorse", { said: heldRevoked.group!.messages[0].exnSaid }));
            assertEquals(yield* waitForTelPublication(rgy.publication, heldSaid, 1, Date.now() + 10_000), true);
            yield* deliverCredentialRevocation(rgy, runtime.postman, heldSaid, [holderPre]);
            const heldRevocation = yield* call(() =>
              control("wallet-snapshot", { registry: registry.registry, credential: heldSaid })
            );
            assertEquals(heldRevocation.state, "rev");
            assertEquals(heldRevocation.digest, heldRevoked.tel);
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

Deno.test({
  name: "selected Python and TypeScript explicitly approve ACDC v2 issuer and holder group lifecycles",
  ignore: selectedKeripyProfile(Deno.env.toObject())?.commit !== reference.profiles.candidate.commit,
}, async () => {
  const ctx = await createInteropContext(), port = randomPort(), origin = `http://127.0.0.1:${port}`;
  const child = spawnChild(
    ctx.pythonCommand,
    [
      "packages/keri/test/fixtures/legacy_group_peer.py",
      String(port),
      "--acdc-v2",
      "--root",
      `${ctx.home}/python-groups`,
    ],
    ctx.env,
    ctx.repoRoot,
  );
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  try {
    await withStartedChild(child, port, async () => {
      async function control(role: string, action: string, data: Record<string, unknown> = {}) {
        const response = await fetch(`${origin}/_fixture`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ role, action, ...data }),
        });
        const text = await response.text();
        assertEquals(response.status, 200, text);
        return JSON.parse(text);
      }
      const completed = await run(function*() {
        const roles: {
          hby: Habery;
          runtime: AgentRuntime;
          member: Hab;
          server: ReturnType<typeof Deno.serve>;
          wallet: Wallet;
          discloser: WalletDiscloser;
          url: string;
        }[] = [];
        for (const name of ["issuer", "holder", "verifier"]) {
          const hby = yield* createHabery({ name: `acdc-v2-${name}`, headDirPath: ctx.home, skipConfig: true });
          const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), systemClock, {
              kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
            }),
            member = hby.makeHab("member");
          const server = Deno.serve(
            { hostname: "127.0.0.1", port: 0, onListen() {} },
            createProtocolHandler(runtime, { serviceHab: member, hostedPrefixes: [member.pre] }),
          );
          const db = yield* createWalletBaser({ name: `acdc-v2-${name}`, headDirPath: ctx.home });
          const wallet = new Wallet({ hby, registry: runtime.acdc!.store, exc: runtime.exc, db });
          const receiptor = new Receiptor(hby, runtime.protocol, runtime.http, systemClock);
          roles.push({
            hby,
            runtime,
            member,
            server,
            wallet,
            discloser: new WalletDiscloser(wallet, receiptor),
            url: `http://127.0.0.1:${server.addr.port}/`,
          });
        }
        const [issuer, holder, verifier] = roles;
        const workers = [];
        function* post(raw: Uint8Array, url: string) {
          const response = yield* call(() => fetch(url, { method: "PUT", ...buildCesrStreamRequest(raw) }));
          const detail = yield* call(() => response.text());
          assertEquals(response.status, 204, detail);
        }
        try {
          const peers = yield* call(() =>
            control("issuer", "connect", { origins: { issuer: `${origin}/`, holder: `${origin}/holder` } })
          );
          for (const label of ["issuer", "holder"]) {
            const evidence = encoder.encode(peers[label].kel);
            for (const role of roles) yield* post(evidence, role.url);
            for (const destination of [`${origin}/`, `${origin}/holder`]) yield* post(evidence, destination);
          }
          const schema = new Schemer({ sed: { $id: "", version: "1.0.0", type: "object" } });
          for (const role of roles) role.hby.db.schema.pin(schema.said, schema);
          for (const label of ["issuer", "holder"]) {
            yield* call(() => control(label, "schema", { schema: schema.sed }));
          }
          const groups: Hab[] = [];
          for (const [index, label] of ["issuer", "holder"].entries()) {
            const role = roles[index], peer = peers[label];
            yield* post(encoder.encode(peer.kel), role.url);
            const own = concatBytes(
              Counter.makeGVC(Vrsn_2_0),
              ...role.hby.db.clonePreIter(role.member.pre, 0, Vrsn_2_0),
              Counter.makeGVC(Vrsn_1_0),
              role.member.makeEndRole(role.member.pre, "controller", true),
              role.member.makeLocScheme(role.url, role.member.pre, "http"),
            );
            for (const target of roles) yield* post(own, target.url);
            yield* post(own, index ? `${origin}/holder` : `${origin}/`);
            const mids = [role.member.pre, peer.member];
            const made = role.hby.makeGroupHab("group", role.member, mids, mids, undefined, {
              isith: "2",
              nsith: "2",
            });
            yield* post(
              concatBytes(Counter.makeGVC(Vrsn_1_0), made.message),
              index ? `${origin}/holder` : `${origin}/`,
            );
            const joined = yield* call(() => control(label, "join", { member: role.member.pre }));
            assertEquals(joined.group, made.hab.pre);
            for (const target of roles) yield* post(encoder.encode(joined.kel), target.url);
            groups.push(made.hab);
          }
          const [issuerGroup, holderGroup] = groups;
          assertEquals(issuerGroup.pre === holderGroup.pre, false);
          for (const [index, label] of ["issuer", "holder"].entries()) {
            const event = replyEvent("/end/role/add", {
              cid: groups[index].pre,
              role: "controller",
              eid: peers[label].member,
            }, { pre: groups[index].pre });
            const own = concatBytes(
              Counter.makeGVC(Vrsn_2_0),
              groupEndorseReply(roles[index].hby, groups[index].pre, event, Vrsn_2_0),
            );
            const other = yield* call(() => control(label, "role", { wire: decoder.decode(event.raw) }));
            for (const target of roles) {
              yield* post(own, target.url);
              yield* post(encoder.encode(other.wire), target.url);
            }
            for (const destination of [`${origin}/`, `${origin}/holder`]) {
              yield* post(own, destination);
              yield* post(encoder.encode(other.wire), destination);
            }
          }
          for (const role of roles) {
            workers.push(yield* spawn(() => runAgentRuntime(role.runtime, { hab: role.member })));
          }
          /** Every group operation needs the other actual member's explicit selected-payload approval. */
          const registry = function*(index: number, event: SerderACDC, opening?: RegistryDisclosure) {
            const role = roles[index], label = index ? "holder" : "issuer";
            const [wrapper, foot] = yield* approveAcdcV2Registry(
              role.hby,
              role.runtime.protocol,
              groups[index],
              event,
              { opening },
            );
            const wire = concatBytes(wrapper.raw, foot);
            yield* post(wire, index ? `${origin}/holder` : `${origin}/`);
            const approved = yield* call(() => control(label, "registry", { wire: decoder.decode(wire) }));
            yield* post(encoder.encode(approved.wire), role.url);
            yield* role.runtime.protocol.processEscrowsOnce();
            const regid = event.ilk === "rip" ? event.said! : event.regid!;
            assertEquals(role.runtime.acdc!.store.head(regid)?.qb64, event.said);
            assertEquals(approved.head, event.said);
            const evidence = yield* call(() => control(label, "evidence"));
            for (const target of roles) yield* post(encoder.encode(evidence.wire), target.url);
            for (const destination of [`${origin}/`, `${origin}/holder`]) {
              yield* post(encoder.encode(evidence.wire), destination);
            }
            return event;
          };
          const issuerRegistry = issuer.runtime.acdc!.makeRegistry("issuer-registry", issuerGroup.pre);
          const holderRegistry = holder.runtime.acdc!.makeRegistry("presentation-registry", holderGroup.pre);
          const rip = yield* registry(0, issuerRegistry.store.event(issuerRegistry.regk!)!);
          const presentation = yield* registry(1, holderRegistry.store.event(holderRegistry.regk!)!);
          const credential = acdcmap(issuerGroup.pre, {
            regid: rip.said!,
            schema: schema.said,
            attribute: { d: "", i: holderGroup.pre, rd: presentation.said!, role: "mixed group holder" },
          });
          const issued = makeBlindState({ acdc: credential.said!, state: "issued", sn: 1n });
          const issuance = yield* registry(0, acdcBlindate(rip.said!, rip.said!, issued.d.nonce, { sn: 1 }));
          issuer.wallet.recordIssued(credential, issuance.said!, { blinder: issued });
          assertEquals(holder.wallet.inventory().held.length, 0);
          const openingFile = `${ctx.home}/issued-opening.cesr`;
          Deno.writeFileSync(openingFile, publicOpeningAttachment(issued));
          const pendingGrant = yield* call(() =>
            runCmdWithTimeout(
              Deno.execPath(),
              [
                "run",
                "-A",
                "--no-lock",
                "packages/tufa/mod.ts",
                "ipex",
                "grant",
                "--acdc-v2",
                "--name",
                "acdc-v2-issuer",
                "--head-dir",
                ctx.home,
                "--alias",
                "group",
                "--said",
                credential.said!,
                "--opening",
                openingFile,
                "--recipient",
                holderGroup.pre,
                "--xid",
                issuance.said!,
                "--plan",
                JSON.stringify([[schema.said, "/", []]]),
                "--approval-timeout",
                "0",
              ],
              ctx.env,
              20_000,
              ctx.repoRoot,
            )
          );
          assertEquals(pendingGrant.code, 0, pendingGrant.stderr);
          const pending = JSON.parse(pendingGrant.stdout.trim().split("\n").at(-1)!);
          assertEquals(pending.status, "multisig-pending");
          const proposed = loadNests(issuer.hby.db, pending.messages[0].exnSaid)[0];
          assertEquals(envelopeFromFrame(proposed.nests![0]).bsqs[0].ts.label, "issued");
          assertEquals(
            issuer.runtime.exc.complete(pending.said),
            false,
            "a pending CLI proposal is neither quorum nor wallet consent",
          );
          // Grant body preparation precedes the holder's presentation commitment; signed bytes never change.
          const selected = yield* issuer.discloser.prepareGrantBody(issuerGroup.pre, {
            said: credential.said!,
            openings: [issued],
          }, {
            message: "group issuance",
            recipient: holderGroup.pre,
            xid: issuance.said!,
            plan: [[schema.said, "/", []]],
          });
          assertEquals(selected.exn.sad!.ri, holderGroup.pre);
          let presentationHead = presentation.said!, presentationSn = 0;
          const presentationProof = function*(selected: PreparedGrantBody) {
            const opening = makeBlindState({
              acdc: selected.exn.said!,
              state: "presented",
              sn: BigInt(++presentationSn),
            });
            const update = yield* registry(
              1,
              acdcBlindate(presentation.said!, presentationHead, opening.d.nonce, { sn: presentationSn }),
            );
            presentationHead = update.said!;
            const anchor = holderGroup.kever!.serder;
            const prepared = yield* holder.discloser.attachPresentationProof(selected, opening, {
              s: NumberPrimitive.fromNum(BigInt(anchor.sn!)),
              d: new Diger({ qb64: anchor.said! }),
            });
            return concatBytes(
              Counter.makeGVC(Vrsn_2_0),
              prepared.exn.raw,
              Counter.enclose({ qb64: prepared.nests, version: Vrsn_2_0 }),
            );
          };
          const completeExchange = function*(index: number, exn: SerderKERI, candidate: Uint8Array) {
            const role = roles[index], label = index ? "holder" : "issuer";
            const first = yield* prepareAcdcV2GroupIpex(role.hby, role.runtime.protocol, groups[index], candidate);
            assertExists(first);
            assertEquals(role.runtime.exc.complete(exn.said!), false, "one member share is not group acceptance");
            const published = yield* publishInitialGroupIpex(
              role.hby,
              role.runtime.protocol,
              role.runtime.postman,
              groups[index],
              first,
              Vrsn_2_0,
            );
            const wrapper = yield* call(async () => {
              const chunks = [];
              for await (const chunk of role.runtime.exc.replay(published.messages[0].exnSaid)) chunks.push(chunk);
              return concatBytes(...chunks);
            });
            const approved = yield* call(() => control(label, "exchange", { wire: decoder.decode(wrapper) }));
            yield* post(encoder.encode(approved.wire), role.url);
            yield* role.runtime.protocol.processEscrowsOnce();
            assertEquals(approved.complete, true);
            assertEquals(role.runtime.exc.complete(exn.said!), true);
            assertEquals(role.hby.db.exns.get([exn.said!])!.raw, exn.raw);
            return yield* call(async () => {
              const chunks = [];
              for await (const chunk of role.runtime.exc.replay(exn.said!)) chunks.push(chunk);
              return concatBytes(...chunks);
            });
          };
          const grantCandidate = yield* presentationProof(selected);
          const grantWire = yield* completeExchange(0, selected.exn, grantCandidate);
          const deliveries = yield* sendCompletedGroupIpex(
            issuer.hby,
            issuer.runtime.postman,
            null,
            issuerGroup,
            selected.exn,
            Vrsn_2_0,
            issuer.runtime.acdc!.store,
            issuer.runtime.exc,
          );
          assertEquals(deliveries.length > 0, true);
          yield* post(grantWire, holder.url);
          assertEquals(holder.runtime.exc.complete(selected.exn.said!), true);
          assertEquals(holder.wallet.inventory().held.length, 0, "protocol acceptance is not wallet consent");
          const admissionCommand = yield* call(() =>
            runCmdWithTimeout(
              Deno.execPath(),
              [
                "run",
                "-A",
                "--no-lock",
                "packages/tufa/mod.ts",
                "ipex",
                "admit",
                "--acdc-v2",
                "--name",
                "acdc-v2-holder",
                "--head-dir",
                ctx.home,
                "--alias",
                "group",
                "--said",
                selected.exn.said!,
                "--consent",
                "--approval-timeout",
                "0",
              ],
              ctx.env,
              20_000,
              ctx.repoRoot,
            )
          );
          assertEquals(admissionCommand.code, 0, admissionCommand.stderr);
          const proposal = JSON.parse(admissionCommand.stdout.trim().split("\n").at(-1)!);
          assertEquals(proposal.status, "multisig-pending");
          assertEquals(
            holder.wallet.inventory().held.length,
            0,
            "an explicitly signed pending Admit is not wallet admission",
          );
          const admit = loadNests(holder.hby.db, proposal.messages[0].exnSaid)[0].body as SerderKERI;
          assertEquals(admit.said, proposal.said);
          assertEquals(admit.sad!.p, selected.exn.said);
          const admitWire = yield* completeExchange(
            1,
            admit,
            concatBytes(
              Counter.makeGVC(Vrsn_2_0),
              admit.raw,
              Counter.enclose({ qb64: new Uint8Array(), version: Vrsn_2_0 }),
            ),
          );
          yield* post(admitWire, issuer.url);
          yield* call(() => holder.wallet.recordAdmission(selected.exn.said!, admit.said!, { consent: true }));
          yield* call(() =>
            control("holder", "admission", { grant: selected.exn.said, admit: admit.said, consent: true })
          );
          const held = yield* call(() => holder.wallet.heldCredential(selected.exn.said!));
          const pythonHeld = yield* call(() => control("holder", "snapshot", { grant: selected.exn.said }));
          assertEquals(pythonHeld.proof, decoder.decode(held.proof));
          assertEquals(verifier.wallet.inventory().held.length, 0);
          assertEquals(
            verifier.runtime.exc.complete(selected.exn.said!),
            false,
            "independent verifier has no inherited Grant state",
          );
          const onward = yield* holder.discloser.prepareGrantBody(
            holderGroup.pre,
            { fromGrant: selected.exn.said! },
            {
              message: "exact group-held presentation",
              recipient: verifier.member.pre,
              xid: presentation.said!,
              plan: [[schema.said, "/", []]],
            },
          );
          const onwardWire = yield* completeExchange(1, onward.exn, yield* presentationProof(onward));
          yield* post(onwardWire, verifier.url);
          assertEquals(verifier.runtime.exc.complete(onward.exn.said!), true);
          assertEquals(verifier.hby.db.exns.get([onward.exn.said!])!.raw, onward.exn.raw);
          const revoked = makeBlindState({ acdc: credential.said!, state: "revoked", sn: 2n });
          yield* registry(0, acdcBlindate(rip.said!, issuance.said!, revoked.d.nonce, { sn: 2 }), revoked);
          yield* call(() =>
            assertRejects(() =>
              run(() =>
                holder.discloser.prepareGrantBody(holderGroup.pre, { fromGrant: selected.exn.said! }, {
                  message: "refuse stale use",
                  recipient: verifier.member.pre,
                })
              )
            )
          );
          for (const worker of workers) yield* worker.halt();
          workers.length = 0;
          for (const role of roles) {
            yield* role.wallet.db.reopen();
            yield* role.runtime.acdc!.baser.reopen();
            yield* role.hby.ks.reopen();
            yield* role.hby.db.reopen();
          }
          for (const label of ["issuer", "holder"]) yield* call(() => control(label, "reopen"));
          const reopened = yield* call(() => holder.wallet.heldCredential(selected.exn.said!));
          assertEquals(reopened.proof, held.proof);
          assertEquals(reopened.grant.raw, selected.exn.raw);
          assertEquals(
            (yield* call(() => control("holder", "snapshot", { grant: selected.exn.said }))).proof,
            pythonHeld.proof,
          );
          return {
            credential: credential.said!,
            registry: rip.said!,
            head: issuer.runtime.acdc!.store.head(rip.said!)!.qb64,
            group: issuerGroup.pre,
            grant: selected.exn.said!,
            recipient: verifier.member.pre,
            plan: [[schema.said, "/", []]],
          };
        } finally {
          for (const worker of workers) yield* worker.halt();
          for (const role of roles) {
            yield* call(() => role.server.shutdown());
            yield* role.wallet.db.close();
            yield* role.runtime.close();
            yield* role.hby.close();
          }
        }
      });
      // The actual CLI reopens the same group and wallet owners; an exact accepted retry cannot author another anchor.
      const retried = await runCmdWithTimeout(
        Deno.execPath(),
        [
          "run",
          "-A",
          "--no-lock",
          "packages/tufa/mod.ts",
          "vc",
          "revoke",
          "--acdc-v2",
          "--name",
          "acdc-v2-issuer",
          "--head-dir",
          ctx.home,
          "--alias",
          "group",
          "--registry-name",
          "issuer-registry",
          "--said",
          completed.credential,
          "--public",
          "--timeout",
          "10",
        ],
        ctx.env,
        20_000,
        ctx.repoRoot,
      );
      assertEquals(retried.code, 0, retried.stderr);
      const summary = JSON.parse(retried.stdout.trim().split("\n").at(-1)!);
      assertEquals(summary.update, completed.head);
      assertEquals((await control("issuer", "snapshot", { registry: completed.registry })).head, completed.head);
      const refused = await runCmdWithTimeout(
        Deno.execPath(),
        [
          "run",
          "-A",
          "--no-lock",
          "packages/tufa/mod.ts",
          "ipex",
          "grant",
          "--acdc-v2",
          "--name",
          "acdc-v2-holder",
          "--head-dir",
          ctx.home,
          "--alias",
          "group",
          "--from-grant",
          completed.grant,
          "--recipient",
          completed.recipient,
          "--xid",
          completed.registry,
          "--plan",
          JSON.stringify(completed.plan),
          "--approval-timeout",
          "0",
        ],
        ctx.env,
        20_000,
        ctx.repoRoot,
      );
      assertEquals(refused.code, 1, "a retained group-held proof cannot authorize new use after revocation");
    });
  } finally {
    await Deno.remove(ctx.home, { recursive: true });
  }
});
