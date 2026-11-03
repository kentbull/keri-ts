"""Generate public XIP/EXN transaction vectors from the selected v2-spec source.

Run with the pinned checkout on PYTHONPATH. Fixed seeds are test data; only
public KELs, bodies and signatures are exported. No live identity state is read.
"""
import base64
import hashlib
import json
import subprocess
from pathlib import Path

from keri import kering
from keri.core import coring, eventing, serdering, signing
from keri.peer import exchanging

REFERENCE = "99a11d2a30beb0e23d294a9be58c7c3ccf7ef078"
STAMP = "2026-11-03T00:00:00.000123+00:00"


def provenance():
    """Require the imported implementation bytes to match the declared commit."""
    root = Path(eventing.__file__).resolve().parents[3]
    result = {}
    for module in (coring, eventing, serdering, signing, exchanging):
        path = Path(module.__file__).resolve()
        rel = str(path.relative_to(root))
        expected = subprocess.check_output([
            "git", "-c", f"safe.directory={root}", "-C", str(root),
            "show", f"{REFERENCE}:{rel}",
        ])
        assert path.read_bytes() == expected, rel
        result[rel] = hashlib.sha256(expected).hexdigest()
    return result


def qualified(raw):
    """Keep binary codec bodies byte-exact in portable JSON fixtures."""
    return base64.b64encode(raw).decode("ascii")


def vectors():
    """Build exact opener/continuation bodies and independently signed public KELs."""
    parties = []
    keys = []
    for seeds in ((1, 2), (3, 4)):
        signers = [signing.Signer(raw=bytes([seed]) * 32) for seed in seeds]
        icp = eventing.incept(keys=[signer.verfer.qb64 for signer in signers],
                             isith="2", code=coring.MtrDex.Blake3_256,
                             version=kering.Vrsn_2_0, kind=kering.Kinds.json)
        wire = eventing.messagize(icp, sigers=[
            signer.sign(icp.raw, index=index) for index, signer in enumerate(signers)
        ], gvrsn=kering.Vrsn_2_0)
        parties.append(dict(pre=icp.pre, said=icp.said, kel=qualified(wire)))
        keys.append(signers)
    nonce = coring.Noncer(raw=b"0123456789abcdef").qb64
    cases = []
    for kind in (kering.Kinds.json, kering.Kinds.cbor, kering.Kinds.mgpk, kering.Kinds.cesr):
        opener = eventing.exchept(sender=parties[0]["pre"], receiver=parties[1]["pre"],
                                 route="/transaction", nonce=nonce, stamp=STAMP,
                                 attributes=dict(m="open"), kind=kind)
        reply = eventing.exchange(sender=parties[1]["pre"], receiver=parties[0]["pre"],
                                  xid=opener.said, prior=opener.said,
                                  route="/transaction", stamp=STAMP,
                                  attributes=dict(m="continue"), kind=kind)
        rows = []
        for body, signers in ((opener, keys[0]), (reply, keys[1])):
            rows.append(dict(raw=qualified(body.raw), said=body.said,
                             signatures=[signer.sign(body.raw, index=index).qb64
                                         for index, signer in enumerate(signers)]))
        cases.append(dict(kind=kind, opener=rows[0], continuation=rows[1]))
    return dict(reference=REFERENCE, modules=provenance(), stamp=STAMP, nonce=nonce,
                parties=parties, cases=cases)


if __name__ == "__main__":
    print(json.dumps(vectors(), indent=2))
