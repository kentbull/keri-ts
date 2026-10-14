"""Frozen Python fixed-field records and attachment roles in both CESR domains.

Generate literals without TS, or decode independently emitted TS records/groups.
Run with the frozen checkout on PYTHONPATH; no database or service is opened.
"""
import json
import pathlib
import subprocess
import sys

from keri.core import coring, counting, parsing, structing
from keri.kering import Colds, MaterialError, ValidationError, Vrsn_1_0, Vrsn_2_0

# The semantic baseline is independent of older runtime interop pins.
REFERENCE = "7143832813cac6a394ab1faf9be83bb3372be87c"


def verify_source():
    """Reject moving or locally modified reference modules before producing evidence."""
    root = pathlib.Path(coring.__file__).resolve().parents[3]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    for module in [coring, counting, parsing, structing]:
        path = pathlib.Path(module.__file__).resolve()
        frozen = subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"])
        assert frozen == path.read_bytes()
    print(f"reference={REFERENCE} python={sys.version.split()[0]} root={root}", file=sys.stderr)


def encoded(value):
    """Keep literal binary expectations independent of TS base64 conversion."""
    return {"qb64": value.qb64, "qb2": value.qb2.hex()}


def record(clan, parts, inputs):
    """Record primitive roles, semantic inputs, crew projection and tuple bytes."""
    value = structing.Structor(data=clan(*parts))
    return {"clan": clan.__name__, "inputs": inputs, "sad": value.crew._asdict(),
            "parts": [encoded(part) for part in parts], **encoded(value)}


def generate():
    """Cover every nonce role and compact/fixed first-seen ordinals with real datetimes."""
    verser = coring.Verser(proto="KERI", pvrsn=Vrsn_2_0, gvrsn=Vrsn_2_0)
    records = []
    for code, size in [("1AAP", 0), ("0A", 16), ("a", 32), ("E", 32)]:
        nonce = coring.Noncer(code=code, raw=bytes(range(size)))
        records.append(record(structing.SealKind, [verser, nonce], {"code": code, "raw": nonce.raw.hex()}))
    for num, code, dts in [(0, "M", "2026-10-13T01:02:03.000004+00:00"),
                            (65536, "0H", "2026-10-13T01:02:03.123456-06:00"),
                            (2**64 + 1, "0A", "2026-10-13T23:59:59.999999+05:30")]:
        number, dater = coring.Number(num=num, code=code), coring.Dater(dts=dts)
        records.append(record(structing.FirstSeen, [number, dater], {"code": code, "numh": number.numh, "dts": dts}))
    groups = []
    for clan, version, code in [("SealKind", Vrsn_2_0, "-W"), ("SealKind", Vrsn_2_0, "--W"),
                                ("FirstSeen", Vrsn_1_0, "-E"), ("FirstSeen", Vrsn_2_0, "-O"),
                                ("FirstSeen", Vrsn_2_0, "--O")]:
        rows = [row for row in records if row["clan"] == clan]
        payload = "".join(row["qb64"] for row in rows)
        # V1 counts tuples; v2 counts four-character payload units, not headers.
        count = len(rows) if version.major == 1 else len(payload) // 4
        ctr = counting.Counter(code=code, count=count, version=version)
        groups.append({"clan": clan, "version": version.major, "code": code, "count": count,
                       "qb64": ctr.qb64 + payload,
                       "qb2": (ctr.qb2 + b"".join(bytes.fromhex(row["qb2"]) for row in rows)).hex()})
    # Valid primitives in the wrong field roles must fail in both readers.
    wrong = coring.Matter(code="D", raw=bytes(32))
    rejections = [
        {"clan": "SealKind", "parts": [encoded(verser), encoded(wrong)]},
        {"clan": "SealKind", "parts": [encoded(wrong), encoded(coring.Noncer(nonce=""))]},
        {"clan": "FirstSeen", "parts": [encoded(wrong), encoded(coring.Dater(dts="2026-10-13T01:02:03.000004+00:00"))]},
        {"clan": "FirstSeen", "parts": [encoded(coring.Number(num=0)), encoded(wrong)]},
    ]
    data = {"reference": REFERENCE, "records": records, "groups": groups, "rejections": rejections}
    verify_ts(data)
    return data


def verify_ts(data):
    """Read records and actual parser attachment methods, preserving exact tail extent."""
    count = 0
    for row in data["records"]:
        clan = getattr(structing, row["clan"])
        for domain in ["qb64", "qb2"]:
            arg = "qb64b" if domain == "qb64" else "qb2"
            wire = row[domain].encode() if domain == "qb64" else bytes.fromhex(row[domain])
            stream = bytearray(wire + b"TAIL")
            value = structing.Structor(clan=clan, **{arg: stream}, strip=True)
            assert value.crew._asdict() == row["sad"]
            assert encoded(value) == {key: row[key] for key in ["qb64", "qb2"]}
            assert stream == b"TAIL"
            count += 1
    for row in data["groups"]:
        for domain in ["qb64", "qb2"]:
            arg, cold = ("qb64b", Colds.txt) if domain == "qb64" else ("qb2", Colds.bny)
            wire = row[domain].encode() if domain == "qb64" else bytes.fromhex(row[domain])
            stream = bytearray(wire + b"TAIL")
            ctr = counting.Counter(**{arg: stream}, strip=True, version=Vrsn_1_0 if row["version"] == 1 else Vrsn_2_0)
            assert (ctr.code, ctr.count) == (row["code"], row["count"])
            parser, exts = parsing.Parser(), parsing.MsgParseDom()
            method = parser.Methods[row["version"]][0][ctr.name]
            list(getattr(parser, method)(exts, stream, ctr, cold, True))
            tuples = exts.tdcs if row["clan"] == "SealKind" else exts.frcs
            actual = [structing.Structor(data=getattr(structing, row["clan"])(*parts)).crew._asdict() for parts in tuples]
            assert actual == [r["sad"] for r in data["records"] if r["clan"] == row["clan"]]
            assert stream == b"TAIL"
            count += 1
    for row in data["rejections"]:
        for domain in ["qb64", "qb2"]:
            arg = "qb64b" if domain == "qb64" else "qb2"
            wire = b"".join(p[domain].encode() if domain == "qb64" else bytes.fromhex(p[domain]) for p in row["parts"])
            try:
                structing.Structor(clan=getattr(structing, row["clan"]), **{arg: wire})
            except (MaterialError, ValidationError, ValueError, TypeError):
                pass
            else:
                raise AssertionError(f"Wrong role accepted: {row['clan']} {domain}")
            count += 1
    print(f"Verified {count} record/group/role checks with frozen Python in qb64/qb2.", file=sys.stderr)


if __name__ == "__main__":
    verify_source()
    if len(sys.argv) == 1:
        print(json.dumps(generate(), indent=2))
    else:
        verify_ts(json.loads(pathlib.Path(sys.argv[1]).read_text()))
