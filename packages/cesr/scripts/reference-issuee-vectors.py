"""Generate checked ACDC issuee projections from frozen KERIpy without a database."""
import json
import pathlib
import subprocess
import sys

from keri import kering
from keri.core import coring, mapping, serdering

# Behavioral fixture pin, independent of the runtime interop harness.
REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"


def generate():
    """Qualify disclosed, compacted, and recipient-free sections across wire formats."""
    root = pathlib.Path(coring.__file__).resolve().parents[3]
    for module in [kering, coring, mapping, serdering]:
        path = pathlib.Path(module.__file__).resolve()
        assert path.read_bytes() == subprocess.check_output(
            ["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"])
    issuer = coring.Prefixer(code="D", raw=bytes(32)).qb64
    issuee = coring.Prefixer(code="D", raw=bytes([1]) * 32).qb64
    schema = coring.Diger(code="E", raw=bytes(32)).qb64
    rows = []
    for version in [kering.Vrsn_1_0, kering.Vrsn_2_0]:
        kinds = [kering.Kinds.json] if version.major == 1 else list(kering.Kinds)
        for kind in kinds:
            forms = ["attribute", "aggregate"] if version.major == 2 else ["attribute"]
            for form in forms:
                for state in (["disclosed", "absent"] if version.major == 1
                              else ["disclosed", "compact", "absent"]):
                    section = {"d": "", **({"i": issuee} if state != "absent" else {})}
                    if form == "aggregate":
                        # The first element commits the list; the second discloses its first member.
                        section = mapping.Aggor(ael=["", section], makify=True, kind=kind).ael
                    sad = {"i": issuer, "s": schema, "A" if form == "aggregate" else "a": section}
                    value = serdering.SerderACDC(sad=sad, makify=True, pvrsn=version,
                                                kind=kind, compactify=state == "compact")
                    checked = serdering.SerderACDC(raw=value.raw)
                    expected = issuee if state == "disclosed" else None
                    assert checked.iseaid == expected, (version, kind, form, state)
                    rows.append({"name": f"{version.major}-{kind}-{form}-{state}",
                                 "raw": value.raw.hex(), "issuee": checked.iseaid})
    print(f"Verified {len(rows)} ACDC issuee fixtures at {REFERENCE}", file=sys.stderr)
    return {"reference": REFERENCE, "rows": rows}


if __name__ == "__main__":
    print(json.dumps(generate(), indent=2))
