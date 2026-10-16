"""Independent KERIpy HTTP peer with explicit test commands and state observations.

/_fixture controls this test process only. Signed protocol bytes always travel
through /, HttpEnd and the normal KERIpy parser/verification path.
"""
from contextlib import contextmanager
import time
import traceback
from urllib.request import Request, urlopen

import falcon
from hio.base import doing
from hio.core import http
from keri import Kinds, Vrsn_2_0
from keri.acdc import admit, agree, apply, grant, loadHandlers, offer, spurn
from keri.app import openCF, openHby
from keri.app.indirecting import HttpEnd, createHttpServer
from keri.core import Diger, Kevery, Number, Parser, messagize
from keri.peer import Exchanger
from keri.peer.exchanging import loadParsedNestedSubstreams

from ipex_disclosures import graph_disclosures


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
        loadHandlers(hby=hby, exc=self.exc, notifier=self.recorder)
        self.kvy = Kevery(db=hby.db, lax=False, local=False, cf=cf,
                          enableKram=True, exc=self.exc)
        self.parser = Parser(version=Vrsn_2_0, kvy=self.kvy, exc=self.exc, framed=False)
        self.received = []
        self.running = True
        app = falcon.App()
        app.add_route("/", HttpEnd(rxbs=self.parser.ims))
        app.add_route("/_fixture", PeerControl(self))
        self.server = createHttpServer("127.0.0.1", port, app)
        self.doist = doing.Doist(tock=.005, real=True,
                                doers=[http.ServerDoer(server=self.server)])

    def info(self):
        return dict(pre=self.hab.pre, url=f"http://127.0.0.1:{self.server.servant.ha[1]}/",
                    schema=self.graph.full.sad["s"]["$id"], commitment=self.graph.full.said)

    def stop(self):
        self.running = False

    def serve(self):
        while self.running:
            self.doist.recur()
            self.receive()
            time.sleep(.005)

    def receive(self):
        if not self.parser.ims:
            return
        arrived = bytearray(self.parser.ims)
        self.parser.parse()
        decoded = Parser(version=Vrsn_2_0).parse(ims=arrived, processive=False)
        self.received.extend(frame.serder.said for frame in decoded)

    def post(self, wire):
        req = Request(self.remote["url"], data=bytes(wire), method="POST",
                      headers={"Content-Type": "application/cesr"})
        with urlopen(req, timeout=10) as rep:
            assert rep.status == 204
            rep.read()

    def connect(self, remote, plan):
        self.remote, self.plan = remote, plan
        for issuer in self.graph.issuers:
            self.post(issuer.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_2_0))

    def signed(self, node):
        """Each child is signed by its own issuer, independently of the outer sender."""
        owner = next(issuer for issuer in self.graph.issuers if issuer.pre == node.israid)
        return messagize(node, tsgs=[(
            owner.kever.prefixer, Number(sn=owner.kever.lastEst.s),
            Diger(qb64=owner.kever.lastEst.d), owner.sign(ser=node.raw, indexed=True))],
            gvrsn=Vrsn_2_0)

    def message(self, verb, prior, invalid):
        recipient = self.remote["pre"]
        if verb == "apply":
            return apply(self.hab, recipient, "status only", modifiers=dict(dp=[self.plan]))
        if verb == "offer":
            return offer(self.hab, "status only", origin=None if self.graph_case else self.graph.nodes[0],
                         artifacts=None if self.graph_case else [], apply=prior, recp=recipient,
                         modifiers=dict(dp=[self.plan]) if prior is None else None)
        if verb == "agree":
            return agree(self.hab, "agreed", prior)
        if verb == "spurn":
            return spurn(self.hab, "declined", prior)
        if verb == "admit":
            return admit(self.hab, "accepted", prior)
        if verb == "grant":
            nodes = self.graph.bad_nodes if invalid else self.graph.nodes
            proofs = [node if invalid and node.said == self.graph.unsigned else self.signed(node)
                      for node in nodes]
            return grant(self.hab, recipient, "status only", origin=proofs[0],
                         artifacts=proofs[1:], agree=prior)
        raise ValueError(f"Unknown IPEX verb: {verb}")

    def send(self, verb, prior=None, invalid=False):
        previous = self.hby.db.exns.get(keys=(prior,)) if prior else None
        assert prior is None or previous is not None, f"Missing prior exchange: {prior}"
        body, attachments = self.message(verb, previous, invalid)
        wire = bytes(body.raw + attachments)
        Parser(version=Vrsn_2_0).parse(ims=bytearray(wire), kvy=self.kvy, exc=self.exc)
        assert (self.hby.db.exns.get(keys=(body.said,)) is not None) == (not invalid), verb
        self.post(wire)
        return body.said

    def snapshot(self, inspect=None):
        """Expose observations; scenario assertions belong to the calling test."""
        db = self.hby.db
        messages = [body for _, body in db.exns.getTopItemIter()]
        accepted_grant = next((body for body in messages if body.route == "/ipex/grant"), None)
        nests = loadParsedNestedSubstreams(self.hby, accepted_grant.said) if accepted_grant else []
        inspected = None if inspect is None else dict(
            accepted=db.exns.get(keys=(inspect,)) is not None,
            escrowed=db.epse.get(keys=(inspect,)) is not None,
            nests=len(db.enst.get(keys=(inspect,))))
        return dict(messages=[body.sad for body in messages], received=self.received,
                    known=list(self.kvy.kevers), notifications=len(self.recorder.items), inspected=inspected,
                    nodes=[dict(said=nest.serder.said, attributes=nest.serder.sad["a"],
                                raw=nest.serder.raw.decode(),
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
            elif action == "send":
                rep.media = self.peer.send(**command)
            elif action == "snapshot":
                rep.media = self.peer.snapshot(**command)
            else:
                raise ValueError(f"Unknown peer command: {action}")
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()


@contextmanager
def open_peer(port, graph_case=None, *, version=Vrsn_2_0):
    """Fresh peer stores/listener; KEL version is independent of v2 IPEX messages."""
    with openCF(name="ipex-http", temp=True) as cf:
        cf.put(dict(kram=dict(enabled=True, denials=[], caches={
            "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000]})))
        with openHby(name="python-peer", base="test", temp=True, version=version, cf=cf) as hby:
            peer = IpexPeer(hby, cf, graph_case, port, version)
            try:
                peer.doist.enter()
                if not peer.server.servant.opened:
                    raise RuntimeError("IPEX peer listener failed to open")
                yield peer
            finally:
                peer.doist.exit()
                peer.server.close()
