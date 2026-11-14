"""Compose the existing IPEX peer with real KERIpy mailbox forwarding and polling.

The underlying peer still owns credential construction and verification. This
fixture adds its reply processor and connects Poller.msgs to normal parser intake.
No accepted rows are seeded and no reference source or HTTP peer is patched.

`relay` mode (argv: relay ROOT PORT) instead faces a keri-ts edge behind its agent:
it serves its own OOBI, resolves the edge's with Oobiery and sends with
StreamPoster to the edge's published mailbox end role. It starts on both the
candidate and upstream main profiles.
"""
import base64
import copy
import json
from pathlib import Path
import signal
import sys
import time
import traceback
from urllib.request import Request, urlopen

import falcon
from hio.base import doing
from keri import Kinds, Roles, Vrsn_2_0
from keri.acdc import Registrar, acdcmap, admit, grant
from keri.acdc import agree, apply, offer, spurn
from keri.acdc import regeventing
from keri.kering import Ilks
from keri.app.agenting import Receiptor
from keri.app.forwarding import StreamPoster
from keri.app.indirecting import Poller
from keri.app.oobiing import Oobiery
from keri.core import Blinder, Codens, Counter, Parser, messagize
from keri.core.scheming import Schemer
from keri.end.ending import loadEnds
from keri.help import helping
from keri.peer.exchanging import loadParsedNestedSubstreams
from keri.recording import OobiRecord

from ipex_disclosures import disclosure
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
        # The KERIpy witnesses and the mailbox provider both run the v2 stack.
        urls = [item["url"] for item in config["witnesses"]] + [f'{provider["url"]}oobi/{provider["pre"]}/controller']
        resolver = Oobiery(hby=hby, version=Vrsn_2_0)
        doist.extend(resolver.doers)
        for url in urls:
            hby.db.oobis.pin(keys=(url,), val=OobiRecord(date=helping.nowIso8601()))
        while not all((row := hby.db.roobi.get(keys=(url,))) is not None
                      and row.state == "resolved" for url in urls):
            recur()
        doist.remove(resolver.doers)
        hab.rotate(adds=[item["pre"] for item in config["witnesses"]], toad=2, version=Vrsn_2_0)
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


