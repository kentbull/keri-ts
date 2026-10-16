"""Real fork mailbox host and independent controller packets for KRAM interop.

Fixture commands observe stores or send captured controller packets over HTTP.
Protocol ingress always uses setupMailbox/HttpEnd and the normal parser/doers.
"""
import base64
from contextlib import ExitStack
from datetime import timedelta
import json
import os
import signal
import sys
import time
import traceback
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import falcon
from hio.base import doing
from hio.core import http
from keri import Kinds, Vrsn_1_0, Vrsn_2_0
from keri.app import openCF, openHby
from keri.app.agenting import Receiptor
from keri.app.mailboxing import MailboxStart, setupMailbox
from keri.app.oobiing import Oobiery
from keri.recording import OobiRecord
from keri.app.storing import Mailboxer
from keri.cli.commands.mailbox.start import _prepareMailboxHabitat
from keri.core import Diger, Kevery, Number, Parser, Salter, messagize, query
from keri.help import helping

WINDOWS = [1000, 60000, 120000, 300000, 60000, 120000, 300000]
PAYLOAD = "authenticated-mailbox-payload"


def controller_packets(stack, count, witnesses):
    """Independent member stores sign one controller or a real two-of-two group."""
    hbys = [stack.enter_context(openHby(name=f"member-{i}", temp=True,
            salt=Salter().qb64, version=Vrsn_1_0)) for i in range(count)]
    wits = [witness["pre"] for witness in witnesses]
    witness_args = dict(wits=wits, toad=2 if wits else 0)
    members = [hby.makeHab(name="member", version=Vrsn_1_0,
               **(witness_args if count == 1 else {})) for hby in hbys]
    kel = [bytes(hab.msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_1_0)) for hab in members]
    signers = members
    if count == 2:
        kvys = [Kevery(db=hby.db, lax=True, local=False) for hby in hbys]
        for i, kvy in enumerate(kvys):
            Parser(version=Vrsn_1_0).parse(ims=bytearray(kel[1-i]), kvy=kvy, local=True)
        mids = [hab.pre for hab in members]
        signers = [hby.makeGroupHab(group="group", mhab=members[i], smids=mids,
                   rmids=mids, isith="2", nsith="2", **witness_args,
                   version=Vrsn_1_0, kind=Kinds.json) for i, hby in enumerate(hbys)]
        partials = [hab.msgOwnInception(allowPartiallySigned=True, framed=True,
                    gvrsn=Vrsn_1_0) for hab in signers]
        for i, kvy in enumerate(kvys):
            Parser(version=Vrsn_1_0).parse(ims=bytearray(partials[1-i]), kvy=kvy, local=True)
            kvy.processEscrows()
            assert signers[i].pre in kvy.kevers
        kel.append(bytes(signers[0].msgOwnEvent(sn=0, framed=True, gvrsn=Vrsn_1_0)))
    sender = signers[0]
    if witnesses:
        hby = hbys[0]
        resolver = Oobiery(hby=hby, version=Vrsn_1_0)
        receiptor = Receiptor(hby=hby)
        for witness in witnesses:
            hby.db.oobis.pin(keys=(witness["url"],), val=OobiRecord(date=helping.nowIso8601()))
        doist = doing.Doist(tock=.005, real=True, doers=[*resolver.doers, receiptor])
        deadline = time.monotonic() + 20
        def recur():
            if time.monotonic() >= deadline:
                raise TimeoutError("Witness introductions/receipts did not complete")
            doist.recur()
            time.sleep(.005)
        try:
            doist.enter()
            while not all((record := hby.db.roobi.get(keys=(wit["url"],))) is not None
                          and record.state == "resolved" for wit in witnesses):
                recur()
            assert all(wit["pre"] in hby.kevers for wit in witnesses)
            receiptor.msgs.append(dict(pre=sender.pre, sn=0))
            while not receiptor.cues:
                recur()
            assert sorted(sig.index for sig in hby.db.wigs.get(keys=(sender.pre, sender.kever.serder.said))) == [0, 1, 2]
        finally:
            doist.exit()
        # Stored replay carries witness receipts; msgOwnEvent carries controller signatures only.
        kel = [bytes(wire) for hab in members for wire in hab.db.clonePreIter(pre=hab.pre, gvrsn=Vrsn_1_0)]
        if count == 2:
            kel.extend(bytes(wire) for wire in sender.db.clonePreIter(pre=sender.pre, gvrsn=Vrsn_1_0))
    outsider = hbys[0].makeHab(name="outsider", version=Vrsn_1_0)
    return dict(pre=sender.pre, event=sender.kever.serder.said, witnesses=list(sender.kever.wits),
                receipts=sorted(sig.index for sig in sender.db.wigs.get(keys=(sender.pre, sender.kever.serder.said))),
                members=[hab.pre for hab in members],
                kel=[base64.b64encode(wire).decode() for wire in kel],
                packets=query_packets(signers, outsider))


