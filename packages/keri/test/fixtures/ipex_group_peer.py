"""Explicit group fixture actions over the production issuance and anchor owners."""
from pathlib import Path
from types import SimpleNamespace
import time
import math
from urllib.parse import urlparse

from hio.base import doing
from hio.core import http

from keri import Kinds, Vrsn_2_0 as V2
from keri.acdc import Registrar, acdcmap
from keri.acdc.dhking import Dhke
from keri.acdc.unblinding import Unblind
from keri.app import Counselor, Multiplexor, Notifier, multisigBupExn, multisigRipExn
from keri.app.grouping import MultisigNotificationHandler
from keri.app.httping import CESR_ATTACHMENT_HEADER, CESR_CONTENT_TYPE, CESR_DESTINATION_HEADER, CESR_GENUS_HEADER
from keri.cli.common.groupissuing import GroupIssuance
from keri.cli.common.issuing import NativeIssuance
from keri.cli.common.sending import messageParts
from keri.cli.common.nativeanchoring import groupAnchor
from keri.core import Diger, Number, Parser, Prefixer, SealSource, SerderKERI, messagize
from keri.help import nowUTC
from keri.peer.exchanging import loadParsedNestedSubstreams, serializeMessage, serializeParsedSubstream

from ipex_disclosures import partial_disclosure
from ipex_peer import IpexPeer


class _Owner:
    """Borrow the fixture's live stores and scheduler for one production generator."""
    evidence = NativeIssuance.evidence
    public = NativeIssuance.public

    def __init__(self, peer, args):
        self.peer, self.args = peer, args
        self.hby, self.hab, self.rgy = peer.hby, peer.hab, peer.rgy
        self.exc, self.dh, self.psr = peer.exc, peer.dh, peer.parser
        self.tock, self.deadline, self.nativeDeadline = .005, time.monotonic() + 180, None

    def check(self):
        if time.monotonic() >= self.deadline or self.nativeDeadline and nowUTC() >= self.nativeDeadline:
            raise TimeoutError('selected group fixture operation expired')

    def extend(self, doers):
        self.peer.doist.extend(doers)

    def record(self, raw, *, initial=False):
        pass  # Public proposal files and normal stores already retain the selected evidence.

    def finish(self, xid, grant):
        NativeIssuance.finish(self, xid, grant)
        self.peer.finished = grant
        self.peer.operation = None

    def send(self, raw, dest, *, topic='credential'):
        # The explicit proposal file is the first member delivery. Let its
        # contributor install the scoped command handler before live replay.
        packet = Parser(version=V2).parseOneBare(ims=bytearray(raw), processive=False)
        if (self.args.proposal_output and packet.serder.route == '/multisig/exn'
                and packet.nests and packet.nests[0].serder.route == '/ipex/grant'):
            body = packet.nests[0].serder
            xid = body.said if body.ilk == 'xip' else body.sad['x']
            while self.exc.pendingGrant(body.said, xid=xid, sender=self.hab.pre, recipient=body.sad['ri']) is None:
                self.check()
                yield self.tock
        yield from self.peer.send_to(raw, dest)


