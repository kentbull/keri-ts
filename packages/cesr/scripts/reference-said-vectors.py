"""Generate version-aware ignored-field SAIDs using unmodified frozen KERIpy."""
import json
import pathlib
import subprocess

from keri import kering
from keri.core import coring

# Pin behavior independently of the mailbox runtime reference.
REFERENCE = "927c0cb8794d7c84fc17143c67df64aab9deda6c"


def generate():
    """Verify imported source and derive independent literals for each supported format."""
    root = pathlib.Path(coring.__file__).resolve().parents[3]
    assert subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip() == REFERENCE
    for module in [coring, kering]:
        path = pathlib.Path(module.__file__).resolve()
        assert path.read_bytes() == subprocess.check_output(
            ["git", "-C", str(root), "show", f"{REFERENCE}:{path.relative_to(root)}"])
    rows = []
    for version in [kering.Vrsn_1_0, kering.Vrsn_2_0]:
        for kind in ["JSON", "CBOR", "MGPK"]:
            for ignored in [[], ["omit"]]:
                sad = {"v": kering.versify(pvrsn=version, kind=kind),
                       "d": "", "keep": "value", "omit": "ignore me"}
                saider, result = coring.Saider.saidify(sad=sad, ignore=ignored)
                assert saider.verify(result, prefixed=True, ignore=ignored)
                rows.append({"input": sad, "ignore": ignored, "sad": result,
                             "raw": coring.dumps(result, kind=kind).hex()})
    return {"reference": REFERENCE, "rows": rows}


if __name__ == "__main__":
    print(json.dumps(generate(), indent=2))
