"""A real legacy TEL group member behind ordinary Python HTTP/parser intake.

Fixture commands choose public signing/verification operations. They never seed
accepted rows. Member and independent-wallet deliveries use the unmodified
HttpEnd/Parser, with separate Habery/Reger environments and private keys.
Explicit v1 child framing avoids the separately recorded pinned-main KLI defect;
this fixture demonstrates protocol/API capability, not corrected CLI behavior.
"""
import argparse
import signal
import time
import traceback
from urllib.request import Request, urlopen

import falcon
from hio.base import doing
from hio.core import http
from keri import kering
from keri.app import grouping, habbing, notifying
from keri.app.signing import serialize
from keri.vc import proving, protocoling
from keri.vdr import eventing as teling
from keri.app.indirecting import HttpEnd, createHttpServer
from keri.core import coring, eventing, parsing, scheming, serdering
from keri.peer import exchanging
from keri.vdr import credentialing, verifying


def post(url, wire):
    """Join a real HTTP delivery; protocol acceptance is checked separately."""
    request = Request(url, data=bytes(wire), method='POST',
                      headers={'Content-Type': 'application/cesr'})
    with urlopen(request, timeout=15) as response:
        assert response.status == 204
        response.read()


class GroupPeer:
    """Own one member, normal processors and the group's independently accepted evidence."""
    def __init__(self, hby, legacy):
        self.hby, self.legacy = hby, legacy
        self.versions = {} if legacy else dict(version=kering.Vrsn_1_0)
        self.framing = {} if legacy else dict(gvrsn=kering.Vrsn_1_0, framed=True)
        self.member = hby.makeHab('member', **self.versions)
        self.rgy = credentialing.Regery(hby=hby, name=hby.name, temp=hby.temp)
        self.vry = verifying.Verifier(hby=hby, reger=self.rgy.reger)
        self.notifier = notifying.Notifier(hby=hby)
        self.exc = exchanging.Exchanger(hby=hby, handlers=[])
        self.mux = grouping.Multiplexor(hby=hby, notifier=self.notifier)
        grouping.loadHandlers(self.exc, self.mux)
        protocoling.loadHandlers(hby, self.exc, self.notifier)
        self.psr = parsing.Parser(kvy=hby.kvy, tvy=self.rgy.tvy, vry=self.vry,
                                  exc=self.exc, **self.versions)
        self.group = None

    def receive(self):
        """Drain actual HTTP input and retry ordinary protocol escrows."""
        if self.psr.ims:
            self.psr.parse()
        self.hby.kvy.processEscrows()
        self.rgy.processEscrows()
        self.vry.processEscrows()
        self.exc.processEscrow()

    def own_event(self, hab, sn):
        if self.legacy:
            return hab.makeOwnEvent(sn=sn, allowPartiallySigned=True)
        return hab.msgOwnEvent(sn=sn, allowPartiallySigned=True, **self.framing)

    def connect(self, url):
        self.remote = url
        post(self.remote, self.own_event(self.member, 0))
        post(self.remote, self.member.makeEndRole(eid=self.member.pre, role=kering.Roles.controller, **self.framing, **self.versions))
        post(self.remote, self.member.makeLocScheme(url=self.origin, eid=self.member.pre, scheme="http", **self.framing, **self.versions))
        return dict(member=self.member.pre)

    def make_group(self, member):
        self.group = self.hby.makeGroupHab(group='group', mhab=self.member,
            smids=[member, self.member.pre], rmids=[member, self.member.pre],
            isith='2', nsith='2', **self.versions)
        post(self.remote, self.own_event(self.group, 0))
        return dict(group=self.group.pre)

    def endorse(self, said):
        """Approve exactly the stored VCP/ISS/REV child, using ordinary signer/parser/Tevery APIs."""
        wrapper, paths = exchanging.cloneMessage(self.hby, said=said)
        assert wrapper is not None
        assert wrapper.ked['a']['gid'] == self.group.pre
        route, embeds = wrapper.ked['r'], wrapper.ked['e']
        anchor = serdering.SerderKERI(sad=embeds['anc'])
        # Explicit approval is protected local intake, like Multiplexor replay.
        # Network receipt itself remains unprotected and cannot authorize signing.
        self.psr.parseOne(ims=bytearray(anchor.raw + paths['anc']), local=True)
        own_anchor = eventing.messagize(serder=anchor,
                                       sigers=self.group.sign(anchor.raw), **self.framing)
        self.psr.parseOne(ims=bytearray(own_anchor), local=True)
        self.hby.kvy.processEscrows()
        assert self.hby.kevers[self.group.pre].serder.said == anchor.said, (self.hby.kevers[self.group.pre].sn, anchor.sn)
        label = {'/multisig/vcp':'vcp', '/multisig/iss':'iss', '/multisig/rev':'rev'}[route]
        tel = serdering.SerderKERI(sad=embeds[label])
        self.rgy.tvy.processEvent(serder=tel, seqner=coring.Seqner(sn=anchor.sn),
                                  saider=coring.Saider(qb64=anchor.said))
        if label == 'vcp':
            response, atc = grouping.multisigRegistryInceptExn(self.group,
                usage=wrapper.ked['a']['usage'], vcp=tel.raw, anc=own_anchor, **self.versions)
        elif label == 'iss':
            creder = serdering.SerderACDC(sad=embeds['acdc'])
            acdc = creder.raw + paths['acdc']
            self.psr.parseOne(ims=bytearray(acdc), local=True)
            assert self.rgy.reger.saved.get(keys=(creder.said,)) is not None
            response, atc = grouping.multisigIssueExn(self.group, acdc=acdc,
                iss=tel.raw, anc=own_anchor, **self.versions)
        else:
            response, atc = grouping.multisigRevokeExn(self.group, said=tel.pre,
                rev=tel.raw, anc=own_anchor, **self.versions)
        wire = bytearray(response.raw + atc)
        self.psr.parseOne(ims=bytearray(wire), local=True)
        post(self.remote, wire)
        return dict(said=response.said, tel=tel.said)

    def issue(self, registry, schema, recipient):
        """Propose a new credential with Python factories; ordinary escrows wait for the peer signature."""
        creder = proving.credential(schema=schema, issuer=self.group.pre,
            recipient=recipient, status=registry, data=dict(role='python-proposer'), **self.versions)
        tel = teling.issue(creder.said, registry, **self.versions)
        anchor_wire = self.group.interact(data=[dict(i=tel.pre, s=tel.snh, d=tel.said)],
                                         **self.framing, **self.versions)
        anchor = serdering.SerderKERI(raw=anchor_wire)
        try:
            self.rgy.tvy.processEvent(serder=tel, seqner=coring.Seqner(sn=anchor.sn),
                                      saider=coring.Saider(qb64=anchor.said))
        except kering.MissingAnchorError:
            pass  # Expected ordinary TEL escrow while the group anchor is partial.
        prefixer, seqner, saider = (coring.Prefixer(qb64=tel.pre),
            coring.Seqner(sn=tel.sn), coring.Saider(qb64=tel.said))
        # Main signing.serialize selects library-default v2; this legacy
        # pathed child instead uses its public messagize API with explicit v1.
        acdc = (serialize(creder, prefixer, seqner, saider) if self.legacy else
                eventing.messagize(creder,
                    bonds=[eventing.SealEvent(i=prefixer, s=seqner, d=saider)], **self.framing))
        self.psr.parseOne(ims=bytearray(acdc), local=True)
        wrapper, atc = grouping.multisigIssueExn(self.group, acdc=acdc,
            iss=tel.raw, anc=anchor_wire, **self.versions)
        wire = bytearray(wrapper.raw + atc)
        self.psr.parseOne(ims=bytearray(wire), local=True)
        post(self.remote, wire)
        return dict(credential=creder.said, exnSaid=wrapper.said)

    def approve_exchange(self, said):
        """Contribute a group EXN signature while preserving its independently proved children."""
        wrapper, paths = exchanging.cloneMessage(self.hby, said=said)
        assert wrapper.ked['r'] == '/multisig/exn'
        assert wrapper.ked['a']['gid'] == self.group.pre
        child = serdering.SerderKERI(sad=wrapper.ked['e']['exn'])
        self.psr.parseOne(ims=bytearray(child.raw + paths['exn']), local=True)
        endorsement = dict(pipelined=False) if self.legacy else self.framing
        wire = self.group.endorse(serder=child, last=False, **endorsement)
        wire.extend(paths['exn'])
        self.psr.parseOne(ims=bytearray(wire), local=True)
        self.exc.processEscrow()
        assert self.exc.complete(said=child.said)
        approval, atc = grouping.multisigExn(self.group, exn=wire, **self.versions)
        self.psr.parseOne(ims=bytearray(approval.raw + atc), local=True)
        post(self.remote, approval.raw + atc)
        return dict(accepted=child.said, exnSaid=approval.said)

    def snapshot(self, registry, credential=None, exchange=None):
        tever = self.rgy.tevers.get(registry)
        state = tever.vcState(credential) if tever and credential else None
        return dict(registry=tever.pre if tever else None,
                    state=state.et if state else None,
                    saved=bool(credential and self.rgy.reger.saved.get(keys=(credential,))),
                    accepted=bool(exchange and self.hby.db.exns.get(keys=(exchange,))))


