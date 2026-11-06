"""Independent KERIpy HTTP peer with explicit test commands and state observations.

/_fixture controls this test process only. Signed protocol bytes always travel
through /, HttpEnd and the normal KERIpy parser/verification path.
"""
from contextlib import contextmanager
import copy
import time
import traceback
from urllib.request import Request, urlopen

import falcon
from hio.base import doing
from hio.core import http
from keri import Kinds, Vrsn_2_0
from keri.acdc import RegBaser, Regery, Registrar, acdcmap, admit, agree, apply, grant, loadHandlers, offer, spurn
from keri.acdc.chaining import Verdicts
from keri.acdc.dhking import Dhke
from keri.acdc.unblinding import Unblind
from keri.cli.common.sending import messageParts
from keri.core.scheming import Schemer
from keri.core.kraming import Pruner
from keri.app import openCF, openHby
from keri.app.indirecting import HttpEnd, createHttpServer
from keri.app.httping import CESR_ATTACHMENT_HEADER, CESR_CONTENT_TYPE, CESR_DESTINATION_HEADER, CESR_GENUS_HEADER
from keri.core import Codens, Counter, Diger, Kevery, Number, Parser, SealSource, SerderACDC, exchange, messagize
from keri.peer import Exchanger
from keri.peer.exchanging import loadParsedNestedSubstreams, serializeMessage, serializeParsedSubstream

from ipex_disclosures import graph_disclosures, partial_disclosure


class Recorder:
    """Observe accepted exchanges without adding a UI service."""
    def __init__(self):
        self.items = []

    def add(self, attrs):
        self.items.append(attrs)


