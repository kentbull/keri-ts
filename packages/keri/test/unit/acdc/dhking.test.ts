/** RFC7748 fixture copied byte-for-byte from KERIpy 63a33e8869aa2309757ea9c1ab7b4447c5bf70e3,
 * tests/acdc/fixtures/dhke.json, Git blob 548bc1702a4bde93831c2ab125b24a4a71311d90.
 */
import { createProtocolHandler } from "@keri-ts/hosting";
import { selectNewcomerCopies } from "@keri-ts/multisync/v2";
import { createWalletBaser, Wallet, WalletAuthor } from "@keri-ts/wallet";
import {
  type CesrFrame,
  collectPayload,
  concatBytes,
  Counter,
  Diger,
  framePayload,
  makeBlindState,
  makeBlindUuid,
  NumberPrimitive,
  parseBytes,
  Prefixer,
  SealLast,
  type SerderACDC,
  type SerderKERI,
  unblindBlindState,
  Vrsn_2_0,
} from "cesr-ts";
import { call, ensure, run, sleep, spawn } from "effection";
import { assert, assertEquals, assertExists, assertNotEquals, assertRejects, assertThrows } from "jsr:@std/assert";
import { prepareAcdcV2Credential } from "../../../../tufa/src/cli/commands/acdc-v2-authoring.ts";
import {
  awaitGroupIssuanceProof,
  prepareGroupDerivedIssuance,
  runGroupDerivedIssuance,
} from "../../../../tufa/src/cli/commands/ipex-group-issuance.ts";
import { prepareDerivedIssuance, runDerivedIssuance } from "../../../../tufa/src/cli/commands/ipex-issuance.ts";
import {
  preparePresentationGrant,
  resumePresentationGrant,
} from "../../../../tufa/src/cli/commands/ipex-presentation.ts";
import { joinWalletIpex } from "../../../../tufa/src/cli/commands/ipex.ts";
import { loadNests } from "../../../db.ts";
import { deriveRoot, Dhke, generateKeyPair } from "../../../src/acdc/dhking.ts";
import { acdcmap, blindate, regcept } from "../../../src/acdc/messaging.ts";
import { openRegistry, type RegistryStore } from "../../../src/acdc/registering.ts";
import { Regery } from "../../../src/acdc/registraring.ts";
import { RegistryRoot } from "../../../src/acdc/salting.ts";
import type { Exchanger } from "../../../src/app/exchanges/exchanging.ts";
import { createHabery, type Hab, type Habery } from "../../../src/app/identity/habbing.ts";
import { ipexExnBody } from "../../../src/app/ipex/ipex-building.ts";
import { prepareAcdcV2GroupIpex, publishInitialGroupIpex } from "../../../src/app/ipex/ipex-grouping.ts";
import { acdcV2RegistryProposal } from "../../../src/app/multisig/grouping.ts";
import { approvePendingMultisigProposal } from "../../../src/app/multisig/multisig-workflows.ts";
import { dispatchEnvelope, envelopeFromFrame } from "../../../src/app/protocol/parsering.ts";
import type { ProtocolProcessor } from "../../../src/app/protocol/protocol-processing.ts";
import type { Reactor } from "../../../src/app/protocol/reactor.ts";
import { type AgentRuntime, createAgentRuntime, runAgentRuntime } from "../../../src/app/runtime/agent-runtime.ts";
import { systemClock } from "../../../src/app/runtime/runtime-clock.ts";
import { readCesrRequestBytes } from "../../../src/app/transport/cesr-http.ts";
import { FetchHttpClient } from "../../../src/app/transport/http-client.ts";
import { Receiptor } from "../../../src/app/witness/receipting.ts";
import { TransIdxSigGroup } from "../../../src/core/dispatch.ts";
import { ValidationError } from "../../../src/core/errors.ts";
import { interact as interactEvent, query as queryEvent, reply } from "../../../src/core/protocol-eventing.ts";
import { messageAttachmentGroups, messagize } from "../../../src/core/protocol-serialization.ts";
import { Roles } from "../../../src/core/roles.ts";
import { makeNowIso8601 } from "../../../src/time/mod.ts";
import vector from "../../fixtures/dhke.json" with { type: "json" };

const unhex = (value: string) => Uint8Array.from(value.match(/../g)!, (pair) => parseInt(pair, 16));

Deno.test("DHKE derives the Python root and UUIDs and refuses unbound or noncontributory inputs", () => {
  const context = {
    xid: vector.context.x,
    grant: vector.context.grant,
    registry: vector.context.registry,
    issuer: vector.context.issuer,
    issuee: vector.context.issuee,
    issuerPublicKey: vector.context.issuer_pk,
    issueePublicKey: vector.context.issuee_pk,
  };
  const issuerPrivate = unhex(vector.issuer_private_hex);
  for (const [role, privateKey] of [["issuer", issuerPrivate], ["issuee", unhex(vector.issuee_private_hex)]] as const) {
    const root = deriveRoot(privateKey, { ...context, role });
    assertEquals(root.qb64, vector.root_qb64);
    assertEquals(root.raw, unhex(vector.root_hex));
    for (const [sn, expected] of Object.entries(vector.uuids)) {
      assertEquals(makeBlindUuid({ raw: root.raw, sn: Number(sn), tier: "low" }).qb64, expected);
    }
  }
  for (const rejected of vector.rejected_public_keys) {
    assertThrows(
      () => deriveRoot(issuerPrivate, { ...context, role: "issuer", issueePublicKey: rejected.qb64 }),
      Error,
      undefined,
      rejected.name,
    );
  }
  assertThrows(() => deriveRoot(new Uint8Array(31), { ...context, role: "issuer" }));
  assertThrows(() => deriveRoot(unhex(vector.issuee_private_hex), { ...context, role: "issuer" }));
  assertThrows(() => deriveRoot(issuerPrivate, { ...context, role: "issuer", grant: context.grant + "AAAA" }));
  assertNotEquals(
    deriveRoot(issuerPrivate, { ...context, role: "issuer", issueePublicKey: generateKeyPair().publicKey }).qb64,
    vector.root_qb64,
  );
  for (const field of ["xid", "grant", "registry", "issuer", "issuee"] as const) {
    assertNotEquals(
      deriveRoot(issuerPrivate, {
        ...context,
        role: "issuer",
        [field]: vector.context.x === context[field] ? vector.context.grant : vector.context.x,
      }).qb64,
      vector.root_qb64,
    );
  }
});

