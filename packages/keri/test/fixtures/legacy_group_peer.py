"""Real legacy and v2 group members behind ordinary Python HTTP/parser intake.

Fixture commands choose public signing/verification operations. They never seed
accepted rows. Member and independent-wallet deliveries use the unmodified
HttpEnd/Parser, with separate Habery/Reger environments and private keys.
The legacy lane uses explicit v1 child framing around its pinned CLI defect.
V2 approval shares the caller's live KRAM, registry and exchange owners;
ordinary protocol verification remains the sole acceptance boundary.
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


class AcdcV2Role:
    """One independent member; public intake and explicit local approval share v2 owners."""
    def __init__(self, hby, root):
        from keri import Vrsn_1_0, Vrsn_2_0
        from keri.acdc import Regery, loadHandlers
        from keri.acdc.regbasing import RegBaser
        from keri.core import Kevery, Parser
        self.hby, self.version = hby, Vrsn_2_0
        self.member = hby.makeHab('member', version=Vrsn_1_0)
        self.rgy = Regery(hby, baser=RegBaser(name=hby.name, headDirPath=root, temp=False))
        self.notifier = notifying.Notifier(hby)
        self.exc = exchanging.Exchanger(hby, handlers=[])
        loadHandlers(hby, self.exc, self.notifier, rgy=self.rgy)
        self.kvy = Kevery(db=hby.db, lax=False, local=False, rvy=hby.rvy,
                          cf=hby.cf, enableKram=True, exc=self.exc)
        self.kvy.registerReplyRoutes(router=hby.rtr)
        self.psr = Parser(kvy=self.kvy, rvy=hby.rvy, rgy=self.rgy,
                          exc=self.exc, version=self.version, framed=False)
        self.mux = grouping.Multiplexor(hby, self.notifier, rgy=self.rgy, replay=self.psr)
        grouping.loadHandlers(self.exc, self.mux)
        self.group = None

    def receive(self):
        """Receipt retains proposals; only the selected control action adds a local share."""
        if self.psr.ims:
            self.psr.parse()
        self.kvy.processEscrows()
        self.rgy.processEscrows()
        self.exc.processEscrow()
        self.hby.rvy.processEscrowReply()

    def replay(self, hab):
        from keri.core import Counter
        return Counter.makeGVC(self.version) + b''.join(self.hby.db.clonePreIter(pre=hab.pre, gvrsn=self.version))

    def join(self, member):
        from keri import Vrsn_1_0
        self.group = self.hby.makeGroupHab(group='group', mhab=self.member,
            smids=[member, self.member.pre], rmids=[member, self.member.pre],
            isith='2', nsith='2', version=Vrsn_1_0)
        self.receive()
        assert self.group.accepted
        return dict(group=self.group.pre, kel=self.replay(self.group).decode())

    def proposal(self, wire, route):
        """Select a retained authenticated wrapper from the current member set."""
        from keri.core import Parser
        stream = bytearray(wire.encode())
        selected = Parser(version=self.version).parseOneBare(ims=stream, processive=False)
        assert not stream, 'approval requires exactly one selected wrapper'
        supplied = selected.serder
        self.mux.validate(supplied, nests=selected.nests)
        self.receive()
        wrapper, paths = exchanging.cloneMessage(self.hby, supplied.said)
        assert wrapper is not None, (route, supplied.said, list(self.exc.cues))
        assert wrapper.raw == supplied.raw and wrapper.route == route
        assert wrapper.sad['a']['gid'] == self.group.pre
        assert self.group.accepted and self.member.pre in self.hby.db.signingMembers(pre=self.group.pre)
        assert wrapper.pre in self.hby.db.signingMembers(pre=self.group.pre)
        return wrapper, paths

    def registry(self, wire):
        """Approve the exact TEL and KEL anchor, including retained historical retries."""
        from keri.core import SerderKERI, messagize
        route = SerderKERI(raw=wire.encode()).route
        assert route in ('/multisig/rip', '/multisig/bup')
        wrapper, _ = self.proposal(wire, route)
        children = exchanging.loadParsedNestedSubstreams(self.hby, wrapper.said)
        self.mux.validate(wrapper, nests=children)
        tel, anchor = [child.serder for child in children]
        prior = self.group.kever.serder.said
        proposal = None
        if self.hby.db.kels.getLast(keys=self.group.pre, on=anchor.sn) == anchor.said:
            # Accepted anchors may replay an exact earlier approval, never acquire today's signature.
            for said in self.hby.db.meids.get(keys=(anchor.said,)):
                retained = self.hby.db.exns.get(keys=(said.qb64,))
                if retained.pre == self.member.pre and grouping.sameRegistryProposal(retained, wrapper):
                    proposal, _ = exchanging.cloneMessage(self.hby, retained.said)
                    self.mux.validate(proposal, nests=exchanging.loadParsedNestedSubstreams(self.hby, proposal.said))
                    own = exchanging.serializeMessage(self.hby, proposal.said)
                    break
            assert proposal is not None, 'accepted anchor has no retained local approval'
        else:
            assert anchor.sn == self.group.kever.sn + 1 and anchor.sad['p'] == prior
            self.mux.validate(wrapper, nests=children)
            assert self.group.kever.serder.said == prior
            if anchor.ilk in ('rot', 'drt'):
                own = self.group.rotate(serder=anchor, smids=self.group.smids,
                                        rmids=self.group.rmids, framed=True, gvrsn=self.version)
            else:
                own = messagize(anchor, sigers=self.group.sign(anchor.raw), gvrsn=self.version)
                self.psr.parse(ims=bytearray(own), local=True, version=self.version)
            build = grouping.multisigRipExn if tel.ilk == 'rip' else grouping.multisigBupExn
            kwa = dict(rgy=self.rgy) if tel.ilk == 'bup' else {}
            proposal, foot = build(self.group, exchanging.serializeParsedSubstream(children[0]), own, **kwa)
            own = proposal.raw + foot
            self.psr.parseOneBare(ims=bytearray(own), local=True, version=self.version)
        self.receive()
        regid = tel.said if tel.ilk == 'rip' else tel.sad['rd']
        head = self.rgy.store.head(regid)
        return dict(wire=own.decode(), said=proposal.said, head=head.qb64 if head else None)

    def exchange(self, wire, from_grant=None, selected=None):
        """Approve one selected child; v2 owners alone complete its quorum and disclosure checks."""
        from copy import deepcopy
        from keri.core import Number, Diger, verifySigs
        wrapper, _ = self.proposal(wire, '/multisig/exn')
        assert wrapper.pvrsn == self.version
        children = exchanging.loadParsedNestedSubstreams(self.hby, wrapper.said)
        self.mux.validate(wrapper, nests=children)
        assert len(children) == 1
        parsed = children[0]
        child = parsed.serder
        assert child.pre == self.group.pre and wrapper.sad['a']['exn'] == child.said
        # Partial sender shares are real signatures, but final group threshold belongs to Exchanger.
        sender = [tsg for tsg in parsed.tsgs if tsg[0].qb64 == child.pre]
        assert sender, 'selected child requires its own authenticated group contribution'
        for prefixer, number, diger, sigers in parsed.tsgs:
            if prefixer.qb64 == child.pre:
                _, verfers = self.hby.db.resolveVerifiers(pre=child.pre, sn=number.sn, dig=diger.qb64)
                verified, _ = verifySigs(child.raw, sigers, verfers)
                assert len(verified) == len(sigers) and verified
        supplemental = [tsg for tsg in parsed.tsgs if tsg[0].qb64 != child.pre]
        tsgs, cigars, seals, invalid, missing = exchanging.verifyAttachments(
            self.hby, child, tsgs=supplemental, cigars=parsed.cigars,
            sourceSeals=parsed.ssts)
        handler = self.exc.handlerFor(child)
        evidence = handler.verifyEvidence(child, tsgs=tsgs, cigars=cigars,
            sourceSeals=seals, invalid=invalid, missing=missing)
        assert evidence is not None
        assert not self.exc.complete(child.said)
        assert self.hby.db.exns.get((child.said,)) is None
        assert self.member.pre not in [pre.qb64 for pre in self.hby.db.maids.get((child.said,))]
        if from_grant is not None:
            # Like GroupPresentation, explicit admitted-view selection precedes the
            # completed KRAM cutoff that ordinary verification obtains at quorum.
            from keri.core import Parser
            from keri.cli.common.presenting import admitted, currentIssued
            source, nodes = admitted(self.hby, self.group, from_grant)
            currentIssued(self.exc, from_grant)
            selection = bytearray(selected.encode())
            expected = Parser(version=self.version).parseOneBare(ims=selection, processive=False)
            assert not selection and child.raw == expected.serder.raw
            assert child.route == '/ipex/grant' and child.ilk == 'xip'
            assert child.sad['q'] == source.sad['q'] and child.sad['a']['o'] == source.sad['a']['o']
            assert [node.serder.raw for node in parsed.nests] == [node.serder.raw for node in nodes]
            assert [exchanging.serializeParsedSubstream(node) for node in parsed.nests] == [
                exchanging.serializeParsedSubstream(node) for node in expected.nests]
        else:
            assert selected is None
            # Pinned read-only v2 gate applies before issuance/Admit shares.
            verdict, _ = handler._verifyResult(child, nests=parsed.nests, sscs=parsed.sscs, evidence=evidence)
            assert verdict.verdict == 'valid', (verdict, child.sad)
        approved = deepcopy(parsed)
        coordinate = (self.group.kever.prefixer, Number(num=self.group.kever.lastEst.s),
                      Diger(qb64=self.group.kever.lastEst.d))
        for pre, number, diger, sigers in approved.tsgs:
            if (pre.qb64, number.sn, diger.qb64) == (coordinate[0].qb64, coordinate[1].sn, coordinate[2].qb64):
                sigers.extend(self.group.sign(child.raw))
                break
        else:
            approved.tsgs.append((*coordinate, self.group.sign(child.raw)))
        own = exchanging.serializeParsedSubstream(approved)
        proposal, foot = grouping.multisigExn(self.group, own, version=self.version)
        self.psr.parseOneBare(ims=bytearray(proposal.raw + foot), local=True, version=self.version)
        self.receive()
        assert self.exc.complete(child.said), 'v2 quorum and disclosure must verify before publication'
        return dict(wire=(proposal.raw + foot).decode(), said=proposal.said,
            child=child.said, complete=self.exc.complete(child.said),
            accepted=exchanging.serializeMessage(self.hby, child.said).decode()
                if self.exc.complete(child.said) else None)

    def role(self, wire):
        """Sign only an explicitly selected controller binding for this actual group/member set."""
        from keri.core import Counter, SerderKERI
        event = SerderKERI(raw=wire.encode())
        assert event.route == '/end/role/add'
        assert event.sad['a']['cid'] == self.group.pre
        assert event.sad['a']['eid'] in self.group.smids
        assert event.sad['a']['role'] == 'controller'
        own = self.group.endorse(event, last=False, framed=False, gvrsn=self.version)
        self.psr.parse(ims=bytearray(own), local=True, version=self.version)
        return dict(wire=(Counter.makeGVC(self.version) + own).decode())

    def evidence(self):
        """Replay accepted public histories; openings require an owner's explicit disclosure."""
        from keri.core import Counter, Codens
        raw = bytearray(self.replay(self.group))
        for keys, _ in self.rgy.store.baser.heads.getTopItemIter():
            for event in self.rgy.store.cloneTelIter(keys[0]):
                raw.extend(event)
                raw.extend(Counter(Codens.AttachmentGroup, count=0, version=self.version).qb64b)
        return dict(wire=raw.decode())

    def admission(self, grant, admit):
        """Observe the exact locally accepted protocol pair; this creates no wallet consent record."""
        message, _ = exchanging.cloneMessage(self.hby, grant)
        response, _ = exchanging.cloneMessage(self.hby, admit)
        assert self.exc.complete(grant) and self.exc.complete(admit)
        assert message.route == '/ipex/grant' and message.sad['ri'] == self.group.pre
        assert response.route == '/ipex/admit' and response.pre == self.group.pre
        assert response.sad['p'] == grant and self.hby.db.erpy.get((grant,)).qb64 == admit
        return dict(grant=grant, admit=admit)

    def snapshot(self, registry=None, exchange=None, grant=None):
        head = self.rgy.store.head(registry) if registry else None
        result = dict(head=head.qb64 if head else None,
                      complete=self.exc.complete(exchange) if exchange else False)
        if grant:
            admit = self.hby.db.erpy.get((grant,)).qb64
            self.admission(grant, admit)
            message, _ = exchanging.cloneMessage(self.hby, grant)
            origin = message.sad['a']['o'][0]
            children = exchanging.loadParsedNestedSubstreams(self.hby, grant)
            selected = next(child for child in children if child.serder.said == origin)
            result.update(credential=origin, proof=exchanging.serializeParsedSubstream(selected).decode(),
                          grant=grant, admit=admit)
        return result

    def reopen(self):
        """Reopen persistent registry, identity, notification and configuration environments."""
        for store in (self.rgy.baser, self.hby.ks, self.hby.db, self.hby.cf, self.notifier.noter):
            store.close()
            assert store.reopen()
        self.hby.db.reload()
        return dict(group=self.group.pre)

