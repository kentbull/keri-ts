"""KERIpy peer for the missing-anchor `logs` query interop test.

One v2 identifier, key store and registry store behind a real HTTP listener. The peer plays either role of the query:
the issuer whose anchoring KEL event the receiver lacks, or the receiver that holds a registry event for it.

/_fixture controls this test process only. Every protocol byte travels through / and the normal KERIpy parser; the peer
reports what its own owners observed (the queries it parsed, the messages it posted, the escrows it holds), never a row
the test supplied.
"""
import json
from pathlib import Path
import signal
import sys
import time
import traceback
from urllib.request import Request, urlopen

import falcon
from hio.base import doing
from hio.core import http
from keri import Kinds, Vrsn_2_0
from keri.acdc import RegBaser, Regery, Registrar
from keri.app import openHby
from keri.app.httping import CESR_ATTACHMENT_HEADER, CESR_CONTENT_TYPE, CESR_DESTINATION_HEADER, CESR_GENUS_HEADER
from keri.app.indirecting import HttpEnd, createHttpServer
from keri.cli.common.anchorquerying import logsQuery
from keri.cli.common.sending import messageParts
from keri.core import Codens, Counter, Kevery, Parser


class AnchorQueryPeer:
    """Own one identifier, registry store and listener; the role is chosen by the commands the test sends."""

    def __init__(self, hby, port):
        self.hby = hby
        self.hab = hby.makeHab(name="peer", version=Vrsn_2_0, kind=Kinds.json)
        self.rgy = Regery(hby, name="anchor-peer", baser=RegBaser(
            name="anchor-peer", headDirPath=hby.db.headDirPath, temp=hby.db.temp))
        self.kvy = Kevery(db=hby.db, lax=False, local=False, rvy=self.hab.rvy)
        self.parser = Parser(version=Vrsn_2_0, kvy=self.kvy, rvy=self.hab.rvy, rgy=self.rgy, framed=False)
        self.remote = None
        self.registry = None
        self.queries = []   # every `logs`/`ksn` query the Kevery parsed, as sent
        self.posted = []    # every message this peer posted, with why
        self.running = True
        original = self.kvy.processQuery

        def recording(serder, *args, **kwa):
            self.queries.append(dict(route=serder.sad["r"], q=dict(serder.sad["q"]), said=serder.said))
            return original(serder, *args, **kwa)
        self.kvy.processQuery = recording
        app = falcon.App()
        app.add_route("/", HttpEnd(rxbs=self.parser.ims))
        app.add_route("/_fixture", PeerControl(self))
        self.server = createHttpServer("127.0.0.1", port, app)
        self.doist = doing.Doist(tock=.005, real=True, doers=[http.ServerDoer(server=self.server)])

    def info(self):
        return dict(pre=self.hab.pre, url=f"http://127.0.0.1:{self.server.servant.ha[1]}/")

    def stop(self):
        self.running = False

    def serve(self):
        while self.running:
            self.doist.recur()
            if self.parser.ims:
                self.parser.parse()
            self.kvy.processEscrows()
            self.rgy.processEscrows()
            self.hab.rvy.processEscrowReply()
            self.send_cues()
            time.sleep(.005)

    def post(self, wire, why):
        """Post each exact message with its attachments, as a CESR HTTP client does."""
        for serder, attachments in messageParts(wire):
            req = Request(self.remote["url"], data=serder.raw, method="POST",
                          headers={"Content-Type": CESR_CONTENT_TYPE,
                                   CESR_ATTACHMENT_HEADER: attachments.decode("utf-8"),
                                   CESR_GENUS_HEADER: "2", CESR_DESTINATION_HEADER: self.remote["pre"]})
            with urlopen(req, timeout=10) as rep:
                assert rep.status == 204
                rep.read()
            self.posted.append(dict(why=why, said=serder.said, ilk=serder.ilk))

    def send_cues(self):
        """Transport the two cues a finite KERIpy loop owns: the registry's anchor query and the Kevery's replay."""
        while self.rgy.cues:
            cue = self.rgy.cues.popleft()
            assert cue["kin"] == "anchor" and cue["dest"] == self.remote["pre"], cue
            self.post(logsQuery(self.hab, cue), "anchor-query")
        while self.kvy.cues:
            cue = self.kvy.cues.popleft()
            if cue["kin"] == "replay":
                assert cue["dest"] == self.remote["pre"], cue
                for msg in cue["msgs"]:
                    self.post(msg, "replay")

    def connect(self, remote):
        """Introduce this identifier: its inception, location and controller role, which a sender needs to reach it."""
        self.remote = remote
        if self.hab.fetchLoc(self.hab.pre) is None:
            self.parser.parse(ims=bytearray(self.hab.makeLocScheme(url=self.info()["url"], gvrsn=Vrsn_2_0)), local=True)
        if not self.hab.fetchEndAllowed(self.hab.pre, "controller", self.hab.pre):
            self.parser.parse(ims=bytearray(self.hab.makeEndRole(eid=self.hab.pre, gvrsn=Vrsn_2_0)), local=True)
        self.post(self.hab.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_2_0), "connect")
        self.post(self.hab.loadLocScheme(self.hab.pre, gvrsn=Vrsn_2_0)
                  + self.hab.loadEndRole(self.hab.pre, self.hab.pre, gvrsn=Vrsn_2_0), "connect")

    def issue(self, extra=1):
        """Incept a registry anchored by a later interaction; deliver nothing. `extra` interactions precede the anchor."""
        for _ in range(extra):
            self.hab.interact(gvrsn=Vrsn_2_0)
        self.registry = Registrar(self.rgy).makeRegistry(name="anchored", prefix=self.hab.pre)
        rip = self.rgy.store.event(self.registry.regk)
        self.hab.interact(data=[dict(i=self.registry.regk, s="0", d=rip.said)], gvrsn=Vrsn_2_0)
        assert self.registry.anchorMsg(rip.said)
        return dict(regk=self.registry.regk, rip=rip.said, sn=self.hab.kever.sn)

    def send_rip(self):
        """Post the registry inception alone, without the KEL event that anchors it."""
        rip = self.rgy.store.event(self.registry.regk)
        self.post(rip.raw + Counter.enclose(qb64=b"", code=Codens.AttachmentGroup, version=Vrsn_2_0), "rip")
        return dict(said=rip.said)

    def snapshot(self, regk=None):
        """Observe the KEL this peer accepted, the registry events it holds and what it queried and posted."""
        db = self.rgy.baser
        held = [] if regk is None else list(db.maes.getAllIter(keys=regk))
        head = None if regk is None else self.rgy.store.headEvent(regk)
        return dict(known={pre: kever.sn for pre, kever in self.hby.db.kevers.items()},
                    queries=self.queries, posted=self.posted, held=held, head=head.said if head else None)


