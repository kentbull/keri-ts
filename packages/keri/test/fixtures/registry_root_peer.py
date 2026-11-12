"""Operator-side store setup for the /registry/root mailbox interop case.

Each command opens one existing kli keystore the way an operator would and
leaves protocol delivery to the installed `kli vc registry root` commands:

- ``kram`` enables KRAM in the store's own config with a short window, or with
  the ``--caches`` JSON windows a longer live exchange needs;
- ``author`` creates an existing issuer registry whose root this AID holds,
  witnesses its anchors and writes the public KEL/TEL for the holder;
- ``accept`` gives a holder a foreign issuer's public KEL and TEL;
- ``root`` prints the root retained for one holder AID and registry.

For a mixed KERIpy and Tufa group whose KEL anchors come from the real
``multisig interact`` commands, three steps author a group registry held by
this member as DH custodian would hold it:

- ``group-registry`` stages a group ``rip`` and prints its anchor seal;
- ``group-issue`` accepts the anchored ``rip``, retains a fresh root and stages
  the root-blinded ``bup``, printing its anchor seal;
- ``group-publish`` accepts the anchored ``bup``, retains its opening (the
  verification-hint evidence a custodian has from its own Grant) and writes
  the public TEL for the other member.

``replicate`` then runs KERIpy's group issuance completion send,
``rootreplicating.replicate``, for one registry under its own finite host.

Adapted from KERIpy tests/cli/commands/test_registry_root_cli.py.
"""
import argparse
import json
from pathlib import Path

from hio.base import doing
from keri import Vrsn_2_0 as V2
from keri.acdc import Regery, Registrar, acdcmap, regeventing, salting
from keri.app import Notifier, Receiptor
from keri.cli.common import rootreplicating, setupHby
from keri.core import Blinder, Kevery, Parser, Salter, SealSource, SerderACDC, messagize
from keri.peer import Exchanger

# Short-lag window 1 s + 5 s: a copy fetched later than that is outside it.
KRAM = dict(enabled=True, denials=[], caches={'~': [1000, 5000, 60000, 300000, 5000, 60000, 300000]})


def opened(args):
    hby = setupHby(name=args.name, base=args.base, bran=args.passcode, noPrompt=True, version=V2)
    return hby, Regery(hby, name=args.name, base=args.base)


def kram(args):
    hby = setupHby(name=args.name, base=args.base, bran=args.passcode, noPrompt=True, version=V2)
    try:
        config = hby.cf.get()
        config['kram'] = dict(KRAM, caches={'~': json.loads(args.caches)}) if args.caches else KRAM
        hby.cf.put(config)
        return dict(kram=hby.cf.get()['kram'])
    finally:
        hby.close()


def author(args):
    hby, rgy = opened(args)
    try:
        hab = hby.habByName(args.alias)
        registry = Registrar(rgy).makeRegistry('existing', hab.pre)

        def seal(event):
            hab.interact(data=[dict(i=registry.regk, s=event.sad['n'], d=event.said)], gvrsn=V2)
            receipts = Receiptor(hby=hby)

            def collect(tymth, tock=0.03125, **kwa):
                yield tock
                yield from receipts.receipt(hab.pre, sn=hab.kever.sn)
                owner.remove([receipts])
            owner = doing.DoDoer(doers=[receipts, doing.doify(collect)])
            doing.Doist(real=True, tock=0.03125, limit=20).do(doers=[owner])
            assert owner.done and registry.anchorMsg(event.said)

        seal(rgy.store.event(registry.regk))
        root = Salter()
        hab.mgr.putRegistryRoot(hab.pre, registry.regk, root)
        body = acdcmap(israid=hab.pre, iseaid=args.recipient, regid=registry.regk,
                       attribute=dict(d='', role='reader'))
        _, event = Registrar(rgy).issue(registry, body, salt=root.qb64)
        seal(event)
        tel = [bytes(raw).decode() for raw in rgy.store.cloneTelIter(registry.regk)]
        Path(args.tel).write_text(json.dumps(tel))
        return dict(pre=hab.pre, registry=registry.regk, acdc=body.said, event=event.said, root=root.qb64)
    finally:
        rgy.close()
        hby.close()


def accept(args):
    hby, rgy = opened(args)
    try:
        kvy = Kevery(db=hby.db, rvy=hby.rvy, lax=True, local=False)
        psr = Parser(version=V2, kvy=kvy, rvy=hby.rvy, rgy=rgy)
        if args.kel:
            psr.parse(ims=bytearray(Path(args.kel).read_bytes()), framed=False)
            kvy.processEscrows()
        for raw in json.loads(Path(args.tel).read_text()):
            node = SerderACDC(raw=raw.encode())
            sn, said = regeventing.vetAnchor(node, db=hby.db, issuer=args.issuer)
            psr.parse(ims=bytearray(messagize(node, bonds=[SealSource(s=f'{sn:x}', d=said)], gvrsn=V2)),
                      framed=False)
        rgy.processEscrows()
        head = rgy.store.headEvent(args.registry)
        return dict(head=head.said if head else None)
    finally:
        rgy.close()
        hby.close()