class IpexRecipient:
    """Recipient application operations borrow explicit identity and protocol owners."""
    def __init__(self, hby, hab, rgy, vry, exc, psr, legacy):
        self.hby, self.hab, self.rgy, self.vry = hby, hab, rgy, vry
        self.exc, self.psr = exc, psr
        self.versions = {} if legacy else dict(version=kering.Vrsn_1_0)
        self.remote = None

    def receive(self):
        """Advance this recipient's ordinary parser and dependency escrows."""
        if self.psr.ims:
            self.psr.parse()
        self.hby.kvy.processEscrows()
        self.rgy.processEscrows()
        self.vry.processEscrows()
        self.exc.processEscrow()

    def snapshot(self, registry, credential=None, exchange=None):
        """Report independently accepted wallet state, never another member's rows."""
        tever = self.rgy.tevers.get(registry)
        state = tever.vcState(credential) if tever and credential else None
        return dict(state=state.et if state else None,
                    digest=state.d if state else None,
                    saved=bool(credential and self.rgy.reger.saved.get(keys=(credential,))),
                    accepted=bool(exchange and self.hby.db.exns.get(keys=(exchange,))))

    def request(self, group, schema, message):
        """Open an actual legacy application to the group, before offer or refusal."""
        application, atc = protocoling.ipexApplyExn(self.hab, recp=group,
            message=message, schema=schema, attrs=dict(role='member'), **self.versions)
        wire = bytearray(application.raw + atc)
        self.psr.parseOne(ims=bytearray(wire), local=True)
        assert self.exc.complete(said=application.said)
        post(self.remote, wire)
        return dict(said=application.said)

    def agree(self, said):
        """Respond to the exact accepted group offer through the reference factory."""
        offer = self.hby.db.exns.get(keys=(said,))
        assert offer is not None and offer.ked['r'] == '/ipex/offer'
        agreement, atc = protocoling.ipexAgreeExn(self.hab, message='agreed', offer=offer, **self.versions)
        wire = bytearray(agreement.raw + atc)
        self.psr.parseOne(ims=bytearray(wire), local=True)
        assert self.exc.complete(said=agreement.said)
        post(self.remote, wire)
        return dict(said=agreement.said)

    def admit(self, said):
        """Send a genuine recipient admission linked to the accepted group grant."""
        grant, paths = exchanging.cloneMessage(self.hby, said=said)
        assert grant is not None and grant.ked['r'] == '/ipex/grant'
        # Match KLI's grant reconstruction with an explicitly selected legacy
        # Parser context. Public API framing is not patched CLI evidence.
        for label in ('anc', 'iss', 'acdc'):
            factory = serdering.SerderACDC if label == 'acdc' else serdering.SerderKERI
            body = factory(sad=grant.ked['e'][label])
            self.psr.parseOne(ims=bytearray(body.raw + paths[label]))
        self.receive()
        assert self.rgy.reger.saved.get(keys=(grant.ked['e']['acdc']['d'],))
        admission, atc = protocoling.ipexAdmitExn(self.hab, message='accepted', grant=grant, **self.versions)
        wire = bytearray(admission.raw + atc)
        self.psr.parseOne(ims=bytearray(wire), local=True)
        assert self.exc.complete(said=admission.said)
        post(self.remote, wire)
        return dict(said=admission.said)