class GroupIpexPeer(IpexPeer):
    """One issuer member, with no custody sharing or implicit signing approvals."""
    def __init__(self, *args, **kwa):
        super().__init__(*args, **kwa)
        self.member = self.hab
        self.members = []
        self.flow = self.issuance = self.owner = None
        self.finished = None
        self.group_ready = False
        self.notifier = Notifier(self.hby)
        self.mux = Multiplexor(self.hby, self.notifier, rgy=self.rgy, replay=self.parser)
        self.counselor = Counselor(self.hby, version=V2, kind=Kinds.json)
        self.doist.doers.append(self.counselor)
        for route in ('/multisig/rip', '/multisig/bup'):
            self.exc.addHandler(MultisigNotificationHandler(route, self.mux))

    def info(self):
        result = super().info()
        if hasattr(self, 'member'):
            result['member'] = self.member.pre
            if self.members:
                result['urls'] = [member['url'] for member in self.members]
        return result

    def _deliver(self, raw, target):
        """Finite real HTTP clients yield to the same server; members cannot deadlock each other."""
        for serder, attachments in messageParts(raw):
            for address in target.get('urls', [target['url']]):
                url = urlparse(address)
                client = http.clienting.Client(scheme=url.scheme, hostname=url.hostname, port=url.port)
                child = http.clienting.ClientDoer(client=client)
                self.doist.extend([child])
                try:
                    client.request(method='POST', path=url.path or '/', body=serder.raw,
                        headers={'Content-Type': CESR_CONTENT_TYPE, CESR_GENUS_HEADER: '2',
                            CESR_ATTACHMENT_HEADER: attachments.decode(), CESR_DESTINATION_HEADER: target['pre']})
                    deadline = time.monotonic() + 10
                    while not client.responses:
                        if time.monotonic() >= deadline:
                            raise TimeoutError('group fixture HTTP submission expired')
                        yield .005
                    response = client.responses.popleft()
                    assert response['status'] == 204, response
                finally:
                    self.doist.remove([child])

    def post(self, raw, remote=None):
        if not self.members:
            return super().post(raw, remote)
        target = remote or self.remote
        def submit(tymth, tock=.005, **kwa):
            yield tock
            yield from self._deliver(raw, target)
        self.doist.extend([doing.doify(submit)])

    def send_to(self, raw, dest):
        target = next((member for member in self.members if member['pre'] == dest), None)
        if target is None:
            assert dest == self.remote['pre']
            target = self.remote
        yield from self._deliver(raw, target)

    def connect(self, remote, plan):
        if not self.members:
            return super().connect(remote, plan)
        self.remote, self.plan = remote, plan
        for member in self.members:
            self.post(b''.join(self.hby.db.clonePreIter(pre=member['pre'], gvrsn=V2)))
        self.post(self.hab.replay(gvrsn=V2))
        for member in self.members:
            self.post(self.hab.loadLocScheme(member['pre'], gvrsn=V2))
            if self.hab.fetchEndAllowed(self.hab.pre, 'controller', member['pre']):
                self.post(self.hab.loadEndRole(self.hab.pre, member['pre'], gvrsn=V2))

    def create_group(self, members, witnesses):
        assert not self.members and len(members) == 2 and self.member.pre in [m['pre'] for m in members]
        assert all(m['pre'] in self.hby.kevers for m in members)
        assert all(len(self.hby.kevers[m['pre']].verfers) == 1 for m in members)
        self.members = members
        self.hab = self.hby.makeGroupHab(group='issuer-group', mhab=self.member,
            smids=[m['pre'] for m in members], isith='2', nsith='2',
            wits=[w['pre'] for w in witnesses], toad=2, version=V2, kind=Kinds.json)
        old = (self.dh, self.unblind)
        self.hby.rtr.routes[:] = [route for route in self.hby.rtr.routes if route.resource not in old]
        self.dh = Dhke(self.hab, self.exc)
        self.unblind = Unblind(self.hab, self.exc, self.rgy, states=('issued', 'revoked', ''))
        self.hby.rtr.addRoute(Dhke.Route, self.dh)
        self.hby.rtr.addRoute(Unblind.Route, self.unblind, blinders=True, attachments=True)
        self.kvy.qvy = self.dh
        self.kvy.lax = True  # Match the live group CLI: ordinary own-group contributions enter KRAM.
        wire = self.hab.msgOwnInception(allowPartiallySigned=True, framed=False, gvrsn=V2)
        self.parser.parse(ims=bytearray(wire), local=True)
        location = self.member.makeLocScheme(url=super().info()['url'], gvrsn=V2)
        self.parser.parse(ims=bytearray(location), local=True)
        wire = location + wire
        for member in members:
            if member['pre'] != self.member.pre:
                self.post(wire, remote=member)
        self.counselor.start(self.hab, Prefixer(qb64=self.hab.pre), Number(num=0), Diger(qb64=self.hab.pre))
        return self.info()

    def group_endpoints(self):
        assert self.group_ready
        wires = [bytes(self.hab.makeEndRole(member['pre'], gvrsn=V2)) for member in self.members]
        for wire in wires:
            self.parser.parse(ims=bytearray(wire), local=True)
        return dict(wires=[wire.decode() for wire in wires])

    def approve_group_endpoints(self, wires):
        assert self.group_ready and len(wires) == len(self.members)
        approved = []
        for wire, member in zip(wires, self.members):
            packet = Parser(version=V2).parseOneBare(ims=bytearray(wire.encode()), processive=False)
            body = packet.serder
            assert body.pre == self.hab.pre and body.route == '/end/role/add'
            assert body.sad['a'] == dict(cid=self.hab.pre, role='controller', eid=member['pre'])
            self.parser.parse(ims=bytearray(wire.encode()), local=True)
            own = self.hab.endorse(body, gvrsn=V2)
            self.parser.parse(ims=bytearray(own), local=True)
            assert self.hab.fetchEndAllowed(self.hab.pre, 'controller', member['pre'])
            approved.append(bytes(self.hab.loadEndRole(self.hab.pre, member['pre'], gvrsn=V2)))
        for member in self.members:
            if member['pre'] != self.member.pre:
                self.post(b''.join(approved), remote=member)
        return dict(wires=[wire.decode() for wire in approved])

    def progress(self):
        if not self.members:
            return
        self.hby.kvy.processEscrows()
        self.mux.kvy.processEscrows()
        if not self.group_ready:
            self.group_ready = self.counselor.complete(Prefixer(qb64=self.hab.pre), Number(num=0), Diger(qb64=self.hab.pre))
            if self.group_ready:
                self.coordinator = (self.hab.kever.sn, self.hab.kever.serder.said)
                for member in self.members:
                    if member['pre'] != self.member.pre:
                        self.post(self.hab.replay(gvrsn=V2), remote=member)
        if self.flow is not None:
            try:
                next(self.flow)
            except StopIteration:
                self.flow = None
        if self.issuance and self.issuance.xid and self.finished is None:
            self.operation = dict(grant=self.issuance.grant.said, xid=self.issuance.xid, replySent=False)

    def send_auxiliary_cues(self):
        if not self.members:
            return super().send_auxiliary_cues()
        # GroupIssuance owns its query/reply cues, including own threshold intake.

    def prepare_group_registry(self):
        assert self.group_ready and self.member.pre == self.members[0]['pre']
        registry = Registrar(self.rgy).makeRegistry(name='derived', prefix=self.hab.pre)
        event = self.rgy.store.event(registry.regk)
        signed = self.hab.interact(data=[dict(i=registry.regk, s='0', d=event.said)], gvrsn=V2)
        anchor = SerderKERI(raw=signed)
        tel = messagize(event, bonds=[SealSource(s=anchor.snh, d=anchor.said)], gvrsn=V2)
        wrapper, atc = multisigRipExn(self.hab, tel, signed)
        wire = bytes(wrapper.raw + atc)
        self.parser.parse(ims=bytearray(wire), local=True)
        self.counselor.start(self.hab, Prefixer(qb64=self.hab.pre), Number(num=anchor.sn), Diger(qb64=anchor.said))
        self.registry = registry
        for member in self.members:
            if member['pre'] != self.member.pre:
                self.post(wire, remote=member)
        return dict(registry=registry.regk, proposal=wire.decode())

    def pending_group_event(self):
        for _, wrapper in self.hby.db.exns.getTopItemIter():
            if wrapper.route not in ('/multisig/rip', '/multisig/bup') or wrapper.sad['a']['gid'] != self.hab.pre:
                continue
            children = loadParsedNestedSubstreams(self.hby, wrapper.said)
            tel = children[0].serder
            regid = tel.said if tel.ilk == 'rip' else tel.sad['rd']
            accepted = self.rgy.store.seqEvent(regid, Number(numh=tel.sad['n']).num)
            if accepted is None:
                return dict(said=tel.said, wire=bytes(serializeMessage(self.hby, wrapper.said)).decode())
        return None

    def approve_group_event(self, wire):
        raw = wire.encode()
        packet = Parser(version=V2).parseOneBare(ims=bytearray(raw), processive=False)
        assert packet.serder.route in ('/multisig/rip', '/multisig/bup')
        self.parser.parse(ims=bytearray(raw))
        wrapper = self.hby.db.exns.get((packet.serder.said,))
        assert wrapper is not None
        children = loadParsedNestedSubstreams(self.hby, wrapper.said)
        self.mux.validate(wrapper, nests=children)
        event, anchor = [child.serder for child in children]
        assert wrapper.sad['a']['gid'] == self.hab.pre
        assert anchor.sn == self.hab.kever.sn + 1 and anchor.sad['p'] == self.hab.kever.serder.said
        own = messagize(anchor, sigers=self.hab.sign(anchor.raw), gvrsn=V2)
        Parser(version=V2, kvy=self.hby.kvy, rvy=self.hby.rvy).parse(ims=bytearray(own), local=True)
        build = multisigRipExn if event.ilk == 'rip' else multisigBupExn
        kwa = {} if event.ilk == 'rip' else dict(rgy=self.rgy)
        proposal, atc = build(self.hab, serializeParsedSubstream(children[0]), own, **kwa)
        self.parser.parseOneBare(ims=bytearray(proposal.raw + atc), local=True)
        self.counselor.start(self.hab, Prefixer(qb64=self.hab.pre), Number(num=anchor.sn), Diger(qb64=anchor.said))
        for member in self.members:
            if member['pre'] != self.member.pre:
                self.post(proposal.raw + atc, remote=member)
        return dict(event=event.said)

    def _issuance(self, body, *, consentLifetime, proposal=None):
        assert self.issuance is None and math.isfinite(consentLifetime) and consentLifetime > 0
        # NativeIssuance.run requires this explicit policy before GroupIssuance's
        # protected first partial intake. Exchanger freezes epsd with put-only semantics.
        self.exc.TimeoutPSE = consentLifetime
        directory = Path(self.hby.db.path).parent
        credential = directory / 'group-body.cesr'
        credential.write_bytes(body.raw)
        proposalfile = directory / 'group-proposal.cesr'
        if proposal is not None:
            proposalfile.write_text(proposal)
        args = SimpleNamespace(credential=str(credential), recipient=self.remote['pre'],
            proposal=str(proposalfile) if proposal is not None else None,
            proposal_output=None if proposal is not None else str(proposalfile), output=None,
            authenticate=False, code=[], code_time=None, prior=None, message='derived issuance',
            consent_lifetime=consentLifetime)
        self.owner = _Owner(self, args)
        # The command takes over this exact existing notification route.
        self.exc.routes.pop('/multisig/bup')
        self.issuance = GroupIssuance(self.owner, self.notifier, self.coordinator, self.members[0]['pre'])
        self.mux = self.issuance.mux
        self.flow = self.issuance.run([])
        next(self.flow)  # Stops at finite delivery; only explicitly selected command work advances.
        return dict(grant=self.issuance.grant.said, proposal=proposalfile.read_text(), info=self.info())

    def prepare_group_derived(self, recipient, consentLifetime):
        assert recipient == self.remote['pre'] and self.rgy.store.headEvent(self.registry.regk).ilk == 'rip'
        old = self.graph.full_nodes[0]
        full = acdcmap(self.hab.pre, iseaid=recipient, schema=old.sad['s'], regid=self.registry.regk,
                       uuid=old.sad['u'], attribute=old.sad['a'])
        body = partial_disclosure(full, ['a/i', 'a/status/'])
        self.graph.full_nodes, self.graph.nodes = [full], [body]
        return self._issuance(body, consentLifetime=consentLifetime)

    def approve_group_derived(self, proposal, consentLifetime):
        packet = Parser(version=V2).parseOneBare(ims=bytearray(proposal.encode()), processive=False)
        assert self.hby.db.epsd.get((packet.nests[0].serder.said,)) is None
        body = packet.nests[0].nests[0].serder
        self.graph.nodes = [body]
        return self._issuance(body, consentLifetime=consentLifetime, proposal=proposal)

    def final_group_proof(self, grant):
        assert self.finished == grant and self.exc.complete(grant)
        return dict(proof=bytes(serializeMessage(self.hby, grant)).decode())

    def accept_group_proof(self, grant, proof):
        before, _ = self.auxiliary_grant(grant)
        # The exact authenticated KRAM transaction owns the Grant lifetime; epsd is cleanup only.
        deadline = self.exc.exchangeDeadline(before)
        packet = Parser(version=V2).parseOneBare(ims=bytearray(proof.encode()), processive=False)
        assert packet.serder.raw == before.raw and deadline is not None and nowUTC() < deadline
        # Ordinary original group threshold/registry verification owns acceptance.
        Parser(version=V2, kvy=self.hby.kvy, exc=self.exc, rvy=self.hby.rvy,
               rgy=self.rgy).parse(ims=bytearray(proof.encode()), local=True)
        assert self.exc.complete(grant) and self.exc.exchangeDeadline(before) == deadline
        self.operation = None
        return dict(accepted=True)

    def publish_update(self, recipient):
        assert self.finished is not None and self.flow is None
        node = self.graph.nodes[0]
        registry = self.rgy.regs[node.regid]
        root = self.hab.mgr.getRegistryRoot(self.hab.pre, registry.regk)
        _, event = Registrar(self.rgy).issue(registry, acdc=node, salt=root.qb64)
        def publish():
            yield from groupAnchor(self.owner, registry, event, self.mux, [])
            yield from self._deliver(self.hab.replay(gvrsn=V2), self.remote)
            yield from self._deliver(self.owner.public(registry.regk), recipient)
        self.flow = publish()
        next(self.flow)
        return dict(event=event.said)

    def snapshot(self, inspect=None, registry=None):
        # Contributors never claim root derivation readiness. Custodian completion
        # is reflected by actual encrypted root retention / accepted Grant state.
        operation = self.operation
        if self.members and operation and (self.member.pre != self.members[0]['pre'] or self.exc.complete(operation['grant'])):
            self.operation = None
        selected = self.hab
        if self.members and not self.hab.accepted:
            self.hab = self.member
        try:
            result = super().snapshot(inspect)
        finally:
            self.hab = selected
            self.operation = operation
        result['groupReady'] = self.group_ready
        result['member'] = self.member.pre
        result['signingMembers'] = self.hby.db.signingMembers(pre=self.hab.pre) if self.members and self.hab.accepted else []
        result['deliveredReply'] = False
        result['querySaid'] = SerderKERI(raw=self.issuance.query).said if self.issuance and self.issuance.query else None
        result['groupEndpoints'] = bool(self.members and all(
            self.hab.fetchEndAllowed(self.hab.pre, 'controller', member['pre'])
            and self.hab.fetchLoc(member['pre']) for member in self.members))
        if registry is not None:
            head = self.rgy.store.headEvent(registry)
            result['registryHead'] = head.said if head else None
            result['openingPresent'] = bool(head and self.rgy.store.opening(head.said))
            result['rootPresent'] = self.hab.mgr.getRegistryRoot(self.hab.pre, registry) is not None
        result['groupPhase'] = ('finished' if self.finished else 'contributed' if self.issuance and self.flow is None
                                else 'running' if self.issuance else 'setup')
        return result
