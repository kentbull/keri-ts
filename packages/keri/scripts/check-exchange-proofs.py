"""Cross-check accepted EXN proof rows using the unmodified frozen upstream processor."""
import json
import pathlib
import runpy
import subprocess
import sys

from keri.app import habbing
from keri.core import parsing
from keri.kering import Vrsn_1_0, Vrsn_2_0
from keri.peer import exchanging

reference = runpy.run_path(str(pathlib.Path(__file__).parents[2] / "cesr/scripts/reference-nested-vectors.py"))
reference["verify_source"]()
root = pathlib.Path(parsing.__file__).resolve().parents[3]
for name, module in list(sys.modules.items()):
    if name.startswith("keri.") and getattr(module, "__file__", None):
        path = pathlib.Path(module.__file__).resolve()
        if path.suffix == ".py":
            assert path.read_bytes() == subprocess.check_output(
                ["git", "-C", str(root), "show", f'{reference["REFERENCE"]}:{path.relative_to(root)}']), str(path)


class ProofRoute:
    """Exercise the existing evidence-selection seam without claiming IPEX workflow coverage."""
    resource = "/proof"
    acceptsSscs = True

    def verifyEvidence(self, serder, tsgs, cigars, sourceSeals, invalid):
        """Retain only factors independently authenticated by the reference kernel."""
        return None if invalid else (tsgs, cigars, sourceSeals)

    def verify(self, serder, **kwa):
        """This probe qualifies exchange proofs; route-specific credential validation comes later."""
        return True

    def handle(self, serder, **kwa):
        """Durable rows, not a synthetic handler success, supply the assertions below."""


corpus = json.load(sys.stdin)
returned = []
with habbing.openHby(name="ts-exchange-proofs", temp=True) as hby:
    for wire in corpus["bootstrap"]:
        stream = bytearray(wire)
        parsing.Parser(version=Vrsn_1_0).parse(ims=stream, kvy=hby.kvy, local=True)
        assert not stream
    hby.kvy.kramer = None  # Qualify the reference-supported optional-KRAM-disabled intake.
    exc = exchanging.Exchanger(hby=hby, handlers=[ProofRoute()])
    for row in corpus["rows"]:
        stream = bytearray(row["wire"])
        parsing.Parser(version=Vrsn_1_0).parse(ims=stream, kvy=hby.kvy, exc=exc)
        assert not stream
        serder = hby.db.exns.get(keys=(row["said"],))
        assert serder is not None, (row["said"], row["signers"], row["cigars"], row["seals"])
        tsgs, cigars = exchanging.verify(hby, serder)
        assert sorted(prefixer.qb64 for prefixer, *_ in tsgs) == sorted(row["signers"])
        assert sorted(cigar.verfer.qb64 for cigar in cigars) == sorted(row["cigars"])
        seals = sorted((keys[1], number.sn, diger.qb64)
                       for keys, (number, diger) in hby.db.ests.getTopItemIter(keys=(row["said"], "")))
        assert seals == sorted(tuple(seal) for seal in row["seals"])
        for endorser in row["endorsers"]:
            assert row["said"] in [d.qb64 for d in hby.db.eidx.get(keys=(endorser,))]
        returned.append(dict(said=row["said"], wire=list(exchanging.serializeMessage(hby, row["said"], framed=True))))
json.dump(returned, sys.stdout)