class Control:
    """Scenario controls are separate from authenticated protocol input."""
    def __init__(self, peer, recipient, wallet):
        self.peer, self.recipient, self.wallet = peer, recipient, wallet

    def on_get(self, req, rep):
        rep.media = dict(ready=True)

    def on_post(self, req, rep):
        try:
            self.peer.receive()
            self.wallet.receive()
            command = req.media
            action = command.pop('action')
            if action == 'schema':
                schema = scheming.Schemer(sed=command['schema'])
                self.peer.hby.db.schema.pin(keys=(schema.said,), val=schema)
                self.wallet.hby.db.schema.pin(keys=(schema.said,), val=schema)
                rep.media = dict(schema=schema.said)
            elif action == 'connect':
                self.recipient.remote = command['url']
                rep.media = self.peer.connect(**command)
                self.wallet.remote = command['url']
                framing = {} if self.peer.legacy else self.peer.framing
                post(self.wallet.remote, self.peer.own_event(self.wallet.hab, 0))
                post(self.wallet.remote, self.wallet.hab.makeEndRole(eid=self.wallet.hab.pre,
                    role=kering.Roles.controller, **framing, **self.wallet.versions))
                post(self.wallet.remote, self.wallet.hab.makeLocScheme(url=self.peer.origin + 'holder',
                    eid=self.wallet.hab.pre, scheme='http', **framing, **self.wallet.versions))
                rep.media['holder'] = self.wallet.hab.pre
            elif action == 'group':
                rep.media = self.peer.make_group(**command)
            elif action == 'endorse':
                rep.media = self.peer.endorse(**command)
            elif action == 'issue':
                rep.media = self.peer.issue(**command)
            elif action == 'approve-exchange':
                rep.media = self.peer.approve_exchange(**command)
            elif action == 'request':
                rep.media = self.recipient.request(group=self.peer.group.pre, **command)
            elif action == 'agree':
                rep.media = self.recipient.agree(**command)
            elif action == 'admit':
                rep.media = self.recipient.admit(**command)
            elif action == 'wallet-admit':
                rep.media = self.wallet.admit(**command)
            elif action == 'wallet-snapshot':
                rep.media = self.wallet.snapshot(**command)
            elif action == 'snapshot':
                rep.media = self.peer.snapshot(**command)
            else:
                raise ValueError(action)
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()


