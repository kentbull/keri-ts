"""Operator-side store setup for the /registry/root mailbox interop case.

Each command opens one existing kli keystore the way an operator would and
leaves protocol delivery to the installed `kli vc registry root` commands:

- ``kram`` enables KRAM in the store's own config with a short window;
- ``author`` creates an existing issuer registry whose root this AID holds,
  witnesses its anchors and writes the public KEL/TEL for the holder;
- ``accept`` gives a holder a foreign issuer's public KEL and TEL;
- ``root`` prints the root retained for one holder AID and registry.

Adapted from KERIpy tests/cli/commands/test_registry_root_cli.py.
"""
import argparse
import json
from pathlib import Path

from hio.base import doing
from keri import Vrsn_2_0 as V2
from keri.acdc import Regery, Registrar, acdcmap, regeventing
from keri.app import Receiptor
from keri.cli.common import setupHby
from keri.core import Kevery, Parser, Salter, SealSource, SerderACDC, messagize

# Short-lag window 1 s + 5 s: a copy fetched later than that is outside it.
KRAM = dict(enabled=True, denials=[], caches={'~': [1000, 5000, 60000, 300000, 5000, 60000, 300000]})


def opened(args):
    hby = setupHby(name=args.name, base=args.base, bran=args.passcode, noPrompt=True, version=V2)
    return hby, Regery(hby, name=args.name, base=args.base)


def kram(args):
    hby = setupHby(name=args.name, base=args.base, bran=args.passcode, noPrompt=True, version=V2)
    try:
        config = hby.cf.get()
        config['kram'] = KRAM
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('command', choices=['kram', 'author', 'accept', 'root'])
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
    args = parser.parse_args()
    print(json.dumps(dict(kram=kram, author=author, accept=accept, root=root)[args.command](args)), flush=True)


if __name__ == '__main__':
    main()