class RelayControl:
    """Choose actions against a keri-ts relay; Oobiery and StreamPoster doers own discovery and delivery.

    The remote is reached only through the end roles its OOBIs published: this control never posts protocol
    bytes and never seeds accepted rows. Each action returns after local commit; the test observes the
    outcome through `state`.
    """
    def __init__(self, peer):
        self.peer = peer
        self.issued = None

    def on_post(self, req, rep):
        try:
            self.peer.receive()
            command = req.media
            action = command.pop("action")
            if action not in ("resolve", "issue", "grant", "admit", "state", "holding", "revoke"):
                raise ValueError(f"Unknown relay command: {action}")
            rep.media = getattr(self, action)(**command)
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()

    def resolve(self, urls):
        """Queue OOBIs for the running Oobiery; resolution is observed through `state`."""
        db = self.peer.hby.db
        for url in urls:
            if db.roobi.get(keys=(url,)) is None and db.oobis.get(keys=(url,)) is None:
                db.oobis.pin(keys=(url,), val=OobiRecord(date=helping.nowIso8601()))
        return dict(queued=urls)

    def issue(self, recipient, registry, public=False):
        """Issue one v2 credential to `recipient`.

        With `registry`, incept a v2 registry and issue as an anchored blinded update (`rip`, `bup`) whose TEL
        events travel ahead of the Grant, which carries the opening on its node. A `public` opening is also
        published on the `bup`, so any reader of the TEL learns the state without an Unblind or key exchange; a
        private one travels only in the Grant. Without `registry`, the issuer's signature authenticates the node.
        """
        peer = self.peer
        hab = peer.hab
        if not registry:
            full, _ = disclosure(hab.pre, issuee=recipient)
            self.issued = dict(full=full, origin=peer.signed(full), events=[], recipient=recipient)
            return dict(credential=full.said, schema=full.sad["s"]["$id"], registry=None, events=[])
        reg = Registrar(peer.rgy).makeRegistry(name="relay", prefix=hab.pre)
        rip = peer.rgy.store.event(reg.regk)
        hab.interact(data=[dict(i=reg.regk, s="0", d=rip.said)], gvrsn=Vrsn_2_0)
        assert reg.anchorMsg(rip.said)
        old = peer.graph.full_nodes[0]
        schema = copy.deepcopy(old.sad["s"])
        schema["$id"] = ""
        schema["properties"]["rd"] = dict(type="string")
        schema = Schemer(sed=schema).sed
        full = acdcmap(hab.pre, iseaid=recipient, schema=schema, regid=reg.regk,
                       uuid=old.sad["u"], attribute=old.sad["a"])
        opening, update = reg.blind(full, "issued")
        hab.interact(data=[dict(i=reg.regk, s="1", d=update.said)], gvrsn=Vrsn_2_0)
        assert reg.anchorMsg(update.said)
        empty = Counter.enclose(qb64=b"", code=Codens.AttachmentGroup, version=Vrsn_2_0)
        published = Counter.enclose(qb64=Blinder.enclose([opening]), code=Codens.AttachmentGroup, version=Vrsn_2_0)
        # The Grant's node always carries its opening (KERIpy verifies a registry node only from disclosed proofs);
        # a public opening is also published on the `bup`, so any reader of the TEL holds it.
        origin = messagize(full, bonds=[opening.data], gvrsn=Vrsn_2_0)
        self.issued = dict(full=full, origin=origin, events=[(rip, empty), (update, published if public else empty)],
                           recipient=recipient)
        return dict(credential=full.said, schema=full.sad["s"]["$id"], registry=reg.regk,
                    events=[rip.said, update.said])

    def poster(self, recipient):
        return StreamPoster(hby=self.peer.hby, hab=self.peer.hab, recp=recipient, topic="credential",
                            version=Vrsn_2_0, kind=Kinds.json)

    def deliver(self, poster):
        doers = poster.deliver()
        assert doers, "StreamPoster must select one of the recipient's published end roles"
        self.peer.doist.extend(doers)

    def grant(self):
        """Open with a Grant of the issued credential; its TEL events travel first, also by StreamPoster."""
        issued = self.issued
        assert issued is not None, "issue first"
        recipient = issued["recipient"]
        body, attachments = grant(self.peer.hab, recipient, "relay issuance", origin=issued["origin"])
        Parser(version=Vrsn_2_0).parse(ims=bytearray(body.raw + attachments), kvy=self.peer.kvy,
                                       exc=self.peer.exc, rvy=self.peer.hab.rvy)
        assert self.peer.hby.db.exns.get(keys=(body.said,)) is not None, "the issuer accepts its own Grant"
        poster = self.poster(recipient)
        for event, attachment in issued["events"]:
            # Each TEL body is framed as one stream for the /fwd nest; only a published opening is attached.
            poster.send(event, attachment=attachment, gvrsn=Vrsn_2_0)
        poster.send(body, attachment=attachments, gvrsn=Vrsn_2_0)
        self.deliver(poster)
        return body.said

    def admit(self, grant):
        """Admit an accepted Grant from the remote and send the Admit by StreamPoster."""
        prior = self.peer.hby.db.exns.get(keys=(grant,))
        assert prior is not None, "the Grant is not accepted"
        body, attachments = admit(self.peer.hab, "relay presentation admitted", prior)
        Parser(version=Vrsn_2_0).parse(ims=bytearray(body.raw + attachments), kvy=self.peer.kvy,
                                       exc=self.peer.exc, rvy=self.peer.hab.rvy)
        assert self.peer.hby.db.exns.get(keys=(body.said,)) is not None, "the holder accepts its own Admit"
        poster = self.poster(prior.pre)
        poster.send(body, attachment=attachments, gvrsn=Vrsn_2_0)
        self.deliver(poster)
        return body.said

    def holding(self, grant, credential, registry):
        """Observation only: the registry state an accepted Grant authenticated for `credential` (`Baser.exrs`).

        The IPEX handler records the state each registry proof carries and judges none of it; this reads that
        record, the registry's accepted TEL head, and the state of that head as an opening this peer holds for it
        discloses (`current`, None when it holds none).
        """
        record = self.peer.hby.db.exrs.get(keys=(grant, credential))
        head = self.peer.rgy.store.headEvent(registry)
        opening = self.peer.rgy.store.opening(head.said) if head is not None and head.ilk == Ilks.bup else None
        current = regeventing.vetBlind(opening, blid=head.sad["b"])[1] if opening is not None else None
        return dict(state=record.state if record else None, said=record.said if record else None,
                    sn=record.sn if record else None, head=head.said if head else None, current=current)

    def revoke(self):
        """Revoke the issued registry credential with a published opening and send the evidence by StreamPoster.

        The `bup` that blinds `revoked` is anchored by a new interaction event; both travel to the recipient's
        published end role, the KEL event first, with the opening attached to the `bup` as in a public issuance.
        """
        issued = self.issued
        assert issued is not None and issued["events"], "issue a registry credential first"
        reg = self.peer.rgy.registryByName("relay")
        opening, update = reg.blind(issued["full"], "revoked")
        hab = self.peer.hab
        msg = hab.interact(data=[dict(i=reg.regk, s=update.sad["n"], d=update.said)], gvrsn=Vrsn_2_0)
        assert reg.anchorMsg(update.said)
        ixn = hab.kever.serder
        published = Counter.enclose(qb64=Blinder.enclose([opening]), code=Codens.AttachmentGroup, version=Vrsn_2_0)
        poster = self.poster(issued["recipient"])
        poster.send(ixn, attachment=bytes(msg[len(ixn.raw):]), gvrsn=Vrsn_2_0)
        poster.send(update, attachment=published, gvrsn=Vrsn_2_0)
        self.deliver(poster)
        return dict(event=update.said, anchor=ixn.said)

    def state(self, urls=(), pres=(), saids=(), registries=()):
        """Observations only: OOBI outcomes, known KELs and end roles, exchange and registry state."""
        db = self.peer.hby.db
        oobis = {}
        for url in urls:
            row = db.roobi.get(keys=(url,))
            oobis[url] = row.state if row is not None else ("queued" if db.oobis.get(keys=(url,)) else None)
        exchanges = {}
        for said in saids:
            body = db.exns.get(keys=(said,))
            exchanges[said] = dict(accepted=body is not None, escrowed=db.epse.get(keys=(said,)) is not None,
                                   route=body.route if body else None, sender=body.pre if body else None,
                                   prior=body.sad.get("p") if body else None,
                                   response=(db.erpy.get(keys=(said,)).qb64 if db.erpy.get(keys=(said,)) else None),
                                   nests=[dict(said=nest.serder.said, issuer=nest.serder.israid,
                                               issuee=nest.serder.sad.get("a", {}).get("i")
                                               if isinstance(nest.serder.sad.get("a"), dict) else None,
                                               registry=nest.serder.regid)
                                          for nest in loadParsedNestedSubstreams(self.peer.hby, said)]
                                   if body else [])
        heads = {}
        for regk in registries:
            head = self.peer.rgy.store.headEvent(regk)
            heads[regk] = head.said if head else None
        return dict(oobis=oobis, known={pre: (self.peer.kvy.kevers[pre].sn if pre in self.peer.kvy.kevers else None)
                                       for pre in pres},
                    ends={pre: {role: list(eids) for role, eids in self.peer.hab.endsFor(pre).items()} for pre in pres},
                    exchanges=exchanges, registries=heads, received=self.peer.received)


