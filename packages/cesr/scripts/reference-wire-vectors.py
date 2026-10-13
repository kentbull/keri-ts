"""Generate Python wire evidence or verify independently emitted TS vectors.

Run with PYTHONPATH pointing at the frozen checkout. No databases or runtime
services are opened. Big seal groups use Counter plus Sealer tuple extraction:
the reference Sealer.extract helper lacks big-name dispatch entries.
"""
import dataclasses
import json
import pathlib
import subprocess
import sys

from keri.core import coring, counting, eventing, parsing, serdering, structing
from keri.kering import Vrsn_1_0, Vrsn_2_0

# Refuse a moving reference or accidentally imported installed package.
REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"


def verify_source():
    """Require all imported modules to be unmodified files at the frozen SHA."""
    root = pathlib.Path(coring.__file__).resolve().parents[3]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    modules = [coring, counting, eventing, parsing, serdering, structing]
    for module in modules:
        path = pathlib.Path(module.__file__).resolve()
        relative = str(path.relative_to(root))
        frozen = subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{relative}"])
        assert frozen == path.read_bytes(), relative
    print(f"reference={REFERENCE} python={sys.version.split()[0]} modules={root}/src/keri/core", file=sys.stderr)


def encoded(value):
    """Capture both wire domains without deriving binary expectations in TS."""
    return {"qb64": value.qb64, "qb2": value.qb2.hex()}


def generate():
    """Generate table sentinels and changed wire families from Python constructors."""
    gram = coring.Matter(code=coring.MtrDex.GramHead, soft="ABC", raw=bytes([1, 2, 3]))
    nonces = [coring.Noncer(nonce=""), coring.Noncer(raw=bytes(range(16)), code="0A"),
              coring.Noncer(raw=bytes(range(32)), code="a"), coring.Noncer(raw=bytes(range(32)), code="E")]
    seals = [structing.Sealer(data=structing.SealNonce(nd=nonce)) for nonce in nonces]
    payload = b"".join(seal.qb64b for seal in seals)
    groups = []
    for code in ["-N", "--N"]:
        ctr = counting.Counter(code=code, count=len(payload) // 4, version=Vrsn_2_0)
        groups.append({"code": code, "count": ctr.count, "qb64": (ctr.qb64b + payload).decode(),
                       "qb2": (ctr.qb2 + b"".join(seal.qb2 for seal in seals)).hex()})
    counters = []
    for code in ["-N", "--N", "-G", "--G", "-J", "--J"]:
        for count in [0, 1, 4095, 4096]:
            ctr = counting.Counter(code=code, count=count, version=Vrsn_2_0)
            counters.append({"requestedCode": code, "code": ctr.code, "count": count,
                             "name": ctr.name, "fullSize": len(ctr.qb64), **encoded(ctr)})
    # Preserve the actual native-event gap rather than treating codex membership
    # as permission to emit a nonce seal in every syntactic context.
    try:
        eventing.incept(keys=["DA" + "A" * 42], data=[{"nd": "1AAP"}], version=Vrsn_2_0)
    except KeyError as error:
        assert error.args == ("SealNonce",)
    else:
        raise AssertionError("Native nonce admission changed; review the reference boundary")
    assert parsing.Parser.Methods[2][0][counting.Codens.NonceSealSingles] is None
    return {
        "reference": REFERENCE,
        "gramHead": {"code": gram.code, "soft": gram.soft, "raw": gram.raw.hex(),
                     "fullSize": len(gram.qb64), "fullSizeB2": len(gram.qb2), **encoded(gram)},
        "nonces": [{"code": n.code, "raw": n.raw.hex(), "sad": {"nd": n.qb64}, **encoded(n)} for n in nonces],
        "groups": groups,
        "counters": counters,
        "counterTables": {
            str(v.major): {"names": {code: name for name, code in dataclasses.asdict(counting.Counter.Codes[v.major][0]).items()},
                           "sizes": {code: dict(size._asdict()) for code, size in counting.Counter.Sizes[v.major][0].items()}}
            for v in [Vrsn_1_0, Vrsn_2_0]
        },
        "boundaries": {"nativeNonceSeal": "unsupported", "attachmentNonceSeal": "unsupported"},
    }


def verify_ts(data):
    """Decode TS-produced bytes with Python and assert semantics and exact extents."""
    gram = data["gramHead"]
    for key in ["qb64", "qb2"]:
        wire = gram[key].encode() if key == "qb64" else bytes.fromhex(gram[key])
        stream = bytearray(wire + b"TAIL")
        parsed = coring.Matter(**{"qb64b" if key == "qb64" else "qb2": stream}, strip=True)
        assert (parsed.code, parsed.soft, parsed.raw.hex()) == ("b", "ABC", "010203")
        assert stream == b"TAIL"
    for group in data["groups"]:
        for key in ["qb64", "qb2"]:
            wire = group[key].encode() if key == "qb64" else bytes.fromhex(group[key])
            stream = bytearray(wire + b"TAIL")
            arg = "qb64b" if key == "qb64" else "qb2"
            ctr = counting.Counter(**{arg: stream}, strip=True, version=Vrsn_2_0)
            assert ctr.name in ("NonceSealSingles", "BigNonceSealSingles")
            size = ctr.count * (4 if key == "qb64" else 3)
            payload = bytearray(stream[:size])
            assert stream[size:] == b"TAIL"
            seals = []
            while payload:
                seals.append(structing.Sealer(clan=structing.SealNonce, **{arg: payload}, strip=True).crew._asdict())
            assert seals == [row["sad"] for row in data["nonces"]]
            if group["code"] == "-N":
                extracted = structing.Sealer.extract(**{arg: bytearray(wire)})
                assert [seal.crew._asdict() for seal in extracted] == seals
    for row in data["counters"]:
        for key in ["qb64", "qb2"]:
            wire = row[key].encode() if key == "qb64" else bytes.fromhex(row[key])
            stream = bytearray(wire + b"TAIL")
            ctr = counting.Counter(**{"qb64b" if key == "qb64" else "qb2": stream}, strip=True, version=Vrsn_2_0)
            assert (ctr.code, ctr.count, ctr.name) == (row["code"], row["count"], row["name"])
            assert stream == b"TAIL"
    print("TS -> Python: GramHead, small/big nonce groups, counter widths/counts and consumed extents verified")


if __name__ == "__main__":
    verify_source()
    if len(sys.argv) == 1:
        print(json.dumps(generate(), indent=2) + "\n", end="")
    else:
        verify_ts(json.loads(pathlib.Path(sys.argv[1]).read_text()))