Deno.test("v2 KERI/ACDC bilateral group DH keeps custody with approved elected members", async () => {
  await run(function* () {
    const members: { hby: Habery; member: Hab }[] = [];
    for (const name of ["issuer-0", "issuer-1", "issuee-0", "issuee-1"]) {
      const hby = yield* createHabery({
        name: crypto.randomUUID(),
        temp: true,
        skipConfig: true,
        bran: `${name}GroupDhPasscodeABC`,
      });
      yield* ensure(() => hby.close(true));
      members.push({ hby, member: hby.makeHab(name) });
    }
    assertEquals(new Set(members.map((side) => side.member.pre)).size, 4);
    for (const source of members) {
      for (const target of members) {
        if (source === target) continue;
        for (const wire of source.hby.db.clonePreIter(source.member.pre, 0)) {
          yield* dispatchEnvelope(envelopeFromFrame(parseBytes(wire)[0]), target.hby.rvy, target.hby.kevery);
        }
      }
    }
    const creations = members.map((side, index) => {
      const signing = members.slice(index < 2 ? 0 : 2, index < 2 ? 2 : 4).map((peer) => peer.member.pre);
      return side.hby.makeGroupHab("group", side.member, signing, signing, undefined, { isith: "2", nsith: "2" });
    });
    // Each group accepts the two independently owned inception contributions through ordinary KEL verification.
    for (const start of [0, 2]) {
      const frame = parseBytes(messagize(creations[start].serder, {
        sigers: [...creations[start].sigers, ...creations[start + 1].sigers],
        gvrsn: Vrsn_2_0,
      }))[0];
      for (const side of members) {
        yield* dispatchEnvelope(envelopeFromFrame(frame, true), side.hby.rvy, side.hby.kevery);
        assertExists(side.hby.db.getKever(creations[start].hab.pre));
      }
    }
    const actors: {
      hby: Habery;
      member: Hab;
      hab: Hab;
      store: RegistryStore;
      exc: Exchanger;
      dh: Dhke;
      protocol: ProtocolProcessor;
      reactor: Reactor;
      runtime: AgentRuntime;
      wallet: Wallet;
    }[] = [];
    for (const [index, side] of members.entries()) {
      const hab = creations[index].hab;
      const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => baser.close(true));
      const rgy = new Regery(side.hby, baser);
      const runtime = yield* createAgentRuntime(side.hby, new FetchHttpClient(), systemClock, {
        acdc: rgy,
        enableMailboxStore: index === 0,
        kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
        ipexAuxiliary: { kind: "dhke", hab },
      });
      yield* ensure(() => runtime.close());
      assert(runtime.ipexAuxiliary?.kind === "dhke");
      const db = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => db.close(true));
      const wallet = new Wallet({ hby: side.hby, registry: rgy.store, exc: runtime.exc, db });
      actors.push({
        ...side,
        hab,
        store: rgy.store,
        exc: runtime.exc,
        dh: runtime.ipexAuxiliary.owner,
        protocol: runtime.protocol,
        reactor: runtime.reactor,
        runtime,
        wallet,
      });
    }
    const issuers = actors.slice(0, 2), issuees = actors.slice(2), lead = issuers[0], holder = issuees[0];
    const intakeAll = function* (wire: Uint8Array, local = false) {
      for (const side of actors) yield* side.reactor.processBytes(wire, { local });
    };
    const groupInteraction = function* (peers: typeof issuers, data: unknown[] = []) {
      const state = peers[0].hab.kever!;
      const body = interactEvent(peers[0].hab.pre, state.said, state.sn + 1, data, { version: Vrsn_2_0 });
      const wire = messagize(body, { sigers: peers.flatMap((side) => side.hab.sign(body.raw, true)), gvrsn: Vrsn_2_0 });
      yield* intakeAll(wire, true);
      for (const side of actors) assertEquals(side.hby.db.getKever(body.pre!)!.said, body.said);
      return body;
    };
    const anchor = function* (event: SerderACDC) {
      const regid = event.regid ?? event.said!;
      const body = yield* groupInteraction(issuers, [{ i: regid, s: event.sad!.n, d: event.said! }]);
      yield* intakeAll(event.raw);
      return body;
    };
    const managedRegistry = lead.runtime.acdc!.makeRegistry("group-derived", lead.hab.pre);
    const rip = managedRegistry.store.event(managedRegistry.regk!)!;
    const coordinator = yield* anchor(rip);
    const recipientCoordinator = yield* groupInteraction(issuees);
    const credential = acdcmap(lead.hab.pre, {
      regid: rip.said!,
      attribute: { d: "", i: holder.hab.pre, name: "Ada" },
    });
    const groupProof = (body: SerderKERI, peers: typeof issuers) =>
      new TransIdxSigGroup(
        new Prefixer({ qb64: peers[0].hab.pre }),
        NumberPrimitive.fromNum(0n),
        new Diger({ qb64: peers[0].hab.kever!.lastEst.d }),
        peers.flatMap((side) => side.hab.sign(body.raw, true)),
      );
    const queries: Uint8Array[] = [], responses: Uint8Array[] = [];
    // Poster delivers to actual member endpoints; group endpoints fan out to both signing members.
    for (const side of actors) {
      const handler = createProtocolHandler(side.runtime, {
        hostedPrefixes: [side.member.pre, side.hab.pre],
        serviceHab: side.member,
      });
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
        const incoming = request.method === "POST" ? parseBytes(await readCesrRequestBytes(request.clone())) : [];
        const response = await handler(request);
        for (const frame of incoming) {
          const body = envelopeFromFrame(frame).serder;
          if (body.route === Dhke.Route) {
            if (body.ilk === "qry") queries.push(await collectPayload(framePayload(frame)));
            if (body.ilk === "rpy") responses.push(await collectPayload(framePayload(frame)));
          }
        }
        return response;
      });
      yield* ensure(() =>
        call(async () => {
          await server.shutdown();
          await handler.close?.();
        })
      );
      yield* intakeAll(side.member.makeLocScheme(`http://127.0.0.1:${server.addr.port}/`, side.member.pre, "http"));
      if (side === issuers[1]) {
        // This member receives through a real hosted mailbox, including multi-frame evidence.
        yield* intakeAll(side.member.makeEndRole(lead.member.pre, Roles.mailbox, true));
      } else yield* intakeAll(side.member.makeEndRole(side.member.pre, Roles.controller, true));
      const controller = reply("/end/role/add", {
        cid: side.hab.pre,
        role: Roles.controller,
        eid: side.member.pre,
      }, { pre: side.hab.pre, pvrsn: Vrsn_2_0 });
      yield* intakeAll(messagize(controller, {
        tsgs: [groupProof(controller, side === lead || side === issuers[1] ? issuers : issuees)],
        gvrsn: Vrsn_2_0,
      }));
    }
    const preparedGrant = yield* prepareGroupDerivedIssuance(lead.runtime, lead.wallet, credential, {
      recipient: holder.hab.pre,
      message: "Exact group issuance",
    }, { coordinator: coordinator.said!, custodian: lead.member.pre });
    const grant = parseBytes(preparedGrant.proposal)[0].nests![0].body as SerderKERI;
    // Spawned members wait across peer contribution, DH and explicit BUP approval; budget the whole flow.
    const issuing = yield* spawn(() =>
      runGroupDerivedIssuance(lead.runtime, lead.wallet, {
        role: "issuer",
        grant: preparedGrant.grant,
        proposal: preparedGrant.proposal,
        coordinator: coordinator.said!,
        custodian: lead.member.pre,
      }, { timeoutMs: 30000 })
    );
    yield* sleep(100);
    assertEquals(queries, [], "one Grant contribution cannot publish a DH query");
    for (const side of actors) assertEquals(side.hab.mgr.getRegistryRoot(side.hab.pre, rip.said!), null);
    // A later member key cannot reinterpret the frozen coordinator or its historical contribution.
    yield* intakeAll(issuers[1].member.rotate());
    const contributed = yield* runGroupDerivedIssuance(issuers[1].runtime, issuers[1].wallet, {
      role: "issuer",
      grant: preparedGrant.grant,
      proposal: preparedGrant.proposal,
      coordinator: coordinator.said!,
      custodian: lead.member.pre,
    }, { timeoutMs: 15000 });
    assertEquals([contributed.contributed, contributed.registryIssued, contributed.admitted], [true, false, false]);
    const peerHost = yield* spawn(() =>
      runAgentRuntime(issuers[1].runtime, { hab: issuers[1].member, pollMailbox: true })
    );
    while (
      issuees.some((side) =>
        !side.exc.pendingGrant(grant.said!, {
          xid: grant.said!,
          sender: lead.hab.pre,
          recipient: holder.hab.pre,
        })
      )
    ) yield* sleep(10);
    const deadlines = actors.map((side) => side.runtime.exc.exchangeDeadline(grant));
    assertEquals(responses, [], "receiving the full Grant does not approve recipient setup");
    const receiving = yield* spawn(() =>
      runGroupDerivedIssuance(holder.runtime, holder.wallet, {
        role: "recipient",
        grant: grant.said!,
        coordinator: recipientCoordinator.said!,
        custodian: holder.member.pre,
      }, { timeoutMs: 30000 })
    );
    yield* sleep(100);
    assertEquals(responses, [], "one recipient's setup cannot publish a threshold reply");
    for (const side of actors) assertEquals(side.hab.mgr.getRegistryRoot(side.hab.pre, rip.said!), null);
    yield* intakeAll(issuees[1].member.rotate());
    const peerReceiving = yield* spawn(() =>
      runGroupDerivedIssuance(issuees[1].runtime, issuees[1].wallet, {
        role: "recipient",
        grant: grant.said!,
        coordinator: recipientCoordinator.said!,
        custodian: holder.member.pre,
      }, { timeoutMs: 30000 })
    );

    // DH setup consent never approves the issuer's later registry update.
    const issuerPeer = issuers[1];
    let bup: SerderKERI | undefined;
    while (!bup) {
      bup = [...issuerPeer.hby.db.exns.getTopItemIter()].map(([, body]) => body)
        .find((body) => body.route === "/multisig/bup");
      if (!bup) yield* sleep(10);
    }
    const nests = loadNests(issuerPeer.hby.db, bup.said!);
    const staged = acdcV2RegistryProposal(bup, nests, issuerPeer.store)!;
    assertExists(staged);
    assertEquals(lead.store.headEvent(rip.said!)!.said, rip.said!);
    assertEquals(lead.exc.complete(grant.said!), false, "issuance waits for explicit peer BUP approval");
    const root = lead.hab.mgr.getRegistryRoot(lead.hab.pre, rip.said!)!;
    assertExists(root);
    assertEquals(holder.hab.mgr.getRegistryRoot(holder.hab.pre, rip.said!)!.qb64, root.qb64);
    for (const peer of [issuerPeer, issuees[1]]) {
      assertEquals(peer.hab.mgr.getRegistryRoot(peer.hab.pre, rip.said!), null);
    }
    const event = staged.tel, opening = envelopeFromFrame(nests[0]).bsqs[0];
    assertExists(opening);
    const approved = yield* approvePendingMultisigProposal(issuerPeer.hby, issuerPeer.runtime, {
      said: bup.said!,
      callbacks: {
        approveProposal(context) {
          assertEquals(context, { route: "/multisig/bup", group: lead.hab.pre, embedded: event.said! });
          return true;
        },
        chooseGroupAlias() {
          return "group";
        },
        chooseRegistryName() {
          return "group-derived";
        },
      },
    });
    assertExists(approved);
    const issued = yield* issuing, recipientIssued = yield* receiving, peerReceived = yield* peerReceiving;
    assertEquals([issued.registryIssued, recipientIssued.registryIssued, peerReceived.registryIssued], [
      true,
      true,
      true,
    ]);
    assertExists(issued.proof, "the custodian keeps the file fallback copy");
    // The custodian delivered the same proof by mailbox; the peer's host received it.
    assertEquals(
      yield* awaitGroupIssuanceProof(
        issuerPeer.runtime,
        issuerPeer.wallet,
        grant.said!,
        { coordinator: coordinator.said!, custodian: lead.member.pre },
        15000,
      ),
      true,
    );
    const delivered = [...issuerPeer.hby.db.exns.getTopItemIter()].map(([, body]) => body)
      .filter((body) => body.route === "/multisig/ipex-proof");
    assertEquals(delivered.map((body) => body.pre), [lead.member.pre]);
    // The file fallback carries the same exact wrapper.
    assertEquals(parseBytes(issued.proof).at(-1)!.body.said, delivered[0].said);
    yield* peerHost.halt();
    assert(queries.length > 0 && responses.length > 0, "DH messages traverse real Poster HTTP delivery");
    for (const wire of queries) assertEquals(wire, queries[0], "group fanout and retries keep the exact signed query");
    assertEquals(lead.wallet.inventory().issued[0].credential, credential.said!);
    for (const wire of [...queries, ...responses]) {
      assertEquals(new TextDecoder().decode(wire).includes(root.qb64), false);
    }
    for (const [index, side] of actors.entries()) {
      assertEquals(side.exc.complete(grant.said!), true);
      assertEquals(side.hby.db.exns.get(grant.said!)!.raw, grant.raw);
      assertEquals(side.runtime.exc.exchangeDeadline(grant), deadlines[index]);
      assertEquals(side.hby.db.erpy.get(grant.said!), null, "setup and issuance do not Admit");
      assertEquals(side.wallet.inventory().held, []);
    }
    const admit = yield* holder.wallet.prepareAdmitBody(grant.said!, holder.hab.pre, {
      consent: true,
      message: "Separate group acceptance",
      gvrsn: Vrsn_2_0,
    });
    const candidate = concatBytes(
      Counter.makeGVC(Vrsn_2_0),
      admit.raw,
      Counter.enclose({ qb64: new Uint8Array(), version: Vrsn_2_0 }),
    );
    const own = yield* prepareAcdcV2GroupIpex(holder.hby, holder.protocol, holder.hab, candidate);
    assertExists(own);
    const admitHost = yield* spawn(() => runAgentRuntime(holder.runtime, { hab: holder.member }));
    try {
      const publication = yield* publishInitialGroupIpex(
        holder.hby,
        holder.protocol,
        holder.runtime.postman,
        holder.hab,
        own,
        Vrsn_2_0,
      );
      const peer = issuees[1];
      const options = { said: publication.messages[0].exnSaid, approvalTimeoutSeconds: 5, gvrsn: Vrsn_2_0 };
      assertEquals(holder.exc.complete(admit.said!), false);
      assertEquals(holder.wallet.inventory().held, []);
      const review = yield* joinWalletIpex(peer.wallet, peer.runtime, options);
      assertEquals(review.group?.approved, null);
      assertEquals(peer.wallet.inventory().held, [], "review does not record consent");
      const joined = yield* joinWalletIpex(peer.wallet, peer.runtime, { ...options, auto: true });
      assertEquals(joined.group?.approved, true);
      assertEquals(joined.group?.accepted, true);
      assertEquals(joined.group?.credentialSaved, true);
      assertEquals(peer.wallet.inventory().held[0].admit, admit.said!);
      yield* admitHost.halt();
      const author = yield* joinWalletIpex(holder.wallet, holder.runtime, {
        ...options,
        said: joined.group!.messages[0].exnSaid,
        auto: true,
      });
      assertEquals(author.group?.accepted, true);
      assertEquals(holder.wallet.inventory().held[0].admit, admit.said!);
    } finally {
      yield* admitHost.halt();
    }
    for (const side of actors) {
      assertEquals(side.exc.complete(admit.said!), true);
      assertEquals(side.hby.db.erpy.get(grant.said!)!.qb64, admit.said!);
    }
    for (const peer of [issuers[1], issuees[1]]) {
      assertEquals(peer.hab.mgr.getRegistryRoot(peer.hab.pre, rip.said!), null);
    }

    // The same held view becomes one exact group presentation file, with ordinary sender contributions.
    const presentationHistory = actors.map((side) => side.hby.db.enst.get(grant.said!));
    const heldBeforePresentation = actors.map((side) => side.wallet.inventory().held);
    const transferredView = yield* call(() => collectPayload(framePayload(loadNests(holder.hby.db, grant.said!)[0])));
    const viewSelection = { transferred: transferredView, presenterAuthorized: true };
    const presentationOptions = { recipient: issuerPeer.member.pre, message: "Exact group presentation file" };
    const firstPresentation = yield* preparePresentationGrant(
      holder.runtime,
      holder.wallet,
      holder.hab,
      viewSelection,
      presentationOptions,
    );
    assertEquals(firstPresentation.prepared, false, "one sender member cannot export a complete group Grant");
    yield* call(() =>
      assertRejects(
        () =>
          run(() =>
            resumePresentationGrant(
              holder.runtime,
              holder.wallet,
              holder.hab,
              firstPresentation.grant,
              firstPresentation.wire,
            )
          ),
        ValidationError,
      )
    );
    const peerPresentation = yield* preparePresentationGrant(
      issuees[1].runtime,
      issuees[1].wallet,
      issuees[1].hab,
      viewSelection,
      presentationOptions,
      firstPresentation.wire,
    );
    assertEquals(peerPresentation.prepared, true);
    yield* preparePresentationGrant(
      holder.runtime,
      holder.wallet,
      holder.hab,
      viewSelection,
      presentationOptions,
      peerPresentation.wire,
    );
    assertEquals(firstPresentation.deadline, null, "a partial sender proposal grants no live lifetime");
    for (const [index, side] of actors.entries()) {
      assertEquals(side.hby.db.enst.get(grant.said!), presentationHistory[index]);
      assertEquals(side.hby.db.erpy.get(firstPresentation.grant), null, "file approvals do not Admit");
      assertEquals(side.wallet.inventory().held, heldBeforePresentation[index]);
    }

    // Replicate the custodian's existing root to its already rotated, rootless signing member by ESSR exn.
    const recipient = issuees[1];
    const holderRoot = new RegistryRoot(holder.hby, holder.runtime.acdc!, holder.runtime.notifier);
    const recipientRoot = new RegistryRoot(recipient.hby, recipient.runtime.acdc!, recipient.runtime.notifier);
    recipient.runtime.exc.addHandler(recipientRoot);
    const retainedHistory = recipient.hby.db.enst.get(grant.said!);
    assertEquals(holderRoot.members(holder.hab.pre), issuees.map((side) => side.member.pre));
    const copy = holderRoot.prepare(holder.member, recipient.member.pre, holder.hab.pre, rip.said!, {
      td: credential.said!,
    });
    const selected = envelopeFromFrame(parseBytes(copy)[0]);
    assertEquals(Object.keys(selected.serder.sad!.a as Record<string, unknown>).sort(), ["essr", "gid", "rd"]);
    assertEquals(selected.serder.pre, holder.member.pre, "the sending member's individual AID signs the copy");
    assertEquals(new TextDecoder().decode(copy).includes(root.qb64), false);
    assertEquals(
      new TextDecoder().decode(copy).includes(opening.d.qb64),
      false,
      "held opening remains local approval evidence",
    );
    assertEquals(recipient.hab.mgr.getRegistryRoot(recipient.hab.pre, rip.said!), null);
    yield* recipient.reactor.processBytes(copy);
    yield* recipient.reactor.processBytes(copy);
    // The copy verifies by its commitment hint, so arrival retains it without an approval step.
    assertEquals(recipientRoot.pending(), []);
    assertEquals(recipient.hab.mgr.getRegistryRoot(recipient.hab.pre, rip.said!)!.qb64, root.qb64);
    // A manual retry with the held opening stays idempotent.
    assertEquals(recipientRoot.receive(selected.serder.said!, { event: event.said!, opening }), true);
    const ciphertext = recipient.hab.mgr.ks.rroots.get([recipient.hab.pre, rip.said!])!.qb64;
    // A second, fresh copy is idempotent and keeps the immutable encrypted retention.
    const again = holderRoot.prepare(holder.member, recipient.member.pre, holder.hab.pre, rip.said!, {
      td: credential.said!,
    });
    yield* recipient.reactor.processBytes(again);
    assertEquals(recipientRoot.receive(parseBytes(again)[0].body.said!), true, "commitment reproduction by hint");
    assertEquals(
      recipient.hab.mgr.ks.rroots.get([recipient.hab.pre, rip.said!])!.qb64,
      ciphertext,
      "identical receipt preserves immutable encrypted retention",
    );
    assertEquals(recipientRoot.pending(), []);
    assertEquals(recipient.hby.db.enst.get(grant.said!), retainedHistory);
    assertEquals(recipient.hby.db.exns.get(admit.said!)!.raw, admit.raw);
    assertEquals(recipient.runtime.exc.exchangeDeadline(grant), deadlines[3]);

    // A next-key participant is not eligible until a real accepted rotation makes it a signer.
    const newcomer = issuers[1], previousSigningMembers = issuees.map((side) => side.member.pre);
    const expandedMembers = [...previousSigningMembers, newcomer.member.pre];
    const rotateHolder = function* (signing: string[], rotating: string[]) {
      const proposals = issuees.map((side) =>
        side.hby.rotateGroupHab("group", signing, rotating, { isith: "2", nsith: "2" })
      );
      assertEquals(proposals[0].serder.raw, proposals[1].serder.raw);
      yield* intakeAll(
        messagize(proposals[0].serder, { sigers: proposals.flatMap((part) => part.sigers), gvrsn: Vrsn_2_0 }),
        true,
      );
      for (const side of issuees) {
        assertEquals(side.hab.kever!.said, proposals[0].serder.said);
        side.hby.joinGroupHab(side.hab.pre, "group", side.member, signing, rotating);
      }
      return proposals[0].serder;
    };
    yield* intakeAll(holder.member.rotate());
    const nextOnly = yield* rotateHolder(previousSigningMembers, expandedMembers);
    assertEquals(holder.hab.kever!.verfers.length, 2);
    assertEquals(holder.hab.kever!.ndigers.length, 3);
    const nextScope = { rotation: nextOnly.said!, previousSigningMembers, registries: [rip.said!] };
    assertEquals(selectNewcomerCopies({ hby: holder.hby, group: holder.hab, ...nextScope }), []);
    assertEquals(holderRoot.newcomers(holder.hab, nextOnly.said!), []);
    assertThrows(
      () => holderRoot.prepare(holder.member, newcomer.member.pre, holder.hab.pre, rip.said!),
      ValidationError,
      "current signing member",
    );
    assertEquals(newcomer.hby.mgr.getRegistryRoot(holder.hab.pre, rip.said!), null);

    // Seal a later update while the issuer's old group keys remain available; publish its TEL after provisioning.
    const laterOpening = makeBlindState({ salt: root.qb64, sn: 2, acdc: credential.said!, state: "issued" });
    const later = blindate(rip.said!, event.said!, laterOpening.d.nonce, { sn: 2 });
    yield* groupInteraction(issuers, [{ i: rip.said!, s: "2", d: later.said! }]);
    for (const side of [...issuees, newcomer]) yield* intakeAll(side.member.rotate());
    const current = yield* rotateHolder(expandedMembers, expandedMembers);
    assertEquals(holder.hab.kever!.verfers.length, 3);
    const selectedNewcomer = {
      registry: rip.said!,
      recipient: holder.hab.pre,
      target: newcomer.member.pre,
      coordinator: current.said!,
    };
    const currentScope = { rotation: current.said!, previousSigningMembers, registries: [rip.said!] };
    assertEquals(selectNewcomerCopies({ hby: holder.hby, group: holder.hab, ...currentScope }), [selectedNewcomer]);
    assertEquals(holderRoot.newcomers(holder.hab, current.said!), [newcomer.member.pre]);
    assertEquals(holderRoot.held(holder.hab.pre), [rip.said!]);
    const newcomerHab = newcomer.hby.joinGroupHab(
      holder.hab.pre,
      "holder-newcomer",
      newcomer.member,
      expandedMembers,
      expandedMembers,
    );
    const newcomerRgy = new Regery(newcomer.hby, newcomer.store.baser);
    const newcomerRuntime = yield* createAgentRuntime(newcomer.hby, new FetchHttpClient(), systemClock, {
      acdc: newcomerRgy,
      kram: { enabled: true },
    });
    yield* ensure(() => newcomerRuntime.close());
    const newcomerRoot = new RegistryRoot(newcomer.hby, newcomerRgy, newcomerRuntime.notifier);
    newcomerRuntime.exc.addHandler(newcomerRoot);
    const catchUp = holderRoot.prepare(holder.member, newcomer.member.pre, holder.hab.pre, rip.said!, {
      td: credential.said!,
    });
    const catchUpSerder = envelopeFromFrame(parseBytes(catchUp)[0]).serder;
    assertEquals([catchUpSerder.sad!.ri, (catchUpSerder.sad!.a as Record<string, string>).gid], [
      newcomer.member.pre,
      holder.hab.pre,
    ]);
    yield* newcomerRuntime.reactor.processBytes(catchUp);
    // The newcomer holds no opening; arrival reproduces the accepted BUP commitment from the root and ACDC hint.
    assertEquals(newcomerRoot.pending(), []);
    const provisionedRoot = newcomerHab.mgr.getRegistryRoot(holder.hab.pre, rip.said!)!;
    assertEquals(provisionedRoot.qb64, root.qb64);
    // The provisioned member opens a later accepted event without another DH operation or history rewrite.
    yield* intakeAll(later.raw);
    assertEquals(newcomer.store.head(rip.said!)!.qb64, later.said!);
    const derived = unblindBlindState({
      said: laterOpening.d.nonce,
      uuid: makeBlindUuid({ salt: provisionedRoot.qb64, sn: 2 }),
      acdc: credential.said!,
      states: ["issued"],
    });
    assertExists(derived);
    assertEquals(derived.d.nonce, laterOpening.d.nonce);
    assertEquals(newcomer.hby.db.exns.get(admit.said!)!.raw, admit.raw);
    assertEquals(newcomer.runtime.exc.exchangeDeadline(grant), deadlines[1]);
  });
});