class ChainControl:
    """Choose the negotiation steps of a full IPEX conversation against a keri-ts relay (`/_chain`).

    Each step builds the message with the candidate's own IPEX builders, takes it into this peer's own
    Exchanger, and sends it by StreamPoster to the remote's published mailbox end role. A step whose message this
    peer's own Exchanger refuses still sends it when the caller asks (`refused`), so the test can see the remote
    refuse it too; the reply reports whether this peer accepted it. The Admit is `/_relay`'s `admit`.
    """
    def __init__(self, peer):
        self.peer = peer

    def on_post(self, req, rep):
        try:
            self.peer.receive()
            command = req.media
            action = command.pop("action")
            if action not in ("apply", "agree", "spurn", "offer"):
                raise ValueError(f"Unknown chain command: {action}")
            rep.media = getattr(self, action)(**command)
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()

    def prior(self, said):
        prior = self.peer.hby.db.exns.get(keys=(said,))
        assert prior is not None, f"the prior exchange {said} is not accepted"
        return prior

    def send(self, body, attachments, recipient, refused=False):
        """Take the message in locally, then deliver it; only a `refused` step may be refused by this peer."""
        Parser(version=Vrsn_2_0).parse(ims=bytearray(body.raw + attachments), kvy=self.peer.kvy,
                                       exc=self.peer.exc, rvy=self.peer.hab.rvy)
        accepted = self.peer.hby.db.exns.get(keys=(body.said,)) is not None
        assert accepted or refused, f"this peer refused its own {body.ked['r']}"
        poster = StreamPoster(hby=self.peer.hby, hab=self.peer.hab, recp=recipient, topic="credential",
                              version=Vrsn_2_0, kind=Kinds.json)
        poster.send(body, attachment=attachments, gvrsn=Vrsn_2_0)
        doers = poster.deliver()
        assert doers, "StreamPoster must select one of the recipient's published end roles"
        self.peer.doist.extend(doers)
        return dict(said=body.said, accepted=accepted)

    def apply(self, recipient, schema):
        """Open by asking `recipient` for a credential of `schema`; the plan requires only the root and schema."""
        body, attachments = apply(self.peer.hab, recipient, "relay apply", modifiers=dict(dp=[[[schema, "/", []]]]))
        return self.send(body, attachments, recipient)

    def agree(self, offer):
        """Accept the remote's accepted Offer."""
        prior = self.prior(offer)
        body, attachments = agree(self.peer.hab, "relay agree", prior)
        return self.send(body, attachments, prior.pre)

    def spurn(self, prior):
        """Refuse the remote's accepted Apply or Offer."""
        prior = self.prior(prior)
        body, attachments = spurn(self.peer.hab, "relay spurn", prior)
        return self.send(body, attachments, prior.pre)

    def offer(self, apply):
        """Answer the remote's accepted Apply with an Offer that discloses nothing; sent even if refused here."""
        prior = self.prior(apply)
        body, attachments = offer(self.peer.hab, "relay offer", origin=None, apply=prior)
        return self.send(body, attachments, prior.pre, refused=True)