class AcdcV2Control:
    """Select actual local APIs; foreign signed bytes still enter ordinary HTTP/parser intake."""
    def __init__(self, roles):
        self.roles = roles

    def on_get(self, req, rep):
        rep.media = dict(ready=True)

    def on_post(self, req, rep):
        try:
            for value in self.roles.values():
                value.receive()
            data = dict(req.media)
            role = self.roles[data.pop('role', 'issuer')]
            action = data.pop('action')
            if action == 'connect':
                from keri.core import Counter
                result = {}
                for name, value in self.roles.items():
                    endpoint = value.member.makeEndRole(eid=value.member.pre, role='controller',
                        gvrsn=value.version, framed=False)
                    endpoint += value.member.makeLocScheme(url=data['origins'][name], eid=value.member.pre,
                        scheme='http', gvrsn=value.version, framed=False)
                    value.psr.ims.extend(Counter.makeGVC(value.version) + endpoint)
                    value.receive()
                    result[name] = dict(member=value.member.pre,
                        kel=(value.replay(value.member) + endpoint).decode())
                rep.media = result
            elif action == 'join':
                rep.media = role.join(**data)
            elif action == 'schema':
                from keri.core.scheming import Schemer
                schema = Schemer(sed=data['schema'])
                role.hby.db.schema.pin(keys=(schema.said,), val=schema)
                rep.media = dict(said=schema.said)
            elif action == 'registry':
                rep.media = role.registry(**data)
            elif action == 'exchange':
                rep.media = role.exchange(**data)
            elif action == 'role':
                rep.media = role.role(**data)
            elif action == 'evidence':
                rep.media = role.evidence()
            elif action == 'reopen':
                rep.media = role.reopen()
            elif action == 'admission':
                rep.media = role.admission(**data)
            elif action == 'snapshot':
                rep.media = role.snapshot(**data)
            else:
                raise ValueError(action)
        except Exception:
            rep.status = falcon.HTTP_500
            rep.text = traceback.format_exc()


