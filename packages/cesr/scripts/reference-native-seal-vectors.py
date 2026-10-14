"""Native event seal fixtures and reverse verification from frozen KERIpy.

Run with the frozen checkout on PYTHONPATH. With no argument emit independent
literals; with a JSON filename verify actual TS construction in both domains.
No databases are opened. Unknown map SADs are deliberately not admissible seals:
the reference writer silently drops them and may invalidate subsequent parsing.
"""
import base64
import json
import pathlib
import subprocess
import sys

from keri import kering
from keri.core import coring, counting, eventing, mapping, serdering, structing

# Pin behavioral evidence independently of the repository's runtime test harness.
REFERENCE = "7143832813cac6a394ab1faf9be83bb3372be87c"


def verify_source():
    """Check imported module bytes against immutable Git objects before any probe."""
    root = pathlib.Path(coring.__file__).resolve().parents[3]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    for module in [kering, coring, counting, eventing, mapping, serdering, structing]:
        path = pathlib.Path(module.__file__).resolve()
        frozen = subprocess.check_output(["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"])
        assert path.read_bytes() == frozen, str(path)
    print(f"reference={REFERENCE} python={sys.version.split()[0]} root={root}", file=sys.stderr)


def vector(name, event):
    """Record independent SAD and exact text/binary event bodies."""
    return {"name": name, "sad": event.sad, "qb64": event.raw.decode(),
            "qb2": base64.urlsafe_b64decode(event.raw).hex()}


def verify_ts(data):
    """Require Python to reconstruct TS-emitted events, numeric material, and thresholds."""
    checks = 0
    for row in data["events"]:
        for raw in [row["qb64"].encode(), bytes.fromhex(row["qb2"])]:
            event = serdering.SerderKERI(raw=raw)
            assert event.sad == row["sad"], row["name"]
            assert event.raw.decode() == row["qb64"], row["name"]
            checks += 1
    for row in data["jsonEvents"]:
        assert serdering.SerderKERI(raw=row["raw"].encode()).sad == row["sad"]
        checks += 1
    for row in data["numbers"]:
        for name, raw in [("qb64", row["qb64"]), ("qb2", bytes.fromhex(row["qb2"]))]:
            number = coring.Number(**{name: raw})
            assert number.numh == row["numh"]
            assert number.qb64 == coring.Number(numh=row["numh"]).qb64
            checks += 1
        assert coring.Tholder(sith=row["numh"]).limen.decode() == row["limen"]
        checks += 1
    print(f"Verified {checks} native/JSON events and numeric/threshold checks.", file=sys.stderr)


