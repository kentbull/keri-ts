"""Generate ACDC section-SAID vectors from the pinned KERIpy without a database.

KERIpy leaves an attribute, edge or rule section without a top-level `d`
expanded: it never inserts one, hashes the top-level SAID over the expanded
section and still saidifies nested maps that carry their own `d`. Sections that
do carry `d` are saidified and compacted. These rows cover both forms for every
v2 serialization kind, plus v1 bodies, whose sections are never processed.

Run with the pinned repository installed in a container-owned virtualenv:

    python packages/cesr/scripts/reference-section-said-vectors.py \
        > packages/cesr/test/fixtures/section-said-vectors.json
"""
import copy
import hashlib
import json
import pathlib
import subprocess
import sys

from keri import Kinds, Vrsn_1_0, Vrsn_2_0
from keri.core import coring, serdering
from keri.acdc import acdcmap

REFERENCE = "c5841f30d0d830bad62e0ab91e66d98a0afac20c"
root = pathlib.Path(serdering.__file__).resolve().parents[3]


def verify_source():
    """Bind every imported KERIpy module to the exact reference bytes."""
    modules = {}
    for name, module in list(sys.modules.items()):
        if (name == "keri" or name.startswith("keri.")) and getattr(module, "__file__", None):
            path = pathlib.Path(module.__file__).resolve()
            if path.suffix == ".py":
                raw = path.read_bytes()
                ref = subprocess.check_output(
                    ["git", "-c", f"safe.directory={root}", "-C", str(root),
                     "show", f"{REFERENCE}:{path.relative_to(root)}"])
                assert raw == ref, str(path)
                modules[str(path.relative_to(root))] = hashlib.sha256(raw).hexdigest()
    return dict(sorted(modules.items()))


issuer = coring.Prefixer(code="D", raw=bytes(32)).qb64
issuee = coring.Prefixer(code="D", raw=bytes([1]) * 32).qb64
schema = coring.Diger(code="E", raw=bytes([2]) * 32).qb64
chained = coring.Diger(code="E", raw=bytes([3]) * 32).qb64

# Each v2 case names the sections handed to acdcmap. Values are templates; every
# use takes a deep copy because KERIpy saidifies section maps in place.
V2_CASES = {
    # `kli vc create --data` with data lacking `d`.
    "a-no-d": dict(attribute=dict(i=issuee, name="Ada", score=7)),
    "a-no-d-nested-d": dict(attribute=dict(
        i=issuee, name="Ada", address=dict(d="", street="1 Main", city="Provo"))),
    "a-no-d-nested-no-d": dict(attribute=dict(
        i=issuee, name="Ada", address=dict(street="1 Main", city="Provo"))),
    "e-no-d": dict(attribute=dict(d="", i=issuee),
                   edge=dict(qvi=dict(n=chained, s=schema))),
    "e-no-d-nested-d": dict(attribute=dict(d="", i=issuee),
                            edge=dict(qvi=dict(d="", n=chained, s=schema))),
    "r-no-d": dict(attribute=dict(d="", i=issuee),
                   rule=dict(usage=dict(l="Use only for testing."))),
    "r-no-d-nested-d": dict(attribute=dict(d="", i=issuee),
                            rule=dict(usage=dict(d="", l="Use only for testing."))),
    "all-no-d": dict(attribute=dict(i=issuee, name="Ada"),
                     edge=dict(qvi=dict(n=chained, s=schema)),
                     rule=dict(usage=dict(l="Use only for testing."))),
    # Forms that already carry a top-level `d`.
    "a-d": dict(attribute=dict(d="", i=issuee, name="Ada")),
    "a-d-nested-no-d": dict(attribute=dict(
        d="", i=issuee, name="Ada", address=dict(street="1 Main", city="Provo"))),
    "a-d-nested-d": dict(attribute=dict(
        d="", i=issuee, name="Ada", address=dict(d="", street="1 Main", city="Provo"))),
    "e-d": dict(attribute=dict(d="", i=issuee),
                edge=dict(d="", qvi=dict(n=chained, s=schema))),
    "r-d": dict(attribute=dict(d="", i=issuee),
                rule=dict(d="", usage=dict(l="Use only for testing."))),
}

V1_CASES = {
    "v1-a-no-d": dict(i=issuee, name="Ada"),
    "v1-a-d": dict(d="", i=issuee, name="Ada"),
}


def v2_rows():
    """Author each case through acdcmap and replay its constructor input."""
    rows = []
    for kind in [Kinds.json, Kinds.cbor, Kinds.mgpk, Kinds.cesr]:
        for case, sections in V2_CASES.items():
            for compactify in (False, True):
                built = acdcmap(israid=issuer, schema=schema, kind=kind,
                                compactify=compactify, **copy.deepcopy(sections))
                # The same constructor input acdcmap assembles, kept for keri-ts.
                sad = dict(v=coring.versify(proto="ACDC", pvrsn=Vrsn_2_0, kind=kind,
                                            size=0, gvrsn=Vrsn_2_0),
                           t="acm", d="", i=issuer, s=schema)
                for label, field in (("a", "attribute"), ("e", "edge"), ("r", "rule")):
                    if field in sections:
                        sad[label] = copy.deepcopy(sections[field])
                replay = serdering.SerderACDC(sad=copy.deepcopy(sad), makify=True,
                                              compactify=compactify)
                assert replay.raw == built.raw, (kind, case, compactify)
                checked = serdering.SerderACDC(raw=bytearray(built.raw))
                assert checked.said == built.said
                for label in ("a", "e", "r"):
                    if label in sad and "d" not in sections[dict(a="attribute",
                                                                 e="edge", r="rule")[label]]:
                        # KERIpy never inserts a missing section `d`.
                        assert "d" not in checked.sad[label], (kind, case, label)
                rows.append(dict(name=f"2-{kind}-{case}{'-compact' if compactify else ''}",
                                 version=2, kind=kind, case=case, compactify=compactify,
                                 sad=sad, said=built.said, raw=bytes(built.raw).hex()))
    return rows


def v1_rows():
    """v1 sections are opaque to SerderACDC; authors saidify attributes themselves."""
    rows = []
    for kind in [Kinds.json, Kinds.cbor, Kinds.mgpk]:
        for case, attribute in V1_CASES.items():
            attribute = copy.deepcopy(attribute)
            if "d" in attribute:
                _, attribute = coring.Saider.saidify(sad=attribute, kind=kind, label="d")
            sad = dict(v=coring.versify(proto="ACDC", pvrsn=Vrsn_1_0, kind=kind, size=0),
                       d="", i=issuer, s=schema, a=attribute)
            built = serdering.SerderACDC(sad=copy.deepcopy(sad), makify=True)
            checked = serdering.SerderACDC(raw=bytearray(built.raw))
            assert checked.said == built.said
            assert checked.sad["a"] == attribute, (kind, case)
            rows.append(dict(name=f"1-{kind}-{case}", version=1, kind=kind, case=case,
                             compactify=False, sad=sad, said=built.said,
                             raw=bytes(built.raw).hex()))
    return rows


if __name__ == "__main__":
    modules = verify_source()
    rows = v2_rows() + v1_rows()
    print(f"Verified {len(rows)} ACDC section SAID vectors at {REFERENCE}", file=sys.stderr)
    print(json.dumps(dict(reference=REFERENCE, modules=modules, rows=rows), indent=2))