def query_packets(signers, outsider):
    """Build signed KRAM controls without owning controller/witness preparation."""
    sender = signers[0]
    now = helping.nowUTC()
    packets = {}
    encode = lambda value: base64.b64encode(value).decode()
    for name, offset in (("first", 0), ("stale", -86400000), ("forged", 1), ("barrier", 2)):
        body = query(pre=sender.pre, route="mbx", query=dict(i=sender.pre,
                     src=sender.pre, topics={"/reply": 0}),
                     stamp=helping.toIso8601(now + timedelta(milliseconds=offset)),
                     version=Vrsn_2_0, kind=Kinds.json)
        wires = [encode(hab.endorse(body, last=True, framed=False, gvrsn=Vrsn_2_0))
                 for hab in signers]
        packets[name] = dict(said=body.said, stamp=body.stamp, wires=wires)
        if name == "forged":
            forged = messagize(body, tsgs=[(sender.kever.prefixer,
                Number(sn=sender.kever.lastEst.s), Diger(qb64=sender.kever.lastEst.d),
                outsider.sign(ser=body.raw, indexed=True))], gvrsn=Vrsn_2_0)
            packets[name]["invalid"] = encode(forged)
    return packets


class Control:
    """Test-only storage observations and genuine Python HTTP client actions."""
    def __init__(self, hby, host, mbx, stack, count):
        self.hby, self.host, self.mbx = hby, host, mbx
        self.stack, self.count, self.bundle = stack, count, None

    def on_post(self, req, rep):
        try:
            command = req.media
            action = command["action"]
            if action == "info":
                # Provider-only crash cases need no unrelated temporary controller stores.
                if self.bundle is None:
                    self.bundle = controller_packets(self.stack, self.count, command.get("witnesses", []))
                rep.media = self.bundle
            elif action == "store":
                self.mbx.storeMsg(topic=f'{command["pre"]}/reply', msg=PAYLOAD.encode())
                rep.media = dict(stored=True)
            elif action == "inspect":
                pre = command["pre"]
                rows = []
                for said in command["saids"]:
                    cache = self.hby.db.kramMSGC.get(keys=(pre, said))
                    rows.append(dict(said=said, cached=cache is not None,
                        pending=self.hby.db.kramPMKM.get(keys=(pre, said)) is not None,
                        stamp=cache.mdt if cache else None,
                        proofs=[sig.index for sig in self.hby.db.kramPMKS.get(keys=(pre, said))]))
                cues = list(self.host.cues) + list(self.host.queries)
                sender = self.host.kvy.kevers[pre] if pre in self.host.kvy.kevers else None
                state = None if sender is None else dict(event=sender.serder.said,
                    witnesses=list(sender.wits), threshold=sender.toader.num,
                    receipts=sorted(sig.index for sig in self.hby.db.wigs.get(keys=(pre, sender.serder.said))))
                rep.media = dict(pid=os.getpid(), provider=self.host.hab.pre,
                    sender=state, rows=rows,
                    streams=[cue["serder"].said for cue in cues if cue["kin"] == "stream"])
            elif action == "send":
                request = Request(command["url"], data=base64.b64decode(command["wire"]),
                    method="POST" if command["readEvent"] else "PUT",
                    headers={"Content-Type": "application/cesr"})
                try:
                    response = urlopen(request, timeout=10)
                except HTTPError as error:
                    response = error
                with response:
                    payload = None
                    if command["readEvent"] and response.headers.get_content_type() == "text/event-stream":
                        while True:
                            line = response.readline()
                            if not line:
                                raise AssertionError("Mailbox stream ended without a payload")
                            if line.startswith(b"data:"):
                                payload = line[5:].strip().decode()
                                break
                    elif response.headers.get_content_type() != "text/event-stream":
                        response.read()
                    rep.media = dict(status=response.status, payload=payload)
            else:
                raise ValueError(f"Unknown fixture action {action}")
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()


def main():
    port, count, root = sys.argv[1:]
    port, count = int(port), int(count)
    with ExitStack() as stack:
        cf = stack.enter_context(openCF(name="provider", temp=False, headDirPath=root))
        cf.put(dict(relay=dict(dt=helping.nowIso8601(), curls=[f"http://127.0.0.1:{port}/"]),
                    kram=dict(enabled=True, denials=[], caches={"~": WINDOWS})))
        hby = stack.enter_context(openHby(name="provider", temp=False, headDirPath=root, cf=cf, version=Vrsn_2_0))
        _prepareMailboxHabitat(hby=hby, alias="relay")
        mbx = Mailboxer(name="relay", base=hby.base, temp=False, headDirPath=root)
        stack.callback(mbx.close, clear=False)
        doers = setupMailbox(hby, alias="relay", mbx=mbx, httpPort=port)
        server = next(doer.server for doer in doers if isinstance(doer, http.ServerDoer))
        host = next(doer for doer in doers if isinstance(doer, MailboxStart))
        assert server.servant.ha[1] == port, "HIO must bind the selected unprivileged port"
        server.app.add_route("/_fixture", Control(hby, host, mbx, stack, count))
        doist = doing.Doist(tock=.005, real=True, doers=doers)
        running = True
        def stop(*_):
            nonlocal running
            running = False
        signal.signal(signal.SIGTERM, stop)
        try:
            doist.enter()
            while running:
                doist.recur()
                time.sleep(.005)
        finally:
            doist.exit()
            server.close()


if __name__ == "__main__":
    main()