class PeerControl:
    """Local test commands; this endpoint is not a protocol transport."""

    def __init__(self, peer):
        self.peer = peer

    def on_post(self, req, rep):
        try:
            command = req.media
            action = command.pop("action")
            if action not in ("connect", "issue", "send_rip", "snapshot"):
                raise ValueError(f"Unknown peer command: {action}")
            answer = getattr(self.peer, action)(**command)
            # Falcon renders media None as an empty body; the caller parses every answer as JSON.
            rep.text, rep.content_type = json.dumps(answer), falcon.MEDIA_JSON
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()


def main():
    root, port = sys.argv[1:]
    with openHby(name="anchor-peer", base="test", temp=True, version=Vrsn_2_0) as hby:
        peer = AnchorQueryPeer(hby, int(port))
        try:
            peer.doist.enter()
            if not peer.server.servant.opened:
                raise RuntimeError("anchor query peer listener failed to open")
            signal.signal(signal.SIGTERM, lambda *_: peer.stop())
            # Publish complete coordinates atomically to the polling parent.
            pending = Path(root, "ready.pending")
            pending.write_text(json.dumps(peer.info()))
            pending.replace(Path(root, "ready.json"))
            peer.serve()
        finally:
            peer.doist.exit()
            peer.server.close()
            peer.rgy.close()


if __name__ == "__main__":
    main()
