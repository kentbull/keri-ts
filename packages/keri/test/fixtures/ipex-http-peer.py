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


def disclosure(issuer, *, issuee=None, edge=None):
    """Build a full commitment and its status-only partial with identical SAIDs."""
    full = acdcmap(issuer, uuid=Noncer().qb64, iseaid=issuee, edge=edge, attribute=dict(
        d="", u=Noncer().qb64,
        status=dict(d="", u=Noncer().qb64, value="citizen"),
        private=dict(d="", u=Noncer().qb64, value="hidden-value")))
    compactor = Compactor(mad=copy.deepcopy(full.sad["a"]),
                          kind=Kinds.json, verify=False)
    compactor.compact(paths=["a/status/"], root="a")
    partial = acdcmap(issuer, uuid=full.sad["u"], schema=full.sad["s"],
                      attribute=compactor.partials[("a/status/",)].mad,
                      edge=full.sad.get("e"))
    assert partial.said == full.said

    return full, partial


def main():
    """React to accepted peer messages, then assert both parties' full lineage."""
    root, role, mode, recipient, destination, schema, port, operator = sys.argv[1:]
    operator = None if operator == "-" else operator
    root = Path(root)
    plan = [[schema, "/", ["a/status/"]]]
    if operator:
        plan.append([schema, "/e/authority/link/_/" if operator in ("AND", "OR") else
                     "/e/authority/_/", ["a/status/"]])
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
            authority = hby.makeHab(name="authority") if operator and role == "issuer" else None
            nodes, bad_nodes = [partial], []
            if authority:
                _, far = disclosure(authority.pre, issuee=hab.pre if operator == "I2I" else authority.pre)

                def near(far, invalid=False):
                    """Vary relation truth while retaining independently signed node evidence."""
                    if operator in ("AND", "OR"):
                        edge = dict(d="", o=operator, authority=dict(
                            o="OR" if operator == "AND" else "AND",
                            link=dict(n=far.said, o="I2I" if invalid and operator == "OR" else "NI2I"),
                            sameIssuee=dict(n=far.said, o="I2I" if operator == "AND" else "E1E")),
                            check=dict(n=far.said, o="E1E" if operator == "AND" and not invalid else "I2I"))
                    else:
                        edge = dict(d="", authority=dict(n=far.said, o=operator))
                    return disclosure(hab.pre, issuee=authority.pre,
                                      edge=edge)

                full, partial = near(far)
                nodes = [partial, far]
                if operator == "NI2I":
                    bad_nodes = nodes
                elif operator in ("AND", "OR"):
                    bad_nodes = [near(far, invalid=True)[1], far]
                else:
                    _, bad_far = disclosure(authority.pre, issuee=authority.pre if operator == "I2I" else hab.pre)
                    bad_nodes = [near(bad_far)[1], bad_far]

            def post(wire):
                """Send unchanged signed bytes through the TS full-body endpoint."""
                req = Request(destination, data=bytes(wire), method="POST",
                              headers={"Content-Type": "application/cesr"})
                with urlopen(req, timeout=10) as rep:
                    assert rep.status == 204
                    rep.read()

            def send(pair, *, accepted=True):
                """Persist our signed message through normal verification before replying."""
                body, atc = pair
                wire = bytes(body.raw + atc)
                Parser(version=Vrsn_2_0).parse(ims=bytearray(wire), kvy=kvy, exc=exc)
                assert (hby.db.exns.get(keys=(body.said,)) is not None) == accepted, body.route
                post(wire)
                return body

            doist.enter()
            try:
                (root / "ready.json").write_text(json.dumps(dict(
                    pre=hab.pre, port=server.servant.ha[1])))
                post(hab.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_2_0))
                if authority:
                    post(authority.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_2_0))
                deadline = time.monotonic() + 30
                sent = set()
                complete = False
                incoming_grants = []
                rejected = None
                while not complete:
                    assert time.monotonic() < deadline, "IPEX peer timed out"
                    doist.recur()
                    if parser.ims:
                        # Observe decoded arrivals separately; only the normal parser mutates state.
                        arrived = bytearray(parser.ims) if operator and role == "holder" else None
                        parser.parse()
                        if arrived is not None:
                            decoded = Parser(version=Vrsn_2_0).parse(ims=arrived, processive=False)
                            incoming_grants.extend(frame.serder for frame in decoded
                                                   if frame.serder.route == "/ipex/grant")
                    if recipient not in kvy.kevers:
                        continue
                    if mode.endswith("offer") and role == "issuer" and "open" not in sent:
                        send(offer(hab, "status only", origin=None if operator else partial,
                                   artifacts=None if operator else [],
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
                                 else offer(hab, "status only", None if operator else partial,
                                            artifacts=None if operator else [], apply=body))
                            complete = mode == "spurn-apply"
                        elif body.route == "/ipex/offer" and role == "holder":
                            send(spurn(hab, "declined", body) if mode == "spurn-offer"
                                 else agree(hab, "agreed", body))
                            complete = mode == "spurn-offer"
                        elif body.route == "/ipex/agree" and role == "issuer":
                            def signed(node):
                                """Sign each child with its issuer's key, independently of the outer sender."""
                                owner = authority if authority and node.israid == authority.pre else hab
                                return messagize(node, tsgs=[(
                                    owner.kever.prefixer, Number(sn=owner.kever.lastEst.s),
                                    Diger(qb64=owner.kever.lastEst.d),
                                    owner.sign(ser=node.raw, indexed=True))], gvrsn=Vrsn_2_0)

                            if operator:
                                bad = [signed(node) if operator != "NI2I" or index == 0 else node
                                       for index, node in enumerate(bad_nodes)]
                                rejected = send(grant(hab, recipient, "invalid chain", origin=bad[0],
                                                      artifacts=bad[1:], agree=body), accepted=False).said
                            signed_nodes = [signed(node) for node in nodes]
                            send(grant(hab, recipient, "status only", origin=signed_nodes[0],
                                       artifacts=signed_nodes[1:], agree=body))
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
                if operator:
                    if role == "holder":
                        assert len(incoming_grants) == 2
                        rejected = incoming_grants[0].said
                        assert incoming_grants[1].said == messages["/ipex/grant"].said
                    assert rejected is not None
                    assert hby.db.exns.get(keys=(rejected,)) is None
                    assert hby.db.epse.get(keys=(rejected,)) is None
                    assert not hby.db.enst.get(keys=(rejected,))
                assert len(recorder.items) == len(expected)
                lineage = [messages["/ipex/" + verb] for verb in expected]
                assert lineage[0].ked["p"] == ""
                for previous, reply in zip(lineage, lineage[1:]):
                    assert reply.ked["p"] == previous.said
                    assert reply.ked["x"] == previous.ked["x"]
                    assert reply.pre == previous.ked["ri"]
                    assert reply.ked["ri"] == previous.pre
                credential = None
                retained = []
                if not mode.startswith("spurn"):
                    nests = loadParsedNestedSubstreams(hby, messages["/ipex/grant"].said)
                    assert len(nests) == (2 if operator else 1)
                    retained = [nest.serder.said for nest in nests]
                    for nest in nests:
                        assert nest.serder.sad["a"]["status"]["value"] == "citizen"
                        assert isinstance(nest.serder.sad["a"]["private"], str)
                        assert b"hidden-value" not in nest.serder.raw
                    node = nests[0].serder
                    credential = node.said
                    if role == "issuer":
                        assert node.said == full.said
                (root / "result.json").write_text(json.dumps(dict(
                    lineage=[body.said for body in lineage], credential=credential,
                    nodes=retained, rejected=rejected)))
            finally:
                doist.exit()
                server.close()


if __name__ == "__main__":
    main()
