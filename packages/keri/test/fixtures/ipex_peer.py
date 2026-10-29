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
from keri.acdc import acdcmap, admit, agree, apply, grant, loadHandlers, offer, spurn
from keri.app import openCF, openHby
from keri.app.indirecting import HttpEnd, createHttpServer
from keri.core import Counter, Diger, Kevery, Number, Parser, SealSource, SerderACDC, exchange, messagize
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
    def __init__(self, hby, cf, graph_case, port, version):
        self.hby = hby
        self.hab = hby.makeHab(name="peer", version=version, kind=Kinds.json)
        self.graph_case = graph_case
        self.graph = graph_disclosures(hby, self.hab, graph_case)
        self.recorder = Recorder()
        self.exc = Exchanger(hby=hby, handlers=[])
        self.verification = loadHandlers(hby=hby, exc=self.exc, notifier=self.recorder)
        self.kvy = Kevery(db=hby.db, lax=False, local=False, cf=cf,
                          enableKram=True, exc=self.exc)
        self.parser = Parser(version=Vrsn_2_0, kvy=self.kvy, exc=self.exc, framed=False)
        self.received = []
        self.running = True
        self.wallet = None
        app = falcon.App()
        app.add_route("/", HttpEnd(rxbs=self.parser.ims))
        app.add_route("/_fixture", PeerControl(self))
        self.server = createHttpServer("127.0.0.1", port, app)
        self.doist = doing.Doist(tock=.005, real=True,
                                doers=[http.ServerDoer(server=self.server)])

    def info(self):
        return dict(pre=self.hab.pre, url=f"http://127.0.0.1:{self.server.servant.ha[1]}/",
                    schemas=[node.sad["s"]["$id"] for node in self.graph.full_nodes], commitment=self.graph.full_nodes[0].said)

    def stop(self):
        self.running = False

    def serve(self):
        while self.running:
            self.doist.recur()
            self.receive()
            time.sleep(.005)

    def receive(self):
        """Observe structurally decoded frames after real intake; None records nothing."""
        if not self.parser.ims:
            return
        arrived = bytearray(self.parser.ims)
        if self.wallet is not None:
            self.parser.ims.clear()
            self.native.ingest(arrived)
        else:
            self.parser.parse()
        decoded = Parser(version=Vrsn_2_0).parse(ims=arrived, processive=False)
        self.received.extend(frame.serder.said for frame in decoded or ())

    def post(self, wire):
        if self.wallet is not None:
            wire = Counter.makeGVC(version=Vrsn_2_0) + bytes(wire)
        req = Request(self.remote["url"], data=bytes(wire), method="POST",
                      headers={"Content-Type": "application/cesr"})
        with urlopen(req, timeout=10) as rep:
            assert rep.status == 204
            rep.read()

    def connect(self, remote, plan):
        self.remote, self.plan = remote, plan
        for issuer in self.graph.issuers:
            if self.wallet is not None:
                self.post(b"".join(self.hby.db.clonePreIter(pre=issuer.pre, gvrsn=Vrsn_2_0)))
                continue
            self.post(issuer.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_2_0))

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
        if self.wallet is not None and not invalid:
            return self.wallet_message(verb, prior)
        recipient = self.remote["pre"]
        if verb == "apply":
            return apply(self.hab, recipient, "status only", modifiers=dict(dp=self.plan))
        if verb == "offer":
            return offer(self.hab, "status only", origin=None if self.graph_case else self.disclosed()[0],
                         artifacts=None if self.graph_case else [], apply=prior, recp=recipient,
                         modifiers=dict(dp=self.plan) if prior is None else None)
        if verb == "agree":
            return agree(self.hab, "agreed", prior)
        if verb == "spurn":
            return spurn(self.hab, "declined", prior)
        if verb == "admit":
            return admit(self.hab, "accepted", prior)
        if verb == "grant":
            nodes = self.disclosed(invalid)
            if self.graph_case in ("fixed-path", "optional-path"):
                assert [schema for schema, _, _ in self.plan] == [node.schema["$id"] for node in nodes]
                assert [node.raw for node in nodes] == [node.raw for node in self.graph.nodes], "prefix selection preserves exact credential bytes"
            proofs = [node if invalid and node.said == self.graph.unsigned else
                      self.signed(node, self.disclosed()[0] if invalid == "altered" and i == 0 else node)
                      for i, node in enumerate(nodes)]
            return grant(self.hab, recipient, "status only", origin=proofs[0],
                         artifacts=proofs[1:], agree=prior,
                         modifiers=dict(dp=self.plan) if prior is None else None)
        raise ValueError(f"Unknown IPEX verb: {verb}")

    def send(self, verb, prior=None, invalid=False):
        previous = self.hby.db.exns.get(keys=(prior,)) if prior else None
        assert prior is None or previous is not None, f"Missing prior exchange: {prior}"
        body, attachments = self.message(verb, previous, invalid)
        if self.wallet is not None and not invalid:
            return self.wallet_deliver(body, bytes(body.raw + attachments), prior if verb == "admit" else None)
        semantic = invalid is True and self.graph_case in (
            "I2I", "E1E", "AND", "OR", "NAND", "NOR", "unknown-leaf", "unknown-group",
            "edge-schema", "inherited-schema", "malformed-schema")
        return self.deliver(body, bytes(body.raw + attachments), not invalid or semantic)

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
                    raise TimeoutError("wallet source receipts did not complete")
                clock.recur()
                time.sleep(.005)
            indices = sorted(sig.index for sig in self.hby.db.wigs.get(keys=(self.hab.pre, self.hab.kever.serder.said)))
            assert indices == [0, 1, 2], (indices, self.hab.kever.sn, self.hab.kever.wits, [wit.qb64 for wit in self.hab.kvy.fetchWitnessState(self.hab.pre, self.hab.kever.sn)])
        finally:
            clock.exit()

    def enable_wallet(self, witnesses):
        """Compose native wallet owners and real three-witness/quorum-two issuance for the positive application case."""
        from keri.acdc import Regery, Registrar
        from keri.acdc.sectioning import SectionBaser
        from keri.app.credentialing import Wallet
        from keri.cli.common.acdc_v2_ipex import Peer
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
                    raise TimeoutError("wallet witness OOBIs unresolved")
                clock.recur()
                time.sleep(.005)
        finally:
            clock.exit()
        self.hab.rotate(adds=[node["pre"] for node in witnesses], toad=2, version=Vrsn_2_0, gvrsn=Vrsn_2_0)
        self.receipt()
        from keri.acdc import RegBaser
        self.rgy = Regery(self.hby, name="wallet-peer",
                          baser=RegBaser(name="wallet-peer", headDirPath=self.hby.db.headDirPath))
        self.wallet = Wallet(self.hby, self.rgy)
        self.sections = SectionBaser(name="wallet-peer", headDirPath=self.hby.db.headDirPath)
        self.native = Peer(self.hby, self.rgy, self.sections)
        self.native.parser.ims = self.parser.ims  # Keep HttpEnd's existing borrowed intake buffer.
        self.doist.extend([self.native.evidence])
        self.exc, self.kvy, self.parser, self.verification = self.native.exc, self.native.evidence.kvy, self.native.parser, self.native.verification
        registry = Registrar(self.rgy).makeRegistry(name="wallet", prefix=self.hab.pre)
        rip = self.rgy.store.event(registry.regk)
        self.hab.interact(data=[dict(i=registry.regk, s="0", d=rip.said)], gvrsn=Vrsn_2_0)
        self.receipt()
        assert registry.anchorMsg(rip.said)
        old = self.graph.full_nodes[0]
        schema = copy.deepcopy(old.sad["s"])
        schema["$id"] = ""
        schema["properties"]["rd"] = dict(type="string")
        from keri.acdc import acdcmap
        full = acdcmap(self.hab.pre, schema=schema, regid=registry.regk, uuid=old.sad["u"], attribute=old.sad["a"])
        opening, update = registry.blind(full, "issued")
        self.hab.interact(data=[dict(i=registry.regk, s="1", d=update.said)], gvrsn=Vrsn_2_0)
        self.receipt()
        assert registry.anchorMsg(update.said)
        self.wallet.recordIssued(full, update.said, blinder=opening)
        self.wallet.retainPublicOpening(update, opening)
        self.issued_opening = opening
        self.graph.full_nodes, self.graph.nodes = [full], [partial_disclosure(full, ["a/status/"])]
        return self.info()

    def wallet_message(self, verb, prior, held=None):
        """Select through actual inventory; retained presentations never merge another view."""
        from keri.app.credential_disclosing import registryProof
        if verb == "apply":
            return apply(self.hab, self.remote["pre"], "status", modifiers=dict(dp=self.plan), ax=[True])
        if verb in ("offer", "grant"):
            if held is None:
                full = self.wallet.issuedCredential(self.graph.full_nodes[0].said)
                node = partial_disclosure(full, self.plan[0][2])
            else:
                view = self.native.verification.heldCredential(held)
                node = view["credential"]
            if verb == "offer":
                return offer(self.hab, "status", origin=node, apply=prior, recp=self.remote["pre"], ax=[True],
                             modifiers=dict(dp=self.plan) if prior is None else None)
            if held is None:
                origin = registryProof(self.hby, self.rgy, node, node.regid, retained=[self.issued_opening])
                artifacts = []
            else:
                origin, artifacts = view["proof"], view["artifacts"]
            assert self.verification.evaluateSelected(origin, artifacts) is True
            return grant(self.hab, self.remote["pre"], "status", origin=origin, artifacts=artifacts, agree=prior,
                         ax=[True], modifiers=dict(dp=self.plan) if prior is None else None)
        if verb == "agree":
            return agree(self.hab, "agree", prior)
        if verb == "admit":
            assert self.verification.evaluateGrant(prior.said) is True
            return admit(self.hab, "admit", prior)
        return spurn(self.hab, "spurn", prior)

    def wallet_deliver(self, body, wire, admission=None):
        """Finish real source receipts, ordinary intake and explicit admission before public delivery."""
        if body.route in ("/ipex/agree", "/ipex/grant", "/ipex/admit"):
            self.receipt()
        support = b"".join(self.hby.db.clonePreIter(pre=self.hab.pre, gvrsn=Vrsn_2_0))
        for reg in self.rgy.regs.values():
            support += bytes(self.rgy.store.cloneTel(reg.regk))
        self.native.ingest(support + wire)
        assert self.exc.complete(body.said)
        if body.route == "/ipex/grant":
            assert self.verification.evaluateGrant(body.said) is True
        if admission:
            self.native.verification.validateAdmission(admission, body.said, consent=True)
        self.post(support + wire)
        return body.said

    def present(self, grant):
        body, attachments = self.wallet_message("grant", None, held=grant)
        return self.wallet_deliver(body, bytes(body.raw + attachments))

    def reopen_wallet(self):
        """Reopen the same independent public and wallet environments without replacing retained views."""
        for db in (self.wallet.reger, self.rgy.baser, self.hby.ks, self.hby.db):
            db.close()
            db.reopen(reuse=True)

    def deliver(self, body, wire, accepted):
        """Local verification and public delivery consume the same signed bytes."""
        Parser(version=Vrsn_2_0).parse(ims=bytearray(wire), kvy=self.kvy, exc=self.exc)
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
                                  origin=child, ax=[True], modifiers=dict(dp=self.plan))
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
                        xid=Diger(ser=b"other conversation").qb64 if kind == "exchange-id" else previous.sad["x"],
                        prior=defect["said"] if kind == "prior" else prior,
                        route=f"/ipex/{verb}", attributes=attributes,
                        modifiers=dict(dp=[]) if verb == "grant" else {},
                        pvrsn=Vrsn_2_0, gvrsn=Vrsn_2_0, kind=Kinds.json)
        wire = self.signed(body, owner=owner, nests=[self.signed(node) for node in nodes] or None)
        return dict(said=self.deliver(body, bytes(wire), False), sender=owner.pre)

    def snapshot(self, inspect=None):
        """Expose observations; scenario assertions belong to the calling test."""
        db = self.hby.db
        messages = [body for _, body in db.exns.getTopItemIter()]
        selected = db.exns.get(keys=(inspect,)) if inspect else None
        accepted_grant = selected if selected and selected.route == "/ipex/grant" else next(
            (body for body in messages if body.route == "/ipex/grant"), None)
        nests = loadParsedNestedSubstreams(self.hby, accepted_grant.said) if accepted_grant else []
        inspected = None if inspect is None else dict(
            accepted=db.exns.get(keys=(inspect,)) is not None,
            escrowed=db.epse.get(keys=(inspect,)) is not None,
            nests=len(db.enst.get(keys=(inspect,))))
        verdict = self.verification.evaluateGrant(inspect) if selected and selected.route == "/ipex/grant" else None
        return dict(verdict=verdict, messages=[body.sad for body in messages], received=self.received,
                    known=list(self.kvy.kevers), **({} if self.wallet else dict(notifications=len(self.recorder.items))), inspected=inspected,
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
            elif action == "wallet":
                rep.media = self.peer.enable_wallet(**command)
            elif action == "present":
                rep.media = self.peer.present(**command)
            elif action == "reopen_wallet":
                self.peer.reopen_wallet()
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
def open_peer(port, graph_case=None, *, version=Vrsn_2_0, root=None):
    """Fresh peer stores/listener; KEL version is independent of v2 IPEX messages."""
    with openCF(name="ipex-http", temp=True) as cf:
        cf.put(dict(kram=dict(enabled=True, denials=[], caches={
            "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000]})))
        with openHby(name="python-peer", base="test", temp=root is None, version=version, cf=cf,
                     **(dict(headDirPath=root) if root is not None else {})) as hby:
            peer = IpexPeer(hby, cf, graph_case, port, version)
            try:
                peer.doist.enter()
                if not peer.server.servant.opened:
                    raise RuntimeError("IPEX peer listener failed to open")
                yield peer
            finally:
                peer.doist.exit()
                peer.server.close()
                if peer.wallet is not None:
                    peer.wallet.close()
                    peer.rgy.close()
                    peer.sections.close()