Deno.test("DHKE requires explicit consent and complete peer proofs before encrypted two-party issuance", async () => {
  await run(function* () {
    // Habitats stamp DH messages with wall time, so the receiver clock may only run ahead of it.
    let skew = 0;
    const issuerHby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "IssuerPasscodeSecretAB",
    });
    yield* ensure(() => issuerHby.close(true));
    const issueeHby = yield* createHabery({
      name: crypto.randomUUID(),
      temp: true,
      skipConfig: true,
      bran: "IssueePasscodeSecretAB",
    });
    yield* ensure(() => issueeHby.close(true));
    const issuer = issuerHby.makeHab("issuer", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const issuee = issueeHby.makeHab("issuee", undefined, { icount: 2, isith: "2", ncount: 2, nsith: "2" });
    const parties = [];
    for (const [hby, hab] of [[issuerHby, issuer], [issueeHby, issuee]] as const) {
      const baser = yield* openRegistry({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => baser.close(true));
      const rgy = new Regery(hby, baser);
      const runtime = yield* createAgentRuntime(hby, new FetchHttpClient(), {
        now: () => Date.now() + skew,
        setTimeout,
        clearTimeout: (timer) => clearTimeout(timer as number),
      }, {
        acdc: rgy,
        kram: { enabled: true, caches: { "~": [1000, 5000, 60000, 300000, 5000, 60000, 300000] } },
        ipexAuxiliary: { kind: "dhke", hab },
      });
      yield* ensure(() => runtime.close());
      assert(runtime.ipexAuxiliary?.kind === "dhke");
      const dh = runtime.ipexAuxiliary.owner;
      assertEquals(
        dh.rvy === runtime.protocol.rvy,
        true,
        "DH authenticates replies through its composed runtime owner",
      );
      assertEquals(dh.rvy === hab.rvy, false, "the ordinary runtime has its own Revery");
      assertEquals(runtime.protocol.qvy === dh, true);
      assertEquals(dh.outgoing.length, 0, "construction implies no approval or delivery");
      parties.push({
        hby,
        hab,
        store: rgy.store,
        exc: runtime.exc,
        dh,
        protocol: runtime.protocol,
        reactor: runtime.reactor,
        runtime,
      });
    }
    const [left, right] = parties;
    // Only accepted public KEL/TEL crosses between independently encrypted stores.
    for (const wire of issuerHby.db.clonePreIter(issuer.pre, 0)) yield* right.reactor.processBytes(wire);
    for (const wire of issueeHby.db.clonePreIter(issuee.pre, 0)) yield* left.reactor.processBytes(wire);
    const stamp = makeNowIso8601(new Date(Date.now() + skew));
    const rip = regcept(issuer.pre, { stamp });
    const anchor = issuer.interact({ data: [{ i: rip.said!, s: "0", d: rip.said! }] });
    yield* right.reactor.processBytes(anchor);
    for (const party of parties) yield* party.reactor.processBytes(rip.raw);
    const credential = acdcmap(issuer.pre, { regid: rip.said!, attribute: { d: "", i: issuee.pre, name: "Ada" } });
    const grant = ipexExnBody(issuer.pre, "/ipex/grant", [credential], {
      recipient: issuee.pre,
      message: "Derived registry root",
      date: stamp,
    });
    const wire = yield* call(() =>
      collectPayload(framePayload({
        body: grant,
        gvrsn: Vrsn_2_0,
        attachments: parseBytes(issuer.endorse(grant, { pipelined: false }))[0].attachments,
        nests: [{ body: credential, gvrsn: Vrsn_2_0, attachments: [] }],
      }))
    );
    for (const party of parties) {
      yield* party.reactor.processBytes(wire);
      assertEquals(party.exc.complete(grant.said!), false);
      assertExists(party.hby.db.epse.get(grant.said!));
      assertEquals(party.hab.mgr.getRegistryRoot(party.hab.pre, rip.said!), null);
      assertThrows(
        () => party.dh.complete(grant.said!),
        Error,
        undefined,
        "retained Grant intake does not approve runtime DH",
      );
    }
    const deadlines = parties.map((party) => party.runtime.exc.exchangeDeadline(grant));
    const originalBodies = parties.map((party) => loadNests(party.hby.db, grant.said!).map((nest) => nest.body.raw));
    skew += 11000;
    assertEquals(left.dh.approve(grant.said!), grant.said!);
    const started = left.dh.start(grant.said!);
    assertEquals(left.dh.start(grant.said!), started, "retry preserves the exact signed query");
    // A send-time renewal (KERIpy requery) keeps the keys and scope; only time, SAID and signatures change.
    yield* sleep(2);
    const query = left.dh.requery(grant.said!);
    const before = envelopeFromFrame(parseBytes(started)[0]).serder;
    const after = envelopeFromFrame(parseBytes(query)[0]).serder;
    assertNotEquals(after.said, before.said);
    assertEquals(after.sad!.q, before.sad!.q);
    assertEquals(left.dh.start(grant.said!), query, "the renewal becomes the outstanding query");
    assertEquals(right.dh.processQuery(envelopeFromFrame(parseBytes(query)[0])).kind, "drop");
    assertEquals(right.dh.outgoing.length, 0, "receipt without consent creates no DH reply");
    assertEquals(right.dh.approve(grant.said!), grant.said!);
    const deliverPartial = function* (party: typeof left, raw: Uint8Array, index: number) {
      const frame = parseBytes(raw)[0],
        envelope = envelopeFromFrame(frame),
        proof = envelope.tsgs[0],
        last = envelope.ssgs[0];
      assertEquals((proof ?? last).sigers.length, 2);
      const fragment: CesrFrame = {
        ...frame,
        attachments: envelope.tsgs.length
          ? messageAttachmentGroups({
            tsgs: [
              new TransIdxSigGroup(proof.prefixer, proof.seqner, proof.diger, [proof.sigers[index]]),
            ],
          }, Vrsn_2_0)
          : parseBytes(messagize(envelope.serder, {
            sigers: [last.sigers[index]],
            seal: SealLast.fromTuple([last.prefixer]),
            gvrsn: Vrsn_2_0,
          }))[0].attachments,
      };
      yield* party.reactor.processBytes(yield* call(() => collectPayload(framePayload(fragment))));
    };
    yield* deliverPartial(right, query, 0);
    assertEquals(right.dh.outgoing.length, 0, "one query signature cannot authorize a reply");
    yield* deliverPartial(right, query, 1);
    const response = right.dh.outgoing.pull()!;
    assertEquals(response.dest, issuer.pre);
    const reply = envelopeFromFrame(parseBytes(response.msg)[0]);
    const unapproved = new Dhke({ hab: issuer, exc: left.exc, registryStore: left.store });
    assertEquals(
      unapproved.processReply({
        serder: reply.serder,
        diger: new Diger({ qb64: reply.serder.said! }),
        route: Dhke.Route,
        tsgs: reply.tsgs,
      }).kind,
      "unverified",
    );
    assertEquals(
      issuer.mgr.getRegistryRoot(issuer.pre, rip.said!),
      null,
      "an unsolicited reply grants no root custody",
    );
    yield* deliverPartial(left, response.msg, 0);
    assertEquals(left.dh.complete(grant.said!), false, "one reply signature cannot complete DH");
    yield* deliverPartial(left, response.msg, 1);
    assertEquals(left.dh.complete(grant.said!), true);
    assertEquals(right.dh.complete(grant.said!), true);
    assertThrows(() => left.dh.requery(grant.said!), Error, "already completed");
    assertThrows(() => right.dh.requery(grant.said!), Error, "no started issuer query");
    const root = issuer.mgr.getRegistryRoot(issuer.pre, rip.said!)!;
    assertExists(root);
    assertEquals(issuee.mgr.getRegistryRoot(issuee.pre, rip.said!)!.qb64, root.qb64);
    assertNotEquals(issuer.mgr.ks.rroots.get([issuer.pre, rip.said!])!.qb64, root.qb64);
    assertEquals(new TextDecoder().decode(query).includes(root.qb64), false);
    assertEquals(new TextDecoder().decode(response.msg).includes(root.qb64), false);
    assertThrows(() => new Dhke({ hab: issuer, exc: left.exc, registryStore: left.store }).approve(grant.said!));

    // DH creates custody only. Exact issued evidence finishes the original Grant, then Admit is separate.
    yield* call(() => assertRejects(() => run(() => left.dh.finish(grant.said!))));
    assertEquals(left.exc.complete(grant.said!), false, "DH alone does not issue the credential");
    const opening = makeBlindState({ salt: root.qb64, acdc: credential.said!, state: "issued" });
    const bup = blindate(rip.said!, rip.said!, opening.d.nonce, { stamp });
    const issuance = issuer.interact({ data: [{ i: rip.said!, s: "1", d: bup.said! }] });
    yield* right.reactor.processBytes(issuance);
    const bupWire = yield* call(() => collectPayload(framePayload({ body: bup, gvrsn: Vrsn_2_0, attachments: [] })));
    for (const [index, party] of parties.entries()) {
      yield* party.reactor.processBytes(bupWire);
      assertEquals((yield* party.dh.finish(grant.said!)).kind, "accept");
      assertEquals(party.hby.db.exns.get(grant.said!)!.raw, grant.raw);
      assertEquals(party.runtime.exc.exchangeDeadline(grant), deadlines[index]);
      const finished = loadNests(party.hby.db, grant.said!);
      assertEquals(finished.map((nest) => nest.body.raw), originalBodies[index]);
      assertEquals(envelopeFromFrame(finished[0]).bsqs[0].d.nonce, opening.d.nonce);
      assertEquals(party.hby.db.erpy.get(grant.said!), null, "setup/issuance creates no Admit");
      assertEquals(party.store.head(rip.said!)!.qb64, bup.said!);
    }
    const admit = ipexExnBody(issuee.pre, "/ipex/admit", [], {
      prior: grant,
      message: "Accept issued credential",
      date: stamp,
    });
    const admission = issuee.endorse(admit, { pipelined: false });
    for (const party of parties) {
      yield* party.reactor.processBytes(admission);
      assertEquals(party.exc.complete(admit.said!), true);
      assertEquals(party.hby.db.erpy.get(grant.said!)!.qb64, admit.said!);
    }

    // A fresh scope uses the maintained wallet caller and ordinary wall-clock HTTP workers.
    const finite: { runtime: AgentRuntime; wallet: Wallet; hab: Hab; author: WalletAuthor }[] = [];
    for (const party of parties) {
      yield* party.runtime.close();
      const rgy = new Regery(party.hby, party.store.baser);
      const runtime = yield* createAgentRuntime(party.hby, new FetchHttpClient(), systemClock, {
        acdc: rgy,
        kram: { enabled: true },
        ipexAuxiliary: { kind: "dhke", hab: party.hab },
      });
      yield* ensure(() => runtime.close());
      const db = yield* createWalletBaser({ name: crypto.randomUUID(), temp: true });
      yield* ensure(() => db.close(true));
      const wallet = new Wallet({ hby: party.hby, registry: rgy.store, exc: runtime.exc, db });
      const receiptor = new Receiptor(party.hby, runtime.protocol, runtime.http, runtime.clock);
      finite.push({ runtime, wallet, hab: party.hab, author: new WalletAuthor(wallet, rgy, receiptor) });
    }
    const observedQueries: Uint8Array[] = [];
    for (const [index, side] of finite.entries()) {
      const handler = createProtocolHandler(side.runtime, { hostedPrefixes: [side.hab.pre], serviceHab: side.hab });
      const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (request) => {
        const incoming = request.method === "POST" ? parseBytes(await readCesrRequestBytes(request.clone())) : [];
        const response = await handler(request);
        if (index === 1) {
          for (const frame of incoming) {
            if (frame.body.ilk === "qry" && envelopeFromFrame(frame).serder.route === Dhke.Route) {
              observedQueries.push(await collectPayload(framePayload(frame)));
            }
          }
        }
        return response;
      });
      yield* ensure(() =>
        call(async () => {
          await server.shutdown();
          await handler.close?.();
        })
      );
      const endpoint = side.hab.makeLocScheme(`http://127.0.0.1:${server.addr.port}/`, side.hab.pre, "http");
      const controller = side.hab.makeEndRole(side.hab.pre, Roles.controller, true);
      for (const peer of finite) {
        yield* peer.runtime.reactor.processBytes(endpoint);
        yield* peer.runtime.reactor.processBytes(controller);
      }
    }
    const source = finite[0], recipient = finite[1];
    const unhandled = queryEvent("/unhandled-custom-query", {}, { pre: issuer.pre, pvrsn: Vrsn_2_0 });
    const acknowledgement = yield* call(() =>
      fetch(recipient.hab.fetchUrls(issuee.pre, "http").http!, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: issuer.endorse(unhandled, { gvrsn: Vrsn_2_0 }) as BodyInit,
      })
    );
    assertEquals(acknowledgement.status, 204, "missing custom owner acknowledges only transport");
    yield* call(() => acknowledgement.arrayBuffer());
    assertEquals(recipient.runtime.hby.db.msgc.get([issuer.pre, unhandled.said!]), null);
    const freshRip = yield* source.author.incept("finite-derived", issuer.pre);
    const registry = source.author.registry("finite-derived", issuer.pre);
    const bodyDirectory = yield* call(() => Deno.makeTempDir({ prefix: "derived-credential-body-" }));
    yield* ensure(() => call(() => Deno.remove(bodyDirectory, { recursive: true })));
    const credentialFile = `${bodyDirectory}/credential.cesr`;
    const fresh = yield* prepareAcdcV2Credential(source.author, registry, {
      issuee: issuee.pre,
      attribute: { d: "", name: "Grace" },
    }, credentialFile);
    assertEquals(yield* call(() => Deno.readFile(credentialFile)), fresh.raw);
    assertEquals(
      registry.store.headEvent(freshRip.said!)!.said,
      freshRip.said!,
      "body preparation leaves the fresh RIP unchanged",
    );
    for (const side of finite) {
      assertEquals(side.wallet.inventory(), { issued: [], held: [] });
      assertEquals(side.hab.mgr.getRegistryRoot(side.hab.pre, freshRip.said!), null);
    }
    const prepared = yield* prepareDerivedIssuance(source.runtime, source.wallet, fresh, {
      recipient: issuee.pre,
      message: "Finite derived issuance",
    });
    const body = source.runtime.exc.retainedInput(prepared.grant, { pending: true })!.serder;
    const sourceDeadline = source.runtime.exc.exchangeDeadline(body);
    assertEquals(source.wallet.inventory().issued, []);
    assertEquals(issuer.mgr.getRegistryRoot(issuer.pre, freshRip.said!), null);
    const issuing = yield* spawn(() =>
      runDerivedIssuance(source.runtime, source.wallet, {
        role: "issuer",
        grant: prepared.grant,
      }, { timeoutMs: 10000 })
    );
    while (!observedQueries.length) yield* sleep(10);
    const firstQuery = parseBytes(observedQueries[0])[0];
    const queryKey = [issuer.pre, firstQuery.body.said!];
    const queryCache = recipient.runtime.hby.db.msgc.get(queryKey)!;
    const recipientDeadline = recipient.runtime.exc.exchangeDeadline(body);
    assertExists(queryCache);
    assertEquals(
      recipient.runtime.ipexAuxiliary!.owner.outgoing.length,
      0,
      "real query arrival cannot approve receiver setup",
    );
    assertEquals(issuee.mgr.getRegistryRoot(issuee.pre, freshRip.said!), null);
    const replayReceipt = yield* call(() =>
      fetch(recipient.hab.fetchUrls(issuee.pre, "http").http!, {
        method: "POST",
        headers: { "Content-Type": "application/cesr" },
        body: observedQueries[0] as BodyInit,
      })
    );
    assertEquals(replayReceipt.status, 204, "cached query replay acknowledges transport without protocol work");
    yield* call(() => replayReceipt.arrayBuffer());
    const unsigned = yield* recipient.runtime.protocol.dispatch({ ...firstQuery, attachments: [] });
    assertEquals(
      unsigned.decision,
      { kind: "drop", reason: "replay" },
      "completed query replay remains rejected before route processing",
    );
    const queryProof = envelopeFromFrame(firstQuery),
      oneSignature = (queryProof.ssgs[0] ?? queryProof.tsgs[0]).sigers[0];
    const partial = yield* recipient.runtime.protocol.dispatch({
      ...firstQuery,
      attachments: messageAttachmentGroups({
        tsgs: [
          new TransIdxSigGroup(
            new Prefixer({ qb64: issuer.pre }),
            NumberPrimitive.fromNum(BigInt(issuer.kever!.lastEst.s)),
            new Diger({ qb64: issuer.kever!.lastEst.d }),
            [oneSignature],
          ),
        ],
      }, Vrsn_2_0),
    });
    assertEquals(
      partial.decision,
      { kind: "drop", reason: "replay" },
      "one current signature cannot reuse a completed query cache",
    );
    const received = yield* runDerivedIssuance(recipient.runtime, recipient.wallet, {
      role: "recipient",
      grant: prepared.grant,
    }, { timeoutMs: 10000 });
    const issued = yield* issuing;
    assertEquals([issued.registryIssued, received.registryIssued, issued.admitted, received.admitted], [
      true,
      true,
      false,
      false,
    ]);
    assert(observedQueries.length >= 1, "the actual owner retains the first query for delayed explicit setup");
    for (const repeated of observedQueries) assertEquals(repeated, observedQueries[0]);
    assertEquals(recipient.runtime.hby.db.msgc.get(queryKey), queryCache);
    assertEquals(source.runtime.exc.exchangeDeadline(body), sourceDeadline);
    assertEquals(recipient.runtime.exc.exchangeDeadline(body), recipientDeadline);
    for (const side of finite) {
      assertEquals(side.runtime.hby.db.exns.get(prepared.grant)!.raw, body.raw);
      assertEquals(loadNests(side.runtime.hby.db, prepared.grant)[0].body.raw, fresh.raw);
      assertEquals(
        side.hab.mgr.getRegistryRoot(side.hab.pre, freshRip.said!)!.qb64,
        issuer.mgr.getRegistryRoot(issuer.pre, freshRip.said!)!.qb64,
      );
    }
    assertEquals(source.wallet.inventory().issued[0].credential, fresh.said!);
    assertEquals(
      recipient.wallet.inventory().held,
      [],
      "successful setup and issuance never create recipient inventory",
    );
    const consented = yield* recipient.wallet.prepareAdmit(prepared.grant, issuee.pre, { consent: true });
    yield* recipient.runtime.reactor.processBytes(consented.wire);
    const delivery = recipient.runtime.postman.send({
      src: issuee.pre,
      dest: issuer.pre,
      topic: "credential",
      msg: consented.wire,
    }, { notify: true });
    yield* recipient.runtime.postman.process();
    assertEquals((yield* recipient.runtime.postman.wait(delivery)).kin, "sent");
    yield* call(() => recipient.wallet.recordAdmission(prepared.grant, consented.admit.said!, { consent: true }));
    assertEquals(recipient.wallet.inventory().held.map((record) => record.grant), [prepared.grant]);
  });
});