def generate():
    """Exercise seven admitted families, homogeneous runs, field context and roles."""
    key = coring.Prefixer(raw=bytes(32), code="D").qb64
    digest = coring.Diger(raw=bytes(32), code="E").qb64
    other = coring.Diger(raw=bytes(range(32)), code="E").qb64
    version = kering.Vrsn_2_0
    verser = coring.Verser(proto="KERI", pvrsn=version, gvrsn=version).qb64
    seals = [{"d": digest}, {"rd": other}, {"i": key, "s": "10000", "d": digest},
             {"s": "10000000000000001", "d": other}, {"i": key},
             {"bi": key, "d": digest}, {"t": verser, "d": "1AAP"}]

    def inception(data):
        """Use the actual event constructor for the reproduced native SAD gap."""
        return eventing.incept(keys=[key], version=version, kind=kering.Kinds.cesr, data=data)

    events = [vector(structing.Sealer(crew=seal).name, inception([seal])) for seal in seals]
    nonces = [coring.Noncer(raw=bytes(range(size)), code=code).qb64
              for code, size in [("1AAP", 0), ("0A", 16), ("a", 32), ("E", 32)]]
    events.append(vector("typed-nonce-run", inception([{"t": verser, "d": nonce} for nonce in nonces])))
    mixed = [seals[0], {"d": other}, *seals[1:], seals[0]]
    events.append(vector("ordered-family-runs", inception(mixed)))
    for ilk in ["ixn", "rot", "dip", "drt"]:
        sad = dict(serdering.SerderKERI.Fields["KERI"][version][ilk].alls)
        sad.update(i=key, p=digest, s="1", kt="1", k=[key], nt="0", n=[], bt="0", a=mixed)
        if ilk in ("dip", "drt"):
            sad["i"] = digest
            sad["di"] = other
        # Field normalization drops only fields absent from this event schema.
        sad = {label: sad[label] for label in serdering.SerderKERI.Fields["KERI"][version][ilk].alls}
        events.append(vector(ilk, serdering.SerderKERI(sad=sad, makify=True, pvrsn=version,
                                                     kind=kering.Kinds.cesr, ilk=ilk)))
    # Automatic Number selection skips fixed 0H/0A at both affected width ranges.
    for num in [2**16 - 1, 2**16, 2**32 - 1, 2**32,
                2**112 - 1, 2**112, 2**128 - 1, 2**128]:
        event = eventing.interact(pre=key, dig=digest, sn=num,
                                 data=[{"s": f"{num:x}", "d": other}],
                                 version=version, kind=kering.Kinds.cesr)
        events.append(vector(f"ordinal-{num:x}", event))
    # A seal-shaped dictionary is still a mapper when `a` is a map.
    events.append(vector("icp-mapper", serdering.SerderKERI(
        sad={**inception([]).sad, "a": {"d": digest}}, makify=True)))
    reply = eventing.reply(pre=key, route="seal", data={"d": digest}, stamp="2026-10-13T01:02:03.000004+00:00",
                          version=version, kind=kering.Kinds.cesr)
    events.append(vector("rpy-mapper", reply))
    json_events = []
    for pvrsn in [kering.Vrsn_1_0, version]:
        event = eventing.incept(keys=[key], version=pvrsn, kind=kering.Kinds.json, data=mixed)
        json_events.append({"name": f"json-{pvrsn.major}", "sad": event.sad, "raw": event.raw.decode()})

    def tail_wire(event, old_tail, new_tail):
        """Replace one terminal field and recalculate only framing for malformed fixtures."""
        assert event.raw.endswith(old_tail)
        payload = event.raw[4:-len(old_tail)] + new_tail
        return counting.Counter(code="-F", count=len(payload) // 4, version=version).qb64b + payload

    def list_wire(payload):
        """Build an independent malformed list using Python's counter length rules."""
        return counting.Counter(code="-J", count=len(payload) // 4, version=version).qb64b + payload

    base = inception([seals[-1]])
    original = b"-JAF-WAE" + verser.encode() + b"1AAP"
    digest_group = counting.Counter(code="-Q", count=11, version=version).qb64b + digest.encode()
    malformed = [
        ("nonce-not-native", list_wire(b"-NAB1AAP")),
        ("big-seal-not-native", list_wire(b"--WAAAAE" + verser.encode() + b"1AAP")),
        ("typed-wrong-digest-role", list_wire(b"-WAO" + verser.encode() + key.encode())),
        ("typed-wrong-version-role", list_wire(b"-WAM" + key.encode() + b"1AAP")),
        ("missing-tuple-member", list_wire(b"-WAD" + verser.encode())),
        ("group-exceeds-list", list_wire(b"-WAF" + verser.encode() + b"1AAP")),
        ("mixed-map-list", list_wire(digest_group + mapping.Mapper(mad={"note": "opaque"}).qb64b)),
    ]
    rejections = []
    for name, tail in malformed:
        raw = tail_wire(base, original, tail)
        # Only the length-overrun case needs verification in Python; its unchecked
        # reader slices short payloads. TS rejects the length at the field boundary.
        try:
            serdering.SerderKERI(raw=raw, verify=name == "group-exceeds-list")
        except Exception as error:
            rejections.append({"name": name, "qb64": raw.decode(),
                               "qb2": base64.urlsafe_b64decode(raw).hex(), "pythonError": type(error).__name__})
        else:
            raise AssertionError(f"Python admitted malformed native seal: {name}")
    map_tail = mapping.Mapper(mad={"d": digest}).qb64b
    raw = tail_wire(reply, map_tail, b"-JAA")
    try:
        serdering.SerderKERI(raw=raw, verify=False)
    except Exception as error:
        rejections.append({"name": "reply-list-not-admitted", "qb64": raw.decode(),
                           "qb2": base64.urlsafe_b64decode(raw).hex(), "pythonError": type(error).__name__})
    else:
        raise AssertionError("Python admitted a seal list in reply attributes")
    # Include all compact transitions and the two formerly preferred fixed widths.
    values = [0, 1] + [value for bits in [16, 32, 40, 64, 88, 112, 128]
                        for value in [2**bits - 1, 2**bits]] + [2**136 - 1]
    numbers = []
    for value in values:
        number = coring.Number(num=value)
        numbers.append({"numh": number.numh, "qb64": number.qb64, "qb2": number.qb2.hex(),
                        "limen": coring.Tholder(sith=value).limen.decode()})
    data = {"reference": REFERENCE, "events": events, "jsonEvents": json_events,
            "numbers": numbers, "rejections": rejections}
    verify_ts(data)
    return data


if __name__ == "__main__":
    verify_source()
    if len(sys.argv) == 1:
        print(json.dumps(generate(), indent=2))
    else:
        verify_ts(json.loads(pathlib.Path(sys.argv[1]).read_text()))