def relay(port, root):
    """Serve one v2 KERIpy peer that discovers and reaches a keri-ts relay only through published end roles.

    The peer publishes its own controller location and end role, serves its OOBI with the stock OOBIEnd, runs a
    long-lived Oobiery, and processes what arrives at its HttpEnd with the base peer's escrow loop. No witness
    or mailbox host takes part: the relay's agent delivers to this controller endpoint directly.
    """
    with open_peer(port, None, version=Vrsn_2_0) as peer:
        peer.hby.rvy.cues = peer.kvy.cues
        peer.parser.rvy = peer.hby.rvy
        url = peer.info()["url"]
        for wire in (peer.hab.makeLocScheme(url=url, gvrsn=Vrsn_2_0), peer.hab.makeEndRole(eid=peer.hab.pre, gvrsn=Vrsn_2_0)):
            peer.parser.parse(ims=bytearray(wire), local=True)
        assert peer.hab.fetchEndAllowed(peer.hab.pre, Roles.controller, peer.hab.pre)
        loadEnds(peer.server.app, hby=peer.hby)
        peer.server.app.add_route("/_relay", RelayControl(peer))
        peer.server.app.add_route("/_chain", ChainControl(peer))
        peer.server.app.add_route("/health", Health())
        resolver = Oobiery(hby=peer.hby, version=Vrsn_2_0)
        peer.doist.extend(resolver.doers)
        signal.signal(signal.SIGTERM, lambda *_: peer.stop())
        info = dict(pre=peer.hab.pre, url=url, oobi=f"{url}oobi/{peer.hab.pre}/controller")
        pending = Path(root, "ready.pending")
        pending.write_text(json.dumps(info))
        pending.replace(Path(root, "ready.json"))
        peer.serve()


def main():
    if sys.argv[1] == "relay":
        _, root, port = sys.argv[1:]
        relay(int(port), root)
        return
    root, config_path, graph, port = sys.argv[1:]
    config = json.loads(Path(config_path).read_text())
    # The controller KEL matches its v2 witnesses and v2 provider; one KEL never mixes versions.
    with open_peer(int(port), graph, version=Vrsn_2_0) as peer:
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
