"""Generate signed issuance evidence with frozen KERIpy 927c0cb8.

KERI anchors use protocol v1/v2. TEL and ACDC bodies use v1: this reference
rejects v2 vcp/iss, independently of the supported v2 attachment genus.
"""
import json
import subprocess
from pathlib import Path
from keri import kering
from keri.core import coring, counting, eventing, parsing, scheming, signing, structing
from keri.vc import proving
from keri.vdr import eventing as vdr


# Keep fixture provenance independent of installed wheels or moving main.
REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"


def verify_source():
    """Verify every imported protocol source against the immutable commit."""
    root = Path(eventing.__file__).resolve().parents[3]
    assert subprocess.check_output(
        ["git", "-C", str(root), "rev-parse", "HEAD"], text=True
    ).strip() == REFERENCE
    for module in (coring, counting, eventing, parsing, scheming, signing, structing, proving, vdr):
        path = Path(module.__file__).resolve()
        frozen = subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"])
        assert frozen == path.read_bytes(), path


def parsed(wire, version):
    """Consume one complete envelope with Python and require exact extent."""
    source = bytearray(wire)
    parser = parsing.Parser(version=version).msgParsator(ims=source, framed=True)
    try:
        next(parser)
        raise AssertionError("Complete fixture requested more input")
    except StopIteration as done:
        assert not source
        return done.value


def vectors():
    """Build independent KEL anchors, TEL events, and credential envelopes."""
    signer = signing.Signer(raw=bytes(range(32)))
    schema = scheming.Schemer(sed={
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "", "type": "object",
        "required": ["v", "d", "i", "s", "a"],
        "properties": {"a": {"type": "object", "required": ["role"]}},
    })
    results = []
    for version in (kering.Vrsn_1_0, kering.Vrsn_2_0):
        icp = eventing.incept(keys=[signer.verfer.qb64], pvrsn=version, kind="JSON")
        registry = vdr.incept(icp.aid, cnfg=["NB"], nonce=signing.Salter(raw=bytes(16)).qb64, version=kering.Vrsn_1_0)
        creder = proving.credential(schema.said, icp.aid,
                                    data={"dt": "2026-10-13T00:00:00.000000+00:00", "role": "holder"},
                                    status=registry.said, version=kering.Vrsn_1_0)
        issuance = vdr.issue(creder.said, registry.said, version=kering.Vrsn_1_0,
                             dt="2026-10-13T00:00:00.000000+00:00")
        prior = icp
        kel = [eventing.messagize(icp, sigers=[signer.sign(icp.raw, index=0)], gvrsn=version)]
        tels = []
        for sn, tel in enumerate((registry, issuance), 1):
            anchor = eventing.interact(icp.aid, prior.said, sn=sn,
                                      data=[dict(i=tel.sad["i"], s="0", d=tel.said)],
                                      pvrsn=version, kind="JSON")
            kel.append(eventing.messagize(anchor, sigers=[signer.sign(anchor.raw, index=0)], gvrsn=version))
            seal = structing.SealSource(coring.Number(num=sn), coring.Diger(qb64=anchor.said))
            wire = eventing.messagize(tel, bonds=[seal], gvrsn=version)
            assert parsed(wire, version).serder.said == tel.said
            tels.append(dict(pre=tel.sad["i"], said=tel.said, body=tel.raw.decode(), wire=wire.decode(),
                             number=seal.s.qb64, digest=seal.d.qb64))
            prior = anchor
        seal = structing.SealEvent(coring.Prefixer(qb64=icp.aid),
                                  coring.Number(num=2), coring.Diger(qb64=prior.said))
        credential = eventing.messagize(creder, bonds=[seal], gvrsn=version, framed=True)
        assert parsed(credential, version).serder.said == creder.said
        for wire in kel:
            event = parsed(wire, version)
            assert signer.verfer.verify(event.sigers[0].raw, event.serder.raw)
        results.append(dict(version=version.major, genus=counting.Counter.makeGVC(version=version).decode(), pre=icp.aid, registry=registry.said,
                            kel=b"".join(kel).decode(), tels=tels, credential=credential.decode(),
                            said=creder.said, body=creder.raw.decode(),
                            seal=dict(pre=seal.i.qb64, number=seal.s.qb64, digest=seal.d.qb64)))
    return dict(reference=REFERENCE, schema=schema.sed, vectors=results)


if __name__ == "__main__":
    verify_source()
    print(json.dumps(vectors(), indent=2))