def root(args):
    hby = setupHby(name=args.name, base=args.base, bran=args.passcode, noPrompt=True, version=V2)
    try:
        held = hby.mgr.getRegistryRoot(args.gid, args.registry)
        return dict(root=held.qb64 if held else None)
    finally:
        hby.close()


def seal(event):
    return dict(i=event.sad['rd'] if event.ilk == 'bup' else event.said, s=event.sad['n'], d=event.said)


def group_registry(args):
    hby, rgy = opened(args)
    try:
        ghab = hby.habByName(args.alias)
        registry = Registrar(rgy).makeRegistry('group', ghab.pre)
        return dict(registry=registry.regk, seal=seal(rgy.store.event(registry.regk)))
    finally:
        rgy.close()
        hby.close()


def group_issue(args):
    hby, rgy = opened(args)
    try:
        ghab = hby.habByName(args.alias)
        registry = rgy.regs[args.registry]
        registry.anchorMsg(args.registry)
        rgy.processEscrows()
        assert rgy.store.headEvent(args.registry).said == args.registry
        root = Salter()
        ghab.mgr.putRegistryRoot(ghab.pre, args.registry, root)
        body = acdcmap(israid=ghab.pre, iseaid=args.recipient, regid=args.registry,
                       attribute=dict(d='', role='group reader'))
        _, event = Registrar(rgy).issue(registry, body, salt=root.qb64)
        return dict(acdc=body.said, event=event.said, seal=seal(event))
    finally:
        rgy.close()
        hby.close()


def group_publish(args):
    hby, rgy = opened(args)
    try:
        ghab = hby.habByName(args.alias)
        registry = rgy.regs[args.registry]
        registry.anchorMsg(args.event)
        rgy.processEscrows()
        assert rgy.store.headEvent(args.registry).said == args.event
        root = ghab.mgr.getRegistryRoot(ghab.pre, args.registry)
        blinder = Blinder.blind(salt=root.qb64, sn=1, acdc=args.acdc, state='issued')
        rgy.store.putOpening(args.event, blinder)
        tel = [bytes(raw).decode() for raw in rgy.store.cloneTelIter(args.registry)]
        Path(args.tel).write_text(json.dumps(tel))
        return dict(gid=ghab.pre, registry=args.registry, event=args.event, root=root.qb64)
    finally:
        rgy.close()
        hby.close()


class _Replication(doing.DoDoer):
    """Host one ``rootreplicating.replicate`` call as a finite command DoDoer would."""

    def __init__(self, hby, ghab, root, registry):
        self.hby, self.ghab, self.root, self.registry = hby, ghab, root, registry
        super().__init__(doers=[doing.doify(self.run)])

    def run(self, tymth, tock=0.03125, **kwa):
        self.wind(tymth)
        self.tock = tock
        yield tock
        yield from rootreplicating.replicate(self, self.ghab, self.root, [self.registry], timeout=45)


def replicate(args):
    hby, rgy = opened(args)
    try:
        ghab = hby.habByName(args.alias)
        exc = Exchanger(hby=hby, handlers=[])
        root = salting.loadHandlers(hby, exc, Notifier(hby), rgy)
        host = _Replication(hby, ghab, root, args.registry)
        doing.Doist(real=True, tock=0.03125, limit=60).do(doers=[host])
        return dict(done=host.done)
    finally:
        rgy.close()
        hby.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['kram', 'author', 'accept', 'root', 'group-registry', 'group-issue',
                                            'group-publish', 'replicate'])
    parser.add_argument('--name', required=True)
    parser.add_argument('--base', default='')
    parser.add_argument('--passcode', required=True)
    parser.add_argument('--alias')
    parser.add_argument('--recipient')
    parser.add_argument('--issuer')
    parser.add_argument('--registry')
    parser.add_argument('--gid')
    parser.add_argument('--kel')
    parser.add_argument('--tel')
    parser.add_argument('--acdc')
    parser.add_argument('--event')
    parser.add_argument('--caches')
    args = parser.parse_args()
    commands = {'kram': kram, 'author': author, 'accept': accept, 'root': root, 'group-registry': group_registry,
                'group-issue': group_issue, 'group-publish': group_publish, 'replicate': replicate}
    print(json.dumps(commands[args.command](args)), flush=True)


if __name__ == '__main__':
    main()
