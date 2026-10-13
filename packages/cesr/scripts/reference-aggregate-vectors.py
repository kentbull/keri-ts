"""Freeze aggregate framing and disclosure bytes from the pinned KERIpy source."""
import json
import pathlib
import subprocess

from keri import kering
from keri.core import coring, mapping

# Behavioral fixture pin, independent of the runtime interop harness.
REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"


def generate():
    """Check source provenance and emit real aggregate bodies for all four kinds."""
    root = pathlib.Path(coring.__file__).resolve().parents[3]
    for module in [kering, coring, mapping]:
        path = pathlib.Path(module.__file__).resolve()
        assert path.read_bytes() == subprocess.check_output(
            ["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"])
    issuee = coring.Prefixer(code="D", raw=bytes([1]) * 32).qb64
    seed = ["", {"d": "", "i": issuee, "role": "holder"}, {"d": "", "role": "observer"}]
    rows = []
    for kind in kering.Kinds:
        aggor = mapping.Aggor(ael=seed, kind=kind, makify=True)
        compact, _ = aggor.disclose()
        partial, _ = aggor.disclose([1])
        assert mapping.Aggor.verifyDisclosure(partial, kind=kind)
        assert mapping.Aggor(raw=aggor.raw, kind=kind).ael == aggor.ael
        rows.append({"kind": kind, "ael": aggor.ael, "raw": aggor.raw.hex(),
                     "count": aggor.count, "compact": compact, "partial": partial,
                     "compactRaw": mapping.Aggor(ael=compact, kind=kind).raw.hex(),
                     "emptyRaw": mapping.Aggor(kind=kind).raw.hex()})
    return {"reference": REFERENCE, "seed": seed, "rows": rows}


if __name__ == "__main__":
    print(json.dumps(generate(), indent=2))
