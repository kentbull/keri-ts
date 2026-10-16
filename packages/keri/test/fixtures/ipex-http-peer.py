"""Independent KERIpy HTTP peer for focused full-conversation IPEX tests.

Startup/result files carry public test coordinates and observations only. KELs,
signed exchanges and credential evidence arrive through actual HTTP ingress.
"""
import copy
import json
from pathlib import Path
import sys
import time
from urllib.request import Request, urlopen

import falcon
from hio.base import doing
from hio.core import http
from keri import Kinds, Vrsn_2_0
from keri.acdc import acdcmap, admit, agree, apply, grant, loadHandlers, offer, spurn
from keri.app import openCF, openHby
from keri.app.indirecting import HttpEnd, createHttpServer
from keri.core import Compactor, Diger, Kevery, Noncer, Number, Parser, messagize
from keri.peer import Exchanger
from keri.peer.exchanging import loadParsedNestedSubstreams


class Recorder:
    """Observe notifications after durable acceptance without a UI service."""
    def __init__(self):
        self.items = []

    def add(self, attrs):
        self.items.append(attrs)


def disclosure(issuer):
    """Build a full commitment and its status-only partial with identical SAIDs."""
    full = acdcmap(issuer, uuid=Noncer().qb64, attribute=dict(
        d="", u=Noncer().qb64,
        status=dict(d="", u=Noncer().qb64, value="citizen"),
        private=dict(d="", u=Noncer().qb64, value="hidden-value")))
    compactor = Compactor(mad=copy.deepcopy(full.sad["a"]),
                          kind=Kinds.json, verify=False)
    compactor.compact(paths=["a/status/"], root="a")
    partial = acdcmap(issuer, uuid=full.sad["u"], schema=full.sad["s"],
                      attribute=compactor.partials[("a/status/",)].mad)
    assert partial.said == full.said

    return full, partial


def main():
    """React to accepted peer messages, then assert both parties' full lineage."""
    root, role, mode, recipient, destination, schema, port = sys.argv[1:]
    root = Path(root)
    plan = [[schema, "/", ["a/status/"]]]
    with openCF(name="ipex-http", temp=True) as cf:
        cf.put(dict(kram=dict(enabled=True, denials=[], caches={
            "~": [1000, 60000, 120000, 300000, 60000, 120000, 300000]})))
        with openHby(name="python-peer", base="test", temp=True,
                     version=Vrsn_2_0, cf=cf) as hby:
            hab = hby.makeHab(name="peer", version=Vrsn_2_0, kind=Kinds.json)
            exc = Exchanger(hby=hby, handlers=[])
            recorder = Recorder()
            loadHandlers(hby=hby, exc=exc, notifier=recorder)
            kvy = Kevery(db=hby.db, lax=False, local=False, cf=cf,
                         enableKram=True, exc=exc)
            parser = Parser(version=Vrsn_2_0, kvy=kvy, exc=exc, framed=False)
            app = falcon.App()
            app.add_route("/", HttpEnd(rxbs=parser.ims))
            server = createHttpServer("127.0.0.1", int(port), app)
            doist = doing.Doist(tock=.005, real=True,
                               doers=[http.ServerDoer(server=server)])
            full, partial = disclosure(hab.pre)

            def post(wire):
                """Send unchanged signed bytes through the TS full-body endpoint."""
                req = Request(destination, data=bytes(wire), method="POST",
                              headers={"Content-Type": "application/cesr"})
                with urlopen(req, timeout=10) as rep:
                    assert rep.status == 204
                    rep.read()

            def send(pair):
                """Persist our signed message through normal verification before replying."""
                body, atc = pair
                wire = bytes(body.raw + atc)
                Parser(version=Vrsn_2_0).parse(ims=bytearray(wire), kvy=kvy, exc=exc)
                assert hby.db.exns.get(keys=(body.said,)) is not None, body.route
                post(wire)
                return body

            doist.enter()
            try:
                (root / "ready.json").write_text(json.dumps(dict(
                    pre=hab.pre, port=server.servant.ha[1])))
                post(hab.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_2_0))
                deadline = time.monotonic() + 30
                sent = set()
                complete = False
                while not complete:
                    assert time.monotonic() < deadline, "IPEX peer timed out"
                    doist.recur()
                    if parser.ims:
                        parser.parse()
                    if recipient not in kvy.kevers:
                        continue
                    if mode.endswith("offer") and role == "issuer" and "open" not in sent:
                        send(offer(hab, "status only", origin=partial, artifacts=[],
                                   recp=recipient, modifiers=dict(dp=[plan])))
                        sent.add("open")
                    if mode.endswith("apply") and role == "holder" and "open" not in sent:
                        send(apply(hab, recipient, "status only", modifiers=dict(dp=[plan])))
                        sent.add("open")
                    incoming = [body for _, body in hby.db.exns.getTopItemIter()
                                if body.pre == recipient]
                    for body in incoming:
                        if body.said in sent:
                            continue
                        sent.add(body.said)
                        if body.route == "/ipex/apply" and role == "issuer":
                            send(spurn(hab, "declined", body) if mode == "spurn-apply"
                                 else offer(hab, "status only", partial, artifacts=[], apply=body))
                            complete = mode == "spurn-apply"
                        elif body.route == "/ipex/offer" and role == "holder":
                            send(spurn(hab, "declined", body) if mode == "spurn-offer"
                                 else agree(hab, "agreed", body))
                            complete = mode == "spurn-offer"
                        elif body.route == "/ipex/agree" and role == "issuer":
                            signed = messagize(partial, tsgs=[(
                                hab.kever.prefixer, Number(sn=hab.kever.lastEst.s),
                                Diger(qb64=hab.kever.lastEst.d),
                                hab.sign(ser=partial.raw, indexed=True))], gvrsn=Vrsn_2_0)
                            send(grant(hab, recipient, "status only", origin=signed, agree=body))
                        elif body.route == "/ipex/grant" and role == "holder":
                            send(admit(hab, "accepted", body))
                            complete = True
                        elif body.route in ("/ipex/admit", "/ipex/spurn"):
                            complete = True
                    time.sleep(.005)
                messages = {body.route: body for _, body in hby.db.exns.getTopItemIter()}
                expected = (["apply", "spurn"] if mode == "spurn-apply" else
                            ["offer", "spurn"] if mode == "spurn-offer" else
                            (["apply"] if mode == "apply" else []) +
                            ["offer", "agree", "grant", "admit"])
                assert set(messages) == {"/ipex/" + verb for verb in expected}
                assert len(recorder.items) == len(expected)
                lineage = [messages["/ipex/" + verb] for verb in expected]
                assert lineage[0].ked["p"] == ""
                for previous, reply in zip(lineage, lineage[1:]):
                    assert reply.ked["p"] == previous.said
                    assert reply.ked["x"] == previous.ked["x"]
                    assert reply.pre == previous.ked["ri"]
                    assert reply.ked["ri"] == previous.pre
                credential = None
                if not mode.startswith("spurn"):
                    nests = loadParsedNestedSubstreams(hby, messages["/ipex/grant"].said)
                    assert len(nests) == 1
                    node = nests[0].serder
                    credential = node.said
                    assert node.sad["a"]["status"]["value"] == "citizen"
                    assert isinstance(node.sad["a"]["private"], str)
                    assert b"hidden-value" not in node.raw
                    if role == "issuer":
                        assert node.said == full.said
                (root / "result.json").write_text(json.dumps(dict(
                    lineage=[body.said for body in lineage], credential=credential)))
            finally:
                doist.exit()
                server.close()


if __name__ == "__main__":
    main()