class IpexPeer:
    """Own one key store, protocol receiver and listener, independent of scenario order."""
    def __init__(self, hby, cf, graph_case, port, version, *, derived=False):
        self.hby = hby
        self.hab = hby.makeHab(name="peer", version=version, kind=Kinds.json)
        self.graph_case = graph_case
        self.graph = graph_disclosures(hby, self.hab, graph_case)
        self.derived = derived
        if derived:
            original = self.graph.full_nodes[0]
            schema = copy.deepcopy(original.sad["s"])
            schema["$id"] = ""
            schema["properties"]["rd"] = dict(type="string")
            schema = Schemer(sed=schema).sed
            self.graph.full_nodes = [acdcmap(self.hab.pre, schema=schema,
                uuid=original.sad["u"], attribute=original.sad["a"])]
            self.graph.nodes = [partial_disclosure(self.graph.full_nodes[0], ["a/status/"])]
        self.recorder = Recorder()
        self.rgy = Regery(hby, name="ipex-peer", baser=RegBaser(
            name="ipex-peer", headDirPath=hby.db.headDirPath, temp=hby.db.temp))
        self.exc = Exchanger(hby=hby, handlers=[])
        loadHandlers(hby=hby, exc=self.exc, notifier=self.recorder, rgy=self.rgy)
        self.kvy = Kevery(db=hby.db, lax=False, local=False, cf=cf,
                          enableKram=True, exc=self.exc, rvy=self.hab.rvy)
        self.parser = Parser(version=Vrsn_2_0, kvy=self.kvy, exc=self.exc,
                             rgy=self.rgy, rvy=self.hab.rvy, framed=False)
        self.dh = self.unblind = None
        self.operation = None
        if derived:
            assert self.hab.mgr.aeid and self.hab.mgr.encrypter and self.hab.mgr.decrypter
            self.dh = Dhke(self.hab, self.exc)
            self.unblind = Unblind(self.hab, self.exc, self.rgy, states=("issued", "revoked", ""))
            hby.rtr.addRoute(Dhke.Route, self.dh)
            hby.rtr.addRoute(Unblind.Route, self.unblind, blinders=True, attachments=True)
            self.kvy.qvy = self.dh
        self.received = []
        self.running = True
        self.witnessed = False
        app = falcon.App()
        app.add_route("/", HttpEnd(rxbs=self.parser.ims))
        app.add_route("/_fixture", PeerControl(self))
        self.server = createHttpServer("127.0.0.1", port, app)
        self.doist = doing.Doist(tock=.005, real=True,
                                doers=[http.ServerDoer(server=self.server),
                                       Pruner(self.kvy.kramer, tock=.005)])

    def info(self):
        return dict(pre=self.hab.pre, url=f"http://127.0.0.1:{self.server.servant.ha[1]}/",
                    schemas=[node.sad["s"]["$id"] for node in self.graph.full_nodes], commitment=self.graph.full_nodes[0].said)

    def stop(self):
        self.running = False

    def serve(self):
        while self.running:
            self.doist.recur()
            self.receive()
            self.kvy.processEscrows()
            self.rgy.processEscrows()
            self.hab.rvy.processEscrowReply()
            self.exc.processEscrow()
            self.send_auxiliary_cues()
            self.progress()
            time.sleep(.005)

    def progress(self):
        """Advance only explicitly selected fixture work, if this profile has any."""

    def receive(self):
        """Observe structurally decoded frames after real intake; None records nothing."""
        if not self.parser.ims:
            return
        arrived = bytearray(self.parser.ims)
        self.parser.parse()
        decoded = Parser(version=Vrsn_2_0).parse(ims=arrived, processive=False)
        self.received.extend(frame.serder.said for frame in decoded or ())

    def post(self, wire, remote=None):
        """Detach each exact SAD and its complete proof subtree for normal CESR HTTP intake."""
        destination = remote or self.remote
        for serder, attachments in messageParts(wire):
            for url in destination.get("urls", [destination["url"]]):
                req = Request(url, data=serder.raw, method="POST",
                              headers={"Content-Type": CESR_CONTENT_TYPE,
                                       CESR_ATTACHMENT_HEADER: attachments.decode("utf-8"),
                                       CESR_GENUS_HEADER: "2", CESR_DESTINATION_HEADER: destination["pre"]})
                with urlopen(req, timeout=10) as rep:
                    assert rep.status == 204
                    rep.read()

    def connect(self, remote, plan):
        self.remote, self.plan = remote, plan
        for issuer in self.graph.issuers:
            if self.witnessed or self.graph_case == "DI2I":
                # DI2I graph order is root-first; real replay includes each delegator's approval.
                self.post(b"".join(self.hby.db.clonePreIter(pre=issuer.pre, gvrsn=Vrsn_2_0)))
                continue
            self.post(issuer.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_2_0))
        if self.derived:
            # Real Poster delivery requires authenticated controller/location
            # records; a fixture control URL is not protocol endpoint authority.
            if self.hab.fetchLoc(self.hab.pre) is None:
                wire = self.hab.makeLocScheme(url=self.info()["url"], gvrsn=Vrsn_2_0)
                self.parser.parse(ims=bytearray(wire), local=True)
            if not self.hab.fetchEndAllowed(self.hab.pre, "controller", self.hab.pre):
                wire = self.hab.makeEndRole(eid=self.hab.pre, gvrsn=Vrsn_2_0)
                self.parser.parse(ims=bytearray(wire), local=True)
            assert self.hab.fetchLoc(self.hab.pre) is not None
            assert self.hab.fetchEndAllowed(self.hab.pre, "controller", self.hab.pre)
            self.post(self.hab.loadLocScheme(self.hab.pre, gvrsn=Vrsn_2_0)
                      + self.hab.loadEndRole(self.hab.pre, self.hab.pre, gvrsn=Vrsn_2_0))

    def signed(self, node, proof_body=None, *, owner=None, nests=None):
        """Each child is signed by its own issuer; an explicit sender signs a test reply."""
        if owner is None:
            owner = next(issuer for issuer in self.graph.issuers if issuer.pre == node.israid)
        return messagize(node, tsgs=[(
            owner.kever.prefixer, Number(sn=owner.kever.lastEst.s),
            Diger(qb64=owner.kever.lastEst.d), owner.sign(ser=(proof_body if proof_body is not None else node).raw, indexed=True))],
            nests=nests, nested=isinstance(node, SerderACDC), gvrsn=Vrsn_2_0)

    def disclosed(self, defect=False):
        """Derive negotiated partials afresh; test defects affect only carried evidence."""
        if defect is True:
            return self.graph.bad_nodes
        nodes = []
        for full, (_, _, fields) in zip(self.graph.full_nodes, self.plan, strict=True):
            fields = list(fields)
            if defect == "extra":
                fields.append("a/private/")
            if defect == "missing":
                fields.pop()
            nodes.append(partial_disclosure(full, fields))
        if defect == "altered":
            node = nodes[0]
            attributes = copy.deepcopy(node.sad["a"])
            attributes["d"] = ""
            attributes["status"]["d"] = ""
            attributes["status"]["value"] = "forged-value"
            nodes[0] = acdcmap(node.israid, uuid=node.sad["u"], schema=node.sad["s"],
                               attribute=attributes, edge=node.sad.get("e"))
        return nodes

    def replay(self, said):
        """Send actual retained exchange evidence through the public CESR endpoint."""
        self.post(serializeMessage(self.hby, said))

    def message(self, verb, prior, invalid):
        if self.witnessed and not invalid:
            return self.witnessed_message(verb, prior)
        recipient = self.remote["pre"]
        if verb == "apply":
            return apply(self.hab, recipient, "status only", modifiers=dict(dp=[self.plan]))
        if verb == "offer":
            return offer(self.hab, "status only", origin=None if self.graph_case else self.disclosed()[0],
                         artifacts=None if self.graph_case else [], apply=prior, recp=recipient,
                         modifiers=dict(dp=[self.plan] if prior is None else [[]]))
        if verb == "agree":
            return agree(self.hab, "agreed", prior)
        if verb == "spurn":
            return spurn(self.hab, "declined", prior)
        if verb == "admit":
            return admit(self.hab, "accepted", prior)
        if verb == "grant":
            nodes = self.disclosed(invalid)
            if self.graph_case in ("required-edge", "optional-edge"):
                assert [schema for schema, _, _ in self.plan] == [node.schema["$id"] for node in nodes]
                assert [node.raw for node in nodes] == [node.raw for node in self.graph.nodes], "prefix selection preserves exact credential bytes"
            proofs = [node if invalid and node.said == self.graph.unsigned else
                      self.signed(node, self.disclosed()[0] if invalid == "altered" and i == 0 else node)
                      for i, node in enumerate(nodes)]
            return grant(self.hab, recipient, "status only", origin=proofs[0],
                         artifacts=proofs[1:], agree=prior,
                         modifiers=dict(dp=[self.plan] if prior is None else [[]]))
        raise ValueError(f"Unknown IPEX verb: {verb}")

    def send(self, verb, prior=None, invalid=False):
        previous = self.hby.db.exns.get(keys=(prior,)) if prior else None
        assert prior is None or previous is not None, f"Missing prior exchange: {prior}"
        body, attachments = self.message(verb, previous, invalid)
        if self.witnessed and not invalid:
            return self.witnessed_deliver(body, bytes(body.raw + attachments))
        return self.deliver(body, bytes(body.raw + attachments), not invalid)

    def receipt(self):
        """Use the actual receipt owner; no witness signature or quorum is manufactured."""
        from keri.app.agenting import Receiptor
        owner = Receiptor(hby=self.hby)
        clock = doing.Doist(tock=.005, real=True, doers=[owner])
        deadline = time.monotonic() + 25
        try:
            clock.enter()
            owner.msgs.append(dict(pre=self.hab.pre, sn=self.hab.kever.sn))
            while not owner.cues:
                if time.monotonic() >= deadline:
                    raise TimeoutError("witnessed source receipts did not complete")
                clock.recur()
                time.sleep(.005)
            indices = sorted(sig.index for sig in self.hby.db.wigs.get(keys=(self.hab.pre, self.hab.kever.serder.said)))
            assert indices == [0, 1, 2], (indices, self.hab.kever.sn, self.hab.kever.wits, [wit.qb64 for wit in self.hab.kvy.fetchWitnessState(self.hab.pre, self.hab.kever.sn)])
        finally:
            clock.exit()

    def enable_witnessed_evidence(self, witnesses):
        """Anchor real registry issuance under three witnesses with quorum two."""
        from keri.app.oobiing import Oobiery
        from keri.help import helping
        from keri.recording import OobiRecord
        resolver = Oobiery(hby=self.hby, version=Vrsn_2_0)
        clock = doing.Doist(tock=.005, real=True, doers=resolver.doers)
        urls = [node["controllerOobi"] for node in witnesses]
        deadline = time.monotonic() + 25
        try:
            clock.enter()
            for url in urls:
                self.hby.db.oobis.pin(keys=(url,), val=OobiRecord(date=helping.nowIso8601()))
            while not all((row := self.hby.db.roobi.get(keys=(url,))) is not None and row.state == "resolved" for url in urls):
                if time.monotonic() >= deadline:
                    raise TimeoutError("witness OOBIs unresolved")
                clock.recur()
                time.sleep(.005)
        finally:
            clock.exit()
        self.hab.rotate(adds=[node["pre"] for node in witnesses], toad=2, version=Vrsn_2_0, gvrsn=Vrsn_2_0)
        self.receipt()
        self.witnessed = True
        if self.derived:
            return self.info()  # No registry, opening or custody is created by witness configuration.
        registry = Registrar(self.rgy).makeRegistry(name="witnessed", prefix=self.hab.pre)
        rip = self.rgy.store.event(registry.regk)
        self.hab.interact(data=[dict(i=registry.regk, s="0", d=rip.said)], gvrsn=Vrsn_2_0)
        self.receipt()
        assert registry.anchorMsg(rip.said)
        old = self.graph.full_nodes[0]
        schema = copy.deepcopy(old.sad["s"])
        schema["$id"] = ""
        schema["properties"]["rd"] = dict(type="string")
        full = acdcmap(self.hab.pre, schema=schema, regid=registry.regk, uuid=old.sad["u"], attribute=old.sad["a"])
        opening, update = registry.blind(full, "issued")
        self.hab.interact(data=[dict(i=registry.regk, s="1", d=update.said)], gvrsn=Vrsn_2_0)
        self.receipt()
        assert registry.anchorMsg(update.said)
        self.rgy.store.putOpening(update.said, opening)
        self.issued_opening = opening
        self.graph.full_nodes, self.graph.nodes = [full], [partial_disclosure(full, ["a/status/"])]
        return self.info()

    def current_grant(self, said):
        """Reverify the exact retained view and require issued state for its single registry node."""
        body, nests, verdict, records = self.exc.reverifyGrant(said)
        assert verdict is not None and verdict.verdict == Verdicts.valid
        assert len(nests) == 1
        node = nests[0].serder
        observation = records.get(node.said)
        assert node.regid and observation is not None and observation.state == "issued"
        return body, nests

    def witnessed_message(self, verb, prior, held=None):
        """Use v2 proof objects; onward presentation selects only a locally admitted exact view."""
        if verb == "apply":
            return apply(self.hab, self.remote["pre"], "status", modifiers=dict(dp=[self.plan]), ax=[True])
        if verb in ("offer", "grant"):
            artifacts = []
            if held is None:
                node = partial_disclosure(self.graph.full_nodes[0], self.plan[0][2])
                origin = messagize(node, bonds=[self.issued_opening.data], gvrsn=Vrsn_2_0)
            else:
                selected, nests = self.current_grant(held)
                response = self.hby.db.erpy.get(keys=(held,))
                consent = self.hby.db.exns.get(keys=(response.qb64,)) if response else None
                assert consent is not None and consent.said == response.qb64 and consent.route == "/ipex/admit"
                assert consent.pre == self.hab.pre and consent.ked["ri"] == selected.pre
                assert consent.ked["p"] == held and selected.ked["ri"] == self.hab.pre
                assert consent.ked["x"] == (selected.said if selected.ilk == "xip" else selected.ked["x"])
                node = nests[0].serder
                origin = serializeParsedSubstream(nests[0])
                artifacts = [serializeParsedSubstream(nest) for nest in nests[1:]]
            if verb == "offer":
                return offer(self.hab, "status", origin=node, apply=prior, recp=self.remote["pre"], ax=[True],
                             modifiers=dict(dp=[self.plan] if prior is None else [[]]))
            return grant(self.hab, self.remote["pre"], "status", origin=origin, artifacts=artifacts, agree=prior,
                         ax=[True], modifiers=dict(dp=[self.plan] if prior is None else [[]]))
        if verb == "agree":
            return agree(self.hab, "agree", prior)
        if verb == "admit":
            self.current_grant(prior.said)
            return admit(self.hab, "admit", prior)
        return spurn(self.hab, "spurn", prior)

    def witnessed_deliver(self, body, wire):
        """Receipt real source anchors, then accept the same bytes locally and over HTTP."""
        if body.route in ("/ipex/agree", "/ipex/grant", "/ipex/admit"):
            self.receipt()
        support = b"".join(self.hby.db.clonePreIter(pre=self.hab.pre, gvrsn=Vrsn_2_0))
        for reg in self.rgy.regs.values():
            for raw in self.rgy.store.cloneTelIter(reg.regk):
                # Public TEL bodies carry no implicit opening; frame each for stream intake.
                support += raw + Counter.enclose(qb64=b"", code=Codens.AttachmentGroup, version=Vrsn_2_0)
        self.parser.parse(ims=bytearray(support + wire))
        assert self.exc.complete(body.said)
        if body.route == "/ipex/grant":
            self.current_grant(body.said)
        self.post(support + wire)
        return body.said

    def present(self, grant):
        if self.derived:
            return self.present_derived(grant)
        body, attachments = self.witnessed_message("grant", None, held=grant)
        return self.witnessed_deliver(body, bytes(body.raw + attachments))

    def grant_deadline(self, said):
        """Report the authenticated KRAM Grant lifetime, or pending escrow cleanup timing.

        Accepted Grants keep their lifetime in the exact KRAM transaction row; epsd
        only bounds signature-escrow cleanup and is removed once the Grant is accepted.
        """
        db = self.hby.db
        grant = db.exns.get(keys=(said,)) or db.epse.get(keys=(said,))
        deadline = self.exc.exchangeDeadline(grant) if grant is not None else None
        if deadline is not None:
            return deadline.isoformat(timespec='microseconds')
        pending = db.epsd.get((said,))
        return pending.dts if pending else None

    def auxiliary_grant(self, said):
        """Resolve the explicitly selected retained body; controls never reconstruct a missing conversation."""
        body = self.hby.db.exns.get((said,)) or self.hby.db.epse.get((said,))
        assert body is not None and body.route == "/ipex/grant"
        return body, body.said if body.ilk == "xip" else body.sad["x"]

    def public_registry(self, registry):
        """Replay accepted issuer KEL and public TEL source evidence, never private openings or roots."""
        support = b"".join(self.hby.db.clonePreIter(pre=self.hab.pre, gvrsn=Vrsn_2_0))
        for raw in self.rgy.store.cloneTelIter(registry):
            support += raw + Counter.enclose(qb64=b"", code=Codens.AttachmentGroup, version=Vrsn_2_0)
        return support

    def anchor_registry(self, registry, event):
        """Use the existing three-witness receipt path for the exact staged RIP/BUP."""
        self.hab.interact(data=[dict(i=registry.regk, s=event.sad["n"], d=event.said)], gvrsn=Vrsn_2_0)
        self.receipt()
        assert registry.anchorMsg(event.said)

    def prepare_derived(self, recipient):
        """Prepare one fresh proofless issuance Grant without creating a registry root."""
        assert self.derived and self.witnessed and recipient == self.remote["pre"]
        registry = Registrar(self.rgy).makeRegistry(name="derived", prefix=self.hab.pre)
        self.anchor_registry(registry, self.rgy.store.event(registry.regk))
        old = self.graph.full_nodes[0]
        full = acdcmap(self.hab.pre, iseaid=recipient, schema=old.sad["s"], regid=registry.regk,
                       uuid=old.sad["u"], attribute=old.sad["a"])
        partial = partial_disclosure(full, ["a/i", "a/status/"])
        assert partial.sad["a"]["i"] == recipient and "rd" not in partial.sad["a"]
        self.graph.full_nodes, self.graph.nodes = [full], [partial]
        body, atc = grant(self.hab, recipient, "derived issuance", origin=partial,
                          modifiers=dict(dp=[[[partial.schema["$id"], "/", ["a/i", "a/status/"]]]]))
        wire = bytes(body.raw + atc)
        self.parser.parse(ims=bytearray(wire))
        assert self.hby.db.epse.get((body.said,)) is not None and not self.exc.complete(body.said)
        assert self.hab.mgr.getRegistryRoot(self.hab.pre, registry.regk) is None
        self.post(self.public_registry(registry.regk) + wire)
        return dict(grant=body.said, info=self.info())

    def approve_dh(self, grant):
        """Explicit local DH consent; the issuer's separate invocation starts its frozen query."""
        assert self.derived and self.kvy.qvy is self.dh
        body, xid = self.auxiliary_grant(grant)
        assert self.dh.approve(grant) == xid
        self.operation = dict(grant=grant, xid=xid, replySent=False)
        if body.pre == self.hab.pre:
            self.post(self.dh.start(grant))
        return dict(xid=xid)

    def issue_derived(self, grant):
        """After actual DH completion, derive and anchor the issued BUP; do not send its opening."""
        body, xid = self.auxiliary_grant(grant)
        assert body.pre == self.hab.pre and self.dh.complete(xid)
        node = loadParsedNestedSubstreams(self.hby, grant)[0].serder
        registry = self.rgy.regs[node.regid]
        root = self.hab.mgr.getRegistryRoot(self.hab.pre, registry.regk)
        assert root is not None
        _, event = Registrar(self.rgy).issue(registry, acdc=node, salt=root.qb64)
        self.anchor_registry(registry, event)
        self.post(self.public_registry(registry.regk))
        return dict(event=event.said)

    def finish_dh(self, grant):
        """Verify the same Grant from the locally derived root; Admit remains a separate action."""
        _, xid = self.auxiliary_grant(grant)
        assert self.dh.finish(xid) and self.exc.complete(grant)
        self.dh.abandon(xid)
        self.operation = None
        return dict(accepted=True)

    def use_unblind(self):
        """Switch the concrete query owner only; the new phase starts without release consent."""
        assert self.derived
        self.kvy.qvy = self.unblind
        return dict(selected=True)

    def present_derived(self, held):
        """Present exactly the admitted holder view without an Issuee registry or fabricated issuer authority."""
        source = self.hby.db.exns.get((held,))
        response = self.hby.db.erpy.get((held,))
        consent = self.hby.db.exns.get((response.qb64,)) if response else None
        assert source is not None and source.sad["ri"] == self.hab.pre
        assert consent is not None and consent.route == "/ipex/admit" and consent.pre == self.hab.pre
        assert consent.sad["p"] == held and consent.sad["ri"] == source.pre
        assert consent.sad["x"] == (source.said if source.ilk == "xip" else source.sad["x"])
        nests = loadParsedNestedSubstreams(self.hby, held)
        assert len(nests) == 1 and nests[0].serder.sad["a"]["i"] == self.hab.pre
        body, atc = grant(self.hab, self.remote["pre"], "exact held presentation",
                          origin=serializeParsedSubstream(nests[0]),
                          modifiers=dict(dp=[[[nests[0].serder.schema["$id"], "/", ["a/i", "a/status/"]]]]))
        wire = bytes(body.raw + atc)
        self.parser.parse(ims=bytearray(wire))
        assert self.hby.db.exns.get((body.said,)) or self.hby.db.epse.get((body.said,))
        support = b"".join(self.hby.db.clonePreIter(pre=source.pre, gvrsn=Vrsn_2_0))
        support += b"".join(self.hby.db.clonePreIter(pre=self.hab.pre, gvrsn=Vrsn_2_0))
        for raw in self.rgy.store.cloneTelIter(nests[0].serder.regid):
            support += raw + Counter.enclose(qb64=b"", code=Codens.AttachmentGroup, version=Vrsn_2_0)
        self.post(support + wire)
        return body.said

    def publish_update(self, recipient):
        """Publish a real newer head to the verifier, withholding its opening from both peers."""
        node = self.graph.nodes[0]
        registry = self.rgy.regs[node.regid]
        root = self.hab.mgr.getRegistryRoot(self.hab.pre, registry.regk)
        assert root is not None
        _, event = Registrar(self.rgy).issue(registry, acdc=node, salt=root.qb64)
        self.anchor_registry(registry, event)
        # The holder learns the actual source KEL; Unblind must carry the newer TEL itself.
        self.post(b"".join(self.hby.db.clonePreIter(pre=self.hab.pre, gvrsn=Vrsn_2_0)))
        self.post(self.public_registry(registry.regk), remote=recipient)
        return dict(event=event.said)

    def approve_unblind(self, grant):
        """Explicitly approve release or request for this one exact retained presentation."""
        assert self.derived and self.kvy.qvy is self.unblind
        body, xid = self.auxiliary_grant(grant)
        assert self.unblind.approve(grant) == xid
        self.operation = dict(grant=grant, xid=xid, replySent=False)
        if body.sad["ri"] == self.hab.pre:
            self.post(self.unblind.start(grant))
        return dict(xid=xid)

    def finish_unblind(self, grant):
        """Retry the exact selected proof view; prior admission and deadline remain in their stores."""
        _, xid = self.auxiliary_grant(grant)
        assert self.unblind.finish(xid) and self.exc.complete(grant)
        self.unblind.abandon(xid)
        self.operation = None
        return dict(accepted=True)

    def send_auxiliary_cues(self):
        """Transport only real owner cues after explicit approval; never issue, present or Admit automatically."""
        if not self.derived:
            return
        owner = self.kvy.qvy
        while owner.cues:
            cue = owner.cues.popleft()
            assert cue["kin"] in ("query", "reply") and cue["dest"] == self.remote["pre"]
            self.post(cue["msg"])
            if cue["kin"] == "reply" and self.operation is not None:
                self.operation["replySent"] = True

    def reopen_evidence(self):
        """Reopen existing v2 evidence stores; no view is rebuilt from fuller held data."""
        for db in (self.rgy.baser, self.hby.ks, self.hby.db):
            db.close()
            db.reopen(reuse=True)

    def deliver(self, body, wire, accepted):
        """Local verification and public delivery consume the same signed bytes."""
        self.parser.parse(ims=bytearray(wire))
        assert (self.hby.db.exns.get(keys=(body.said,)) is not None) == accepted, body.route
        self.post(wire)
        return body.said

    def historical_grant(self):
        """Anchor child/grant, rotate, then deliver untouched evidence for the first time."""
        node = self.disclosed()[0]
        self.hab.interact(data=[dict(d=node.said)], gvrsn=Vrsn_2_0)
        first_sn = self.hab.kever.sn
        child = messagize(node, bonds=SealSource(s=self.hab.kever.sner.snh,
                                               d=self.hab.kever.serder.said),
                          nested=True, gvrsn=Vrsn_2_0)
        body, attachments = grant(self.hab, self.remote["pre"], "anchored before rotation",
                                  origin=child, ax=[True], modifiers=dict(dp=[self.plan]))
        self.hab.rotate(version=Vrsn_2_0, gvrsn=Vrsn_2_0)
        for sn in range(first_sn, self.hab.kever.sn + 1):
            self.post(self.hab.msgOwnEvent(sn=sn, framed=True, gvrsn=Vrsn_2_0))
        return self.deliver(body, bytes(body.raw + attachments), True)

    def invalid_reply(self, verb, prior, defect):
        """Use normal factories/signers for protocol-invalid replies the high-level builders refuse."""
        previous = self.hby.db.exns.get(keys=(prior,))
        assert previous is not None, "Missing accepted prior"
        kind = defect["kind"]
        owner = self.hby.makeHab(name="other-party") if kind == "sender" else self.hab
        if owner is not self.hab:
            self.post(owner.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_2_0))
        nodes = self.disclosed() if verb == "grant" else []
        attributes = dict(m="invalid reply")
        if nodes:
            attributes["o"] = [nodes[0].said]
        body = exchange(sender=owner.pre,
                        receiver=self.hab.pre if kind == "recipient" else previous.pre,
                        xid=Diger(ser=b"other conversation").qb64 if kind == "exchange-id" else (previous.said if previous.ilk == "xip" else previous.sad["x"]),
                        prior=defect["said"] if kind == "prior" else prior,
                        route=f"/ipex/{verb}", attributes=attributes,
                        modifiers=dict(dp=[[]]) if verb == "grant" else {},
                        pvrsn=Vrsn_2_0, gvrsn=Vrsn_2_0, kind=Kinds.json)
        wire = self.signed(body, owner=owner, nests=[self.signed(node) for node in nodes] or None)
        return dict(said=self.deliver(body, bytes(wire), False), sender=owner.pre)

    def snapshot(self, inspect=None, registry=None):
        """Expose observations; scenario assertions belong to the calling test."""
        db = self.hby.db
        messages = [body for _, body in db.exns.getTopItemIter()]
        selected = (db.exns.get(keys=(inspect,)) or (db.epse.get(keys=(inspect,)) if self.derived else None)) if inspect else None
        accepted_grant = selected if selected and selected.route == "/ipex/grant" else next(
            (body for body in messages if body.route == "/ipex/grant"), None)
        nests = loadParsedNestedSubstreams(self.hby, accepted_grant.said) if accepted_grant else []
        inspected = None if inspect is None else dict(
            accepted=db.exns.get(keys=(inspect,)) is not None,
            escrowed=db.epse.get(keys=(inspect,)) is not None,
            nests=len(db.enst.get(keys=(inspect,))))
        auxiliary = {}
        if self.derived:
            registry = registry or (nests[0].serder.regid if nests else None)
            owner = self.kvy.qvy
            operation = self.operation
            active = self.auxiliary_grant(operation["grant"])[0] if operation else None
            ready = bool(operation and (operation["replySent"]
                if owner is self.unblind and active.pre == self.hab.pre else owner.complete(operation["xid"])))
            head = self.rgy.store.headEvent(registry) if registry else None
            expiry = self.grant_deadline(inspect) if inspect else None
            admission = db.erpy.get((inspect,)) if inspect else None
            auxiliary = dict(registryHead=head.said if head else None,
                openingPresent=bool(head and self.rgy.store.opening(head.said)),
                rootPresent=bool(registry and self.hab.mgr.getRegistryRoot(self.hab.pre, registry)),
                deadline=expiry, auxiliaryReady=ready,
                encrypted=bool(self.hab.mgr.aeid and self.hab.mgr.encrypter and self.hab.mgr.decrypter),
                grantRaw=selected.raw.decode() if selected else None, admit=admission.qb64 if admission else None,
                witnesses=dict(threshold=self.hab.kever.toader.num, count=len(self.hab.kever.wits)))
        return dict(messages=[body.sad for body in messages], received=self.received, **auxiliary,
                    known=list(self.kvy.kevers), **({} if self.witnessed else dict(notifications=len(self.recorder.items))), inspected=inspected,
                    nodes=[dict(said=nest.serder.said, attributes=nest.serder.sad["a"],
                                raw=nest.serder.raw.decode(),
                                proof=serializeParsedSubstream(nest).decode(),
                                independentlyAccepted=db.exns.get(keys=(nest.serder.said,)) is not None)
                           for nest in nests])


