"""Compose the existing IPEX peer with real KERIpy mailbox forwarding and polling.

The underlying peer still owns credential construction and verification. This
fixture adds its reply processor and connects Poller.msgs to normal parser intake.
No accepted rows are seeded and no reference source or HTTP peer is patched.
"""
import base64
import json
from pathlib import Path
import signal
import sys
import time
import traceback
from urllib.request import Request, urlopen

import falcon
from hio.base import doing
from keri import Kinds, Roles, Vrsn_1_0, Vrsn_2_0
from keri.app.agenting import Receiptor
from keri.app.forwarding import StreamPoster
from keri.app.indirecting import Poller
from keri.app.oobiing import Oobiery
from keri.core import Parser
from keri.help import helping
from keri.recording import OobiRecord

from ipex_peer import open_peer


def put(url, wire):
    """Send public bootstrap evidence through the normal bulk CESR endpoint."""
    req = Request(url, data=bytes(wire), method="PUT",
                  headers={"Content-Type": "application/cesr"})
    with urlopen(req, timeout=10) as rep:
        assert 200 <= rep.status < 300
        rep.read()


def witness(peer, config):
    """Learn real endpoint proofs and receipt a rotation adding three witnesses."""
    hby, hab = peer.hby, peer.hab
    provider = config["provider"]
    receiptor = Receiptor(hby=hby)
    doist = doing.Doist(tock=.005, real=True, doers=[receiptor])
    deadline = time.monotonic() + 20
    def recur():
        if time.monotonic() >= deadline:
            raise TimeoutError("Python controller introductions/receipts did not complete")
        doist.recur()
        time.sleep(.005)
    try:
        doist.enter()
        # Witness OOBIs use v1; the mailbox provider uses v2 attachment groups.
        for version, urls in [
                (Vrsn_1_0, [item["url"] for item in config["witnesses"]]),
                (Vrsn_2_0, [f'{provider["url"]}oobi/{provider["pre"]}/controller'])]:
            resolver = Oobiery(hby=hby, version=version)
            doist.extend(resolver.doers)
            for url in urls:
                hby.db.oobis.pin(keys=(url,), val=OobiRecord(date=helping.nowIso8601()))
            while not all((row := hby.db.roobi.get(keys=(url,))) is not None
                          and row.state == "resolved" for url in urls):
                recur()
            doist.remove(resolver.doers)
        hab.rotate(adds=[item["pre"] for item in config["witnesses"]], toad=2, version=Vrsn_1_0)
        receiptor.msgs.append(dict(pre=hab.pre, sn=hab.kever.sn))
        while not receiptor.cues:
            recur()
        receipts = sorted(sig.index for sig in hby.db.wigs.get(keys=(hab.pre, hab.kever.serder.said)))
        assert receipts == [0, 1, 2], receipts
    finally:
        doist.exit()


class MailboxControl:
    """Choose a conversation action; actual StreamPoster doers own delivery."""
    def __init__(self, peer):
        self.peer = peer

    def on_post(self, req, rep):
        try:
            command = req.media
            if command.get("action") == "connect":
                # Public KEL replay is already complete; retain only conversation coordinates.
                self.peer.remote, self.peer.plan = command["remote"], command["plan"]
                rep.media = dict(connected=True)
                return
            verb, prior = command["verb"], command.get("prior")
            previous = self.peer.hby.db.exns.get(keys=(prior,)) if prior else None
            assert prior is None or previous is not None, "Missing accepted IPEX prior"
            invalid = command.get("invalid", False)
            body, attachments = self.peer.message(verb, previous, invalid)
            Parser(version=Vrsn_2_0).parse(ims=bytearray(body.raw + attachments),
                                        kvy=self.peer.kvy, exc=self.peer.exc)
            assert (self.peer.hby.db.exns.get(keys=(body.said,)) is not None) == (not invalid)
            poster = StreamPoster(hby=self.peer.hby, hab=self.peer.hab,
                                  recp=self.peer.remote["pre"], topic="credential",
                                  version=Vrsn_2_0, kind=Kinds.json)
            poster.send(body, attachment=attachments, gvrsn=Vrsn_2_0)
            doers = poster.deliver()
            assert doers, "Mailbox forwarding must select a real endpoint"
            self.peer.doist.extend(doers)
            rep.media = body.said
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()


class Health:
    """Report readiness after the composed bootstrap has completed."""
    def on_get(self, req, rep):
        rep.media = dict(ready=True)


def main():
    root, config_path, graph, port = sys.argv[1:]
    config = json.loads(Path(config_path).read_text())
    with open_peer(int(port), graph, version=Vrsn_1_0) as peer:
        # The base HTTP fixture only needs IPEX; this composition also verifies endpoint replies.
        peer.hby.rvy.cues = peer.kvy.cues
        peer.parser.rvy = peer.hby.rvy
        witness(peer, config)
        provider = config["provider"]
        authorization = peer.hab.makeEndRole(eid=provider["pre"], role=Roles.mailbox,
                                             pvrsn=Vrsn_2_0, gvrsn=Vrsn_2_0, genusify=True)
        peer.parser.parse(ims=bytearray(authorization))
        assert peer.hby.db.ends.get(keys=(peer.hab.pre, Roles.mailbox, provider["pre"])).allowed
        put(provider["url"], peer.hab.replay(gvrsn=Vrsn_2_0))
        put(provider["url"], authorization)
        peer.server.app.add_route("/_mailbox", MailboxControl(peer))
        peer.server.app.add_route("/health", Health())
        poller = Poller(hab=peer.hab, witness=provider["pre"], topics=["/credential"],
                        version=Vrsn_2_0, gvrsn=Vrsn_2_0, kind=Kinds.json)
        peer.doist.extend([poller])
        signal.signal(signal.SIGTERM, lambda *_: peer.stop())
        info = dict(peer.info(), authorization=base64.b64encode(authorization).decode(), event=peer.hab.kever.serder.said, witnesses=peer.hab.kever.wits,
                    kels=[base64.b64encode(issuer.replay(gvrsn=issuer.kever.serder.pvrsn)).decode()
                          for issuer in peer.graph.issuers])
        pending = Path(root, "ready.pending")
        pending.write_text(json.dumps(info))
        pending.replace(Path(root, "ready.json"))
        while peer.running:
            peer.doist.recur()
            while poller.msgs:
                peer.parser.ims.extend(poller.msgs.popleft())
            peer.receive()
            time.sleep(.005)


if __name__ == "__main__":
    main()