def main():
    args = argparse.ArgumentParser()
    args.add_argument('port', type=int)
    args.add_argument('--legacy', action='store_true')
    args = args.parse_args()
    versions = {} if args.legacy else dict(version=kering.Vrsn_1_0)
    with habbing.openHby(name='legacy-group-peer', temp=True, **versions) as hby, \
         habbing.openHby(name='independent-holder', temp=True, **versions) as holder_hby:
        peer = GroupPeer(hby, args.legacy)
        peer.origin = f"http://127.0.0.1:{args.port}/"
        recipient = IpexRecipient(hby, peer.member, peer.rgy, peer.vry, peer.exc, peer.psr, args.legacy)
        holder = holder_hby.makeHab('holder', **versions)
        holder_rgy = credentialing.Regery(hby=holder_hby, name=holder_hby.name, temp=True)
        holder_vry = verifying.Verifier(hby=holder_hby, reger=holder_rgy.reger)
        holder_notifier = notifying.Notifier(hby=holder_hby)
        holder_exc = exchanging.Exchanger(hby=holder_hby, handlers=[])
        protocoling.loadHandlers(holder_hby, holder_exc, holder_notifier)
        holder_psr = parsing.Parser(kvy=holder_hby.kvy, tvy=holder_rgy.tvy,
                                   vry=holder_vry, exc=holder_exc, **versions)
        wallet = IpexRecipient(holder_hby, holder, holder_rgy, holder_vry, holder_exc, holder_psr, args.legacy)
        app = falcon.App()
        app.add_route('/', HttpEnd(rxbs=peer.psr.ims))
        app.add_route('/holder', HttpEnd(rxbs=holder_psr.ims))
        app.add_route('/_fixture', Control(peer, recipient, wallet))
        app.add_route('/health', Control(peer, recipient, wallet))
        server = createHttpServer('127.0.0.1', args.port, app)
        doist = doing.Doist(tock=.005, real=True, doers=[http.ServerDoer(server=server)])
        running = True
        def stop(*_):
            nonlocal running
            running = False
        signal.signal(signal.SIGTERM, stop)
        try:
            doist.enter()
            while running:
                doist.recur()
                peer.receive()
                wallet.receive()
                time.sleep(.005)
        finally:
            doist.exit()
            server.close()
            peer.rgy.close()
            holder_rgy.close()


if __name__ == '__main__':
    main()
