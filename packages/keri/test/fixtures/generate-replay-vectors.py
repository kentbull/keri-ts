"""Generate and parse independent replay vectors with KERIpy 927c0cb8.

Run with the frozen checkout on PYTHONPATH. Each signed body includes either
source-seal or grouped-receipt evidence, followed by a first-seen record.
"""
import json
import subprocess
from pathlib import Path

import keri
from keri import kering
from keri.core import coring, eventing, parsing, signing, structing

# Pin the implementation, including its exact counter and Number semantics.
REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"


def vectors():
    """Produce and verify replay envelopes for JSON v1/v2 and native v2."""
    root = Path(keri.__file__).resolve().parents[2]
    revision = subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip()
    assert revision == REFERENCE
    signer = signing.Signer(raw=bytes(range(32)))
    recipients = [signing.Signer(raw=bytes([value]) * 32) for value in (1, 2)]
    receipt = eventing.incept(keys=[item.verfer.qb64 for item in recipients])
    prefixer = coring.Prefixer(qb64=receipt.aid)
    number = coring.Number(num=0)
    diger = coring.Diger(qb64=receipt.said)
    dater = coring.Dater(dts="2026-03-16T12:34:56.000000+00:00")
    cases = [
        (kering.Vrsn_1_0, kering.Kinds.json),
        (kering.Vrsn_2_0, kering.Kinds.json),
        (kering.Vrsn_2_0, kering.Kinds.cesr),
    ]
    results = []
    for version, kind in cases:
        serder = eventing.incept(keys=[signer.verfer.qb64], pvrsn=version, kind=kind)
        siger = signer.sign(serder.raw, index=0)
        receipts = [item.sign(serder.raw, index=index)
                    for index, item in enumerate(recipients)]
        for evidence in ("source", "receipts"):
            # A small stored Number exposes v1 Seqner conversion versus v2 preservation.
            bonds = ([structing.SealSource(s=number, d=diger)]
                     if evidence == "source" else [])
            groups = ([structing.TransSigs(prefixer, number, diger, receipts)]
                      if evidence == "receipts" else [])
            # Fixed-width first-seen ordinals remain valid Numbers in both genera.
            bonds.append(structing.FirstSeen(
                f=coring.Number(num=0, code=coring.NumDex.Huge), dt=dater
            ))
            wire = eventing.messagize(
                serder, sigers=[siger], tsgs=groups, bonds=bonds,
                gvrsn=version, framed=False
            )
            source = bytearray(wire)
            parser = parsing.Parser(version=version).msgParsator(ims=source, framed=True)
            try:
                next(parser)
                raise AssertionError("Complete replay unexpectedly requested more input")
            except StopIteration as done:
                parsed = done.value
            assert not source and parsed.serder.said == serder.said
            assert parsed.sigers[0].qb64 == siger.qb64
            assert parsed.frcs[0][0].num == 0
            assert signer.verfer.verify(parsed.sigers[0].raw, parsed.serder.raw)
            if evidence == "receipts":
                assert len(parsed.tsgs) == 1
                assert len(parsed.tsgs[0][3]) == 2
                for item, signature in zip(recipients, parsed.tsgs[0][3]):
                    assert item.verfer.verify(signature.raw, parsed.serder.raw)
            else:
                assert len(parsed.sscs) == 1
                assert parsed.sscs[0][1].qb64 == diger.qb64
            results.append(dict(
                version=version.major, kind=kind, evidence=evidence,
                pre=serder.aid, said=serder.said, body=serder.raw.decode(),
                signature=siger.qb64, datetime=dater.qb64, replay=wire.decode(),
                seal=dict(pre=prefixer.qb64, number=number.qb64, digest=diger.qb64),
                receipts=[item.qb64 for item in receipts]
            ))
    return dict(reference=REFERENCE, vectors=results)


if __name__ == "__main__":
    print(json.dumps(vectors(), indent=2))