def run_acdc_v2(port, root):
    """Keep the legacy lane intact and host two independent actual ACDC v2 group members."""
    from contextlib import ExitStack
    from keri import Vrsn_2_0
    from keri.app.configing import Configer
    with ExitStack() as stack:
        roles = {}
        for label in ('issuer', 'holder'):
            cf = Configer(name=label, headDirPath=root, temp=False, reopen=True)
            cf.put(dict(kram=dict(enabled=True, denials=[],
                caches={'~': [1000, 5000, 60000, 300000, 5000, 60000, 300000]})))
            hby = stack.enter_context(habbing.openHby(name=label, headDirPath=root,
                temp=False, cf=cf, version=Vrsn_2_0))
            roles[label] = AcdcV2Role(hby, root)
            stack.callback(roles[label].rgy.close)
            stack.callback(roles[label].notifier.noter.close)
        control = AcdcV2Control(roles)
        app = falcon.App()
        app.add_route('/', HttpEnd(rxbs=roles['issuer'].psr.ims))
        app.add_route('/holder', HttpEnd(rxbs=roles['holder'].psr.ims))
        app.add_route('/_fixture', control)
        app.add_route('/health', control)
        server = createHttpServer('127.0.0.1', port, app)
        from keri.core import Pruner
        doist = doing.Doist(tock=.005, real=True, doers=[http.ServerDoer(server=server),
            *(Pruner(role.kvy.kramer, tock=.005) for role in roles.values())])
        running = True
        def stop(*_):
            nonlocal running
            running = False
        signal.signal(signal.SIGTERM, stop)
        try:
            doist.enter()
            while running:
                doist.recur()
                for value in roles.values():
                    value.receive()
                time.sleep(.005)
        finally:
            doist.exit()
            server.close()

def main():
    args = argparse.ArgumentParser()
    args.add_argument('port', type=int)
    args.add_argument('--legacy', action='store_true')
    args.add_argument('--acdc-v2', action='store_true')
    args.add_argument('--root')
    args = args.parse_args()
    if args.acdc_v2:
        run_acdc_v2(args.port, args.root)
        return
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