class PeerControl:
    """Local test commands; this endpoint is not a protocol transport."""
    def __init__(self, peer):
        self.peer = peer

    def on_post(self, req, rep):
        try:
            self.peer.receive()
            command = req.media
            action = command.pop("action")
            if action == "connect":
                self.peer.connect(**command)
                rep.media = dict(connected=True)
            elif action == "witnessed_evidence":
                rep.media = self.peer.enable_witnessed_evidence(**command)
            elif action in ("prepare_derived", "approve_dh", "issue_derived", "finish_dh", "use_unblind",
                             "publish_update", "approve_unblind", "finish_unblind", "create_group",
                             "prepare_group_registry", "pending_group_event", "approve_group_event",
                             "group_endpoints", "approve_group_endpoints",
                             "prepare_group_derived", "approve_group_derived", "final_group_proof", "accept_group_proof"):
                rep.media = getattr(self.peer, action)(**command)
            elif action == "present":
                rep.media = self.peer.present(**command)
            elif action == "reopen_evidence":
                self.peer.reopen_evidence()
                rep.media = dict(reopened=True)
            elif action == "invalid_reply":
                rep.media = self.peer.invalid_reply(**command)
            elif action == "send":
                rep.media = self.peer.send(**command)
            elif action == "historical_grant":
                rep.media = self.peer.historical_grant()
            elif action == "replay":
                self.peer.replay(**command)
                rep.media = dict(replayed=True)
            elif action == "snapshot":
                rep.media = self.peer.snapshot(**command)
            else:
                raise ValueError(f"Unknown peer command: {action}")
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()


@contextmanager
def open_peer(port, graph_case=None, *, version=Vrsn_2_0, root=None, derived=False, group=False):
    """Fresh peer stores/listener; KEL version is independent of v2 IPEX messages."""
    with openCF(name="ipex-http", temp=True) as cf:
        cf.put(dict(kram=dict(enabled=True, denials=[], caches={
            "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000]})))
        with openHby(name="python-peer", base="test", temp=root is None, version=version, cf=cf,
                     **(dict(headDirPath=root) if root is not None else {}),
                     **(dict(bran="DerivedFixturePasscode") if derived else {})) as hby:
            if group:
                from ipex_group_peer import GroupIpexPeer
            peer = (GroupIpexPeer if group else IpexPeer)(hby, cf, graph_case, port, version, derived=derived)
            try:
                peer.doist.enter()
                if not peer.server.servant.opened:
                    raise RuntimeError("IPEX peer listener failed to open")
                yield peer
            finally:
                peer.doist.exit()
                peer.server.close()
                peer.rgy.close()
                if group:
                    peer.notifier.noter.close()
